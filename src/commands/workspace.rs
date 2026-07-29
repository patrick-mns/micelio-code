use crate::backend::workspace::{list_workspaces, Workspace};
use crate::AppState;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

/// Grant the asset protocol read access to workspace folders so the webview can
/// load local images from them — skill icons today, model-cited image previews
/// next. The static scope in tauri.conf is empty; folders are opened here at
/// runtime because the workspace is chosen dynamically. Recursive; failures are
/// non-fatal (a disallowed image simply won't render).
pub fn allow_workspace_assets<'a>(app: &AppHandle, dirs: impl IntoIterator<Item = &'a Path>) {
    let scope = app.asset_protocol_scope();
    for dir in dirs {
        let _ = scope.allow_directory(dir, true);
    }
}

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
pub async fn set_active_root(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    allow_workspace_assets(&app, [path.as_path()]);
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
    needle.chars().all(|c| chars.any(|h| h == c))
}

/// One file read for the viewer dock.
#[derive(serde::Serialize)]
pub struct FileContent {
    /// Relative to the folder it was found under — what the UI displays.
    pub path: String,
    /// The folder `path` is relative to. The viewer sends it back on a re-read
    /// so the same relative path can't resolve to a different folder's file
    /// after the active one changes.
    pub root: String,
    /// Absolute location, for the asset protocol (images) and for anything that
    /// has to hand the file to the OS.
    pub abs_path: String,
    pub name: String,
    /// Empty when there is nothing renderable as text — a binary, or an image
    /// the viewer will load from disk instead.
    pub content: String,
    pub language: String,
    /// Show it as a picture. SVG is both: it renders, and it has source.
    pub image: bool,
    /// The file is longer than the read cap; `content` holds the head of it.
    pub truncated: bool,
    pub binary: bool,
    /// True size on disk, which `content` may not reflect once truncated.
    pub size: u64,
}

/// Every folder a file may be read from, best candidate first: the caller's
/// `preferred` root (the folder a relative path was cited against), then the
/// selected one, then the rest of the workspace — the viewer can be pointed at
/// any folder the user opened.
///
/// `preferred` is honoured only when it's already one of those folders; it
/// picks between roots, it can't add one.
fn readable_roots(state: &State<'_, AppState>, preferred: Option<&str>) -> Vec<PathBuf> {
    let mut roots = vec![state.workspace_root.lock().unwrap().clone()];
    if let Some(ws) = state.current_workspace.lock().unwrap().as_ref() {
        for folder in &ws.folders {
            if !roots.contains(folder) {
                roots.push(folder.clone());
            }
        }
    }
    prefer_root(roots, preferred)
}

/// Move `preferred` to the front if it's one of `roots`. Pure so the rule that
/// actually disambiguates a repeated relative path is testable on its own.
fn prefer_root(mut roots: Vec<PathBuf>, preferred: Option<&str>) -> Vec<PathBuf> {
    if let Some(p) = preferred.map(PathBuf::from) {
        if let Some(i) = roots.iter().position(|r| *r == p) {
            roots.swap(0, i);
        }
    }
    roots
}

/// Resolve a requested path against the readable roots, returning the absolute
/// file and the root it belongs to. Split out from the command so the
/// containment rule — the part worth getting wrong-proof — is testable without
/// an `AppState`.
fn resolve_readable(roots: &[PathBuf], path: &str) -> Result<(PathBuf, PathBuf), String> {
    let requested = Path::new(path);

    // A relative path hangs off whichever root actually holds it. A multi-root
    // workspace can repeat the same relative path, so order decides: the caller
    // put its best candidate first (see `prefer_root`).
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        roots
            .iter()
            .map(|r| r.join(requested))
            .find(|p| p.exists())
            .ok_or_else(|| format!("file not found: {path}"))?
    };

    // Canonicalize both sides before comparing: a symlink inside the workspace
    // pointing out of it must not become a way to read arbitrary files.
    let full = candidate
        .canonicalize()
        .map_err(|e| format!("could not open {}: {e}", candidate.display()))?;
    let root = roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .find(|r| full.starts_with(r))
        .ok_or("this file is outside the workspace")?;
    if !full.is_file() {
        return Err(format!("not a file: {}", full.display()));
    }
    Ok((full, root))
}

/// Read a workspace file for the file viewer. Accepts a workspace-relative path
/// (what `search_workspace_files` and the agent's tool output produce) or an
/// absolute one, and refuses anything that resolves outside the workspace.
#[tauri::command]
pub async fn read_workspace_file(
    state: State<'_, AppState>,
    path: String,
    root: Option<String>,
) -> Result<FileContent, String> {
    // Same cap `get_node_code` uses: past this the viewer stops being a viewer.
    const MAX_BYTES: u64 = 200_000;
    // A NUL byte in the head is the usual "not text" tell — cheaper and more
    // reliable than guessing from the extension.
    const SNIFF_BYTES: usize = 8_192;

    let (full, root) = resolve_readable(&readable_roots(&state, root.as_deref()), &path)?;

    let size = std::fs::metadata(&full)
        .map_err(|e| format!("could not stat {}: {e}", full.display()))?
        .len();

    // A picture is loaded from disk by the webview, so its bytes are never
    // wanted here — reading a 12 MB photo to throw it away is pure waste. SVG
    // is the exception: it renders *and* reads as source.
    let image = crate::commands::lang::is_image_path(&path);
    let renders_only = image && !path.to_lowercase().ends_with(".svg");

    let mut buf = Vec::new();
    if !renders_only {
        // Read one byte past the cap so "there is more" is known without
        // pulling a multi-gigabyte file into memory to find out.
        std::fs::File::open(&full)
            .map_err(|e| format!("could not open {}: {e}", full.display()))?
            .take(MAX_BYTES + 1)
            .read_to_end(&mut buf)
            .map_err(|e| format!("could not read {}: {e}", full.display()))?;
    }
    let truncated = buf.len() as u64 > MAX_BYTES;
    if truncated {
        buf.truncate(MAX_BYTES as usize);
    }

    // A file that renders as a picture isn't "binary" to the UI — there is
    // something to show. Only an unreadable one earns the empty state.
    let binary = !image && buf.iter().take(SNIFF_BYTES).any(|&b| b == 0);
    let mut content = if binary || renders_only {
        String::new()
    } else {
        match std::str::from_utf8(&buf) {
            Ok(s) => s.to_string(),
            // The cap can land mid-codepoint; keep what's valid up to there
            // instead of trailing a replacement char.
            Err(e) => String::from_utf8_lossy(&buf[..e.valid_up_to()]).into_owned(),
        }
    };
    if truncated && !content.is_empty() {
        content.push_str("\n… (truncated)");
    }

    // Normalize to forward slashes so a path looks the same on Windows as the
    // one the palette and the agent's tool output cite.
    let rel = full
        .strip_prefix(&root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| full.to_string_lossy().into_owned());

    Ok(FileContent {
        name: full
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| rel.clone()),
        path: rel,
        root: root.to_string_lossy().into_owned(),
        abs_path: full.to_string_lossy().into_owned(),
        content,
        language: crate::commands::lang::lang_from_path(&path),
        image,
        truncated,
        binary,
        size,
    })
}

#[tauri::command]
pub async fn create_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    folders: Vec<String>,
) -> Result<Workspace, String> {
    let id = crate::backend::workspace::generate_id();

    let folders: Vec<PathBuf> = folders.into_iter().map(PathBuf::from).collect();
    let ws = Workspace::new(id, name, folders);
    ws.save().map_err(|e| e.to_string())?;

    // Switch right away
    switch_workspace_internal(&app, &state, &ws).await?;

    Ok(ws)
}

#[tauri::command]
pub async fn switch_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Workspace, String> {
    let ws = Workspace::load(&id).map_err(|e| format!("failed to load workspace: {e}"))?;
    switch_workspace_internal(&app, &state, &ws).await?;
    Ok(ws)
}

#[tauri::command]
pub async fn add_folder_to_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Workspace, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() {
        return Err(format!("path does not exist: {folder_path}"));
    }
    allow_workspace_assets(&app, [path.as_path()]);

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
pub async fn delete_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
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
            switch_workspace_internal(&app, &state, next).await?;
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
    app: &AppHandle,
    state: &State<'_, AppState>,
    ws: &Workspace,
) -> Result<(), String> {
    // Open every folder of the incoming workspace to the asset protocol so its
    // skill icons and image previews load.
    allow_workspace_assets(app, ws.folders.iter().map(PathBuf::as_path));

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A throwaway workspace root, in the same manual style the tool tests use
    /// (no tempfile dependency in this crate).
    fn tmp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("micelio-read-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn resolves_a_relative_path_under_the_root() {
        let root = tmp_root("rel");
        fs::write(root.join("README.md"), "# hi").unwrap();

        let (full, matched) = resolve_readable(&[root.clone()], "README.md").unwrap();
        assert_eq!(full, root.join("README.md"));
        assert_eq!(matched, root);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn picks_the_first_root_that_holds_the_path() {
        // Multi-root workspaces repeat relative paths; the selected root (first)
        // must win so the viewer agrees with the rest of the app's scoping.
        let a = tmp_root("multi-a");
        let b = tmp_root("multi-b");
        fs::write(b.join("only-in-b.txt"), "b").unwrap();

        let (full, matched) = resolve_readable(&[a.clone(), b.clone()], "only-in-b.txt").unwrap();
        assert_eq!(full, b.join("only-in-b.txt"));
        assert_eq!(matched, b);
        let _ = fs::remove_dir_all(&a);
        let _ = fs::remove_dir_all(&b);
    }

    #[test]
    fn the_cited_root_wins_when_a_relative_path_exists_in_two_folders() {
        // The case a multi-folder workspace actually hits: both projects have a
        // README.md, so "README.md" alone is ambiguous and the viewer would flip
        // to the other project's file when the selected folder changes.
        let a = tmp_root("same-a");
        let b = tmp_root("same-b");
        fs::write(a.join("README.md"), "from a").unwrap();
        fs::write(b.join("README.md"), "from b").unwrap();

        let roots = prefer_root(vec![a.clone(), b.clone()], Some(&b.to_string_lossy()));
        let (full, matched) = resolve_readable(&roots, "README.md").unwrap();
        assert_eq!(fs::read_to_string(&full).unwrap(), "from b");
        assert_eq!(matched, b);

        // An unknown root can't add a folder — it only reorders the real ones.
        let roots = prefer_root(vec![a.clone(), b.clone()], Some("/nowhere"));
        assert_eq!(roots, vec![a.clone(), b.clone()]);

        let _ = fs::remove_dir_all(&a);
        let _ = fs::remove_dir_all(&b);
    }

    #[test]
    fn rejects_traversal_out_of_the_workspace() {
        let root = tmp_root("traversal");
        let outside = root
            .parent()
            .unwrap()
            .join("micelio-read-traversal-outside.txt");
        fs::write(&outside, "SENSITIVE").unwrap();

        let err = resolve_readable(&[root.clone()], "../micelio-read-traversal-outside.txt")
            .expect_err("`..` must not escape the workspace");
        assert!(
            !err.contains("SENSITIVE"),
            "the error must not leak content"
        );
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_an_absolute_path_outside_the_workspace() {
        let root = tmp_root("absolute");
        let outside = root
            .parent()
            .unwrap()
            .join("micelio-read-absolute-outside.txt");
        fs::write(&outside, "SENSITIVE").unwrap();

        assert!(resolve_readable(&[root.clone()], &outside.to_string_lossy()).is_err());
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_pointing_out_of_the_workspace() {
        // The link lives inside the workspace, so only canonicalizing before the
        // containment check catches this one.
        let root = tmp_root("symlink");
        let outside = root
            .parent()
            .unwrap()
            .join("micelio-read-symlink-outside.txt");
        fs::write(&outside, "SENSITIVE").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link.txt")).unwrap();

        assert!(resolve_readable(&[root.clone()], "link.txt").is_err());
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_a_directory() {
        let root = tmp_root("dir");
        fs::create_dir(root.join("src")).unwrap();

        assert!(resolve_readable(&[root.clone()], "src").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
