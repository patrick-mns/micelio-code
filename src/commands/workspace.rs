use crate::backend::workspace::{list_workspaces, Workspace};
use crate::AppState;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceWithSessions {
    pub id: String,
    pub name: String,
    pub folders: Vec<PathBuf>,
    pub sessions: Vec<SessionBrief>,
    pub is_current: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionBrief {
    pub id: String,
    pub title: String,
    pub message_count: usize,
    pub active: bool,
}

#[tauri::command]
pub async fn get_current_workspace(
    state: State<'_, AppState>,
) -> Result<Option<Workspace>, String> {
    let ws = state.current_workspace.lock().unwrap();
    Ok(ws.clone())
}

#[tauri::command]
pub async fn list_all_workspaces() -> Result<Vec<Workspace>, String> {
    Ok(list_workspaces())
}

#[tauri::command]
pub async fn list_all_workspaces_with_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceWithSessions>, String> {
    let current_id = state
        .current_workspace
        .lock()
        .unwrap()
        .as_ref()
        .map(|w| w.id.clone())
        .unwrap_or_default();
    let current_session_id = state.current_session.lock().unwrap().clone();
    let all = list_workspaces();
    let mut result = Vec::new();
    for ws in all {
        let is_current = ws.id == current_id;
        let db_path = ws.dir().join("sessions.db");
        let sessions = if db_path.exists() {
            match crate::backend::sessions::SessionStore::open(&db_path) {
                Ok(store) => match store.list_sessions() {
                    Ok(metas) => metas
                        .into_iter()
                        .map(|m| {
                            let mid = m.id;
                            SessionBrief {
                                id: mid.clone(),
                                title: m.title,
                                message_count: m.event_count,
                                active: is_current && mid == current_session_id,
                            }
                        })
                        .collect(),
                    Err(_) => vec![],
                },
                Err(_) => vec![],
            }
        } else {
            vec![]
        };
        result.push(WorkspaceWithSessions {
            id: ws.id,
            name: ws.name,
            folders: ws.folders,
            sessions,
            is_current,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn set_active_root(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    *state.workspace_root.lock().unwrap() = path;
    Ok(())
}

/// One file offered by the `@` mention autocomplete: its workspace-relative
/// path (what gets inserted and cited to the agent) and basename (for display).
#[derive(serde::Serialize)]
pub struct FileHit {
    pub path: String,
    pub name: String,
}

/// Fuzzy-search files under the selected folder for the `@` mention palette.
/// Walks the active `workspace_root` respecting `.gitignore` (like the graph
/// scan) and ranks a case-insensitive subsequence match on the relative path.
/// Scoped to the selected folder to match the changes panel's behavior.
#[tauri::command]
pub async fn search_workspace_files(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileHit>, String> {
    // Same directories the graph scan skips — noise that should never surface.
    const SKIP_DIRS: [&str; 7] = [
        ".git",
        "node_modules",
        "target",
        ".micelio",
        ".minimal-context",
        ".DS_Store",
        ".opencode",
    ];
    // Cap the walk so a huge repo can't stall the palette.
    const MAX_CANDIDATES: usize = 5_000;

    let root = state.workspace_root.lock().unwrap().clone();
    let limit = limit.unwrap_or(20);
    let q = query.to_lowercase();

    let mut hits: Vec<(FileHit, i32)> = Vec::new();
    let walker = ignore::WalkBuilder::new(&root)
        .hidden(false) // rely on SKIP_DIRS, not the dotfile heuristic
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !SKIP_DIRS.iter().any(|d| name == *d)
        })
        .build();

    let mut walked = 0usize;
    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        walked += 1;
        if walked > MAX_CANDIDATES {
            break;
        }
        let Ok(rel) = entry.path().strip_prefix(&root) else {
            continue;
        };
        // Normalize to forward slashes so cited paths look the same on Windows.
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(score) = fuzzy_score(&q, &rel_str, &name) {
            hits.push((
                FileHit {
                    path: rel_str,
                    name,
                },
                score,
            ));
        }
    }

    // Higher score first, then shorter path as a stable tiebreaker.
    hits.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.path.len().cmp(&b.0.path.len())));
    Ok(hits.into_iter().take(limit).map(|(h, _)| h).collect())
}

/// Score a file for the `@` palette. `None` means no match (filtered out).
/// An empty query matches everything. Otherwise the query must be a
/// case-insensitive subsequence of the relative path; a match inside the
/// basename — especially a prefix — scores higher than a match spread across
/// directory segments.
fn fuzzy_score(query: &str, rel_lower_source: &str, name: &str) -> Option<i32> {
    if query.is_empty() {
        // Prefer shallower files when nothing is typed yet.
        let depth = rel_lower_source.matches('/').count() as i32;
        return Some(100 - depth);
    }
    let rel = rel_lower_source.to_lowercase();
    let name_lower = name.to_lowercase();
    if !is_subsequence(query, &rel) {
        return None;
    }
    let mut score = 0;
    if name_lower.starts_with(query) {
        score += 1000;
    } else if name_lower.contains(query) {
        score += 500;
    } else if rel.contains(query) {
        score += 100;
    }
    // Shallower paths and shorter names rank a little higher.
    score -= rel.matches('/').count() as i32;
    Some(score)
}

/// True if `needle`'s chars appear in `haystack` in order (both lowercased).
fn is_subsequence(needle: &str, haystack: &str) -> bool {
    let mut chars = haystack.chars();
    needle
        .chars()
        .all(|c| chars.any(|h| h == c))
}

#[tauri::command]
pub async fn create_workspace(
    state: State<'_, AppState>,
    name: String,
    folders: Vec<String>,
) -> Result<Workspace, String> {
    let id = crate::backend::workspace::generate_id();

    let folders: Vec<PathBuf> = folders.into_iter().map(PathBuf::from).collect();
    let ws = Workspace::new(id, name, folders);
    ws.save().map_err(|e| e.to_string())?;

    // Switch right away
    switch_workspace_internal(&state, &ws).await?;

    Ok(ws)
}

#[tauri::command]
pub async fn switch_workspace(state: State<'_, AppState>, id: String) -> Result<Workspace, String> {
    let ws = Workspace::load(&id).map_err(|e| format!("failed to load workspace: {e}"))?;
    switch_workspace_internal(&state, &ws).await?;
    Ok(ws)
}

#[tauri::command]
pub async fn add_folder_to_workspace(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Workspace, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() {
        return Err(format!("path does not exist: {folder_path}"));
    }

    let mut ws = {
        let current = state.current_workspace.lock().unwrap();
        current.clone().ok_or("no active workspace")?
    };

    if !ws.folders.contains(&path) {
        ws.folders.push(path.clone());
        ws.save().map_err(|e| e.to_string())?;
    }

    // Update global state
    *state.current_workspace.lock().unwrap() = Some(ws.clone());

    // ensure gitignore
    crate::backend::config::ensure_gitignore(&path);

    // If first folder, update legacy workspace_root for backwards compatibility with legacy tools
    if ws.folders.len() == 1 {
        *state.workspace_root.lock().unwrap() = path.clone();
    }

    // The graph is rebuilt by a background scan the frontend triggers after
    // this returns (see backgroundScan) — we don't scan inline so adding a
    // large folder doesn't freeze the UI.
    Ok(ws)
}

#[tauri::command]
pub async fn remove_folder_from_workspace(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Workspace, String> {
    let path = PathBuf::from(&folder_path);
    let mut ws = {
        let current = state.current_workspace.lock().unwrap();
        current.clone().ok_or("no active workspace")?
    };

    ws.folders.retain(|f| f != &path);
    ws.save().map_err(|e| e.to_string())?;

    *state.current_workspace.lock().unwrap() = Some(ws.clone());

    // If active root was removed, transition to the next available or workspace folder itself
    let new_root = ws.folders.first().cloned().unwrap_or_else(|| ws.dir());
    *state.workspace_root.lock().unwrap() = new_root;

    // The frontend triggers a background rescan of the remaining folders after
    // this returns, so removing a folder doesn't block on a synchronous scan.
    Ok(ws)
}

#[tauri::command]
pub async fn rename_workspace(
    state: State<'_, AppState>,
    name: String,
) -> Result<Workspace, String> {
    let mut ws = {
        let current = state.current_workspace.lock().unwrap();
        current.clone().ok_or("no active workspace")?
    };

    ws.name = name;
    ws.save().map_err(|e| e.to_string())?;

    *state.current_workspace.lock().unwrap() = Some(ws.clone());
    Ok(ws)
}

#[tauri::command]
pub async fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let ws_dir = workspaces_dir().join(&id);
    match std::fs::remove_dir_all(&ws_dir) {
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(format!("failed to delete workspace: {e}")),
    }

    // If we deleted the current workspace, switch to the next available
    let is_current = {
        let current = state.current_workspace.lock().unwrap();
        current.as_ref().map(|w| w.id == id).unwrap_or(false)
    };

    if is_current {
        let remaining = list_workspaces();
        if let Some(next) = remaining.first() {
            switch_workspace_internal(&state, next).await?;
        } else {
            // No workspaces left — drop to the empty onboarding state instead of
            // recreating a phantom default. The UI will prompt to create one.
            clear_current_workspace(&state);
        }
    }

    Ok(())
}

/// Reset AppState to the "no workspace" state: empty graph, an empty sessions
/// store under the data dir, and no current workspace/session. Used when the
/// last workspace is deleted so the UI can show onboarding.
fn clear_current_workspace(state: &State<'_, AppState>) {
    let data_dir = crate::backend::config::app_data_dir().join("_no_workspace");
    let _ = std::fs::create_dir_all(&data_dir);

    *state.current_workspace.lock().unwrap() = None;
    *state.workspace_root.lock().unwrap() = data_dir.clone();
    *state.graph.lock().unwrap() = crate::backend::knowledge::KnowledgeGraph::new();
    if let Ok(store) = crate::backend::sessions::SessionStore::open(&data_dir.join("sessions.db")) {
        *state.sessions.lock().unwrap() = store;
    }
    *state.current_session.lock().unwrap() = String::new();
    state.session_histories.lock().unwrap().clear();
}

fn workspaces_dir() -> std::path::PathBuf {
    crate::backend::config::app_data_dir().join("workspaces")
}

/// Internal helper to change the current active workspace in AppState
async fn switch_workspace_internal(
    state: &State<'_, AppState>,
    ws: &Workspace,
) -> Result<(), String> {
    // 1. Core paths
    let ws_dir = ws.dir();
    let graph_path = ws_dir.join("graph.json");
    let sessions_db_path = ws_dir.join("sessions.db");

    // 2. Load the saved graph, or start empty. We deliberately DON'T scan here:
    // scanning a large folder can take many seconds and would block the whole
    // switch/create call (freezing the UI on "Opening…"). The frontend kicks
    // off a background scan (with progress + cancel + overlay) right after.
    let graph = crate::backend::knowledge::KnowledgeGraph::load(&graph_path).unwrap_or_default();

    // 3. Setup sessions db
    let store = crate::backend::sessions::SessionStore::open(&sessions_db_path)
        .map_err(|e| e.to_string())?;
    let session_id = match store.latest_session_id() {
        Ok(Some(id)) => id,
        _ => {
            // Auto-create a session so the workspace is never in a "no sessions"
            // state — this prevents the bug where the user can send a message in
            // the chat without a valid session, causing orphan DB events.
            let model = state.chat_model();
            store
                .create_session("New session", &model)
                .map_err(|e| e.to_string())?
        }
    };

    let resumed: Vec<crate::backend::llm::Message> = store
        .load_history(&session_id)
        .ok()
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default();

    // 4. Update memory structures in AppState
    let workspace_root = ws.folders.first().cloned().unwrap_or_else(|| ws.dir());
    *state.workspace_root.lock().unwrap() = workspace_root.clone();
    *state.current_workspace.lock().unwrap() = Some(ws.clone());
    *state.graph.lock().unwrap() = graph;
    *state.sessions.lock().unwrap() = store;
    *state.current_session.lock().unwrap() = session_id.clone();

    // 5. Load skills from `.micelio/skills/` in the workspace
    crate::backend::skills::SkillRegistry::load(&workspace_root);
    // Start watching skill directories for changes (hot-reload)
    crate::backend::skill_watcher::watch_workspace(&workspace_root);

    // Clear and resume session history
    let mut histories = state.session_histories.lock().unwrap();
    histories.clear();
    histories.insert(session_id, resumed);

    // Persist this active workspace as the "last visited"
    // By saving its first folder path to legacy `last_workspace` on switch,
    // we play nice with startup/bootsrapping next time around.
    if let Some(first) = ws.folders.first() {
        crate::backend::config::save_last_workspace(first);
    }

    Ok(())
}
