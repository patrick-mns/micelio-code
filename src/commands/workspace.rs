use std::path::PathBuf;
use tauri::State;
use crate::AppState;
use crate::backend::workspace::{Workspace, list_workspaces};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceWithSessions {
    pub id: String,
    pub name: String,
    pub folders: Vec<PathBuf>,
    pub pinned_model: Option<String>,
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
pub async fn get_current_workspace(state: State<'_, AppState>) -> Result<Workspace, String> {
    let ws = state.current_workspace.lock().unwrap();
    Ok(ws.clone())
}

#[tauri::command]
pub async fn list_all_workspaces() -> Result<Vec<Workspace>, String> {
    Ok(list_workspaces())
}

#[tauri::command]
pub async fn list_all_workspaces_with_sessions(state: State<'_, AppState>) -> Result<Vec<WorkspaceWithSessions>, String> {
    let current_id = state.current_workspace.lock().unwrap().id.clone();
    let current_session_id = state.current_session.lock().unwrap().clone();
    let all = list_workspaces();
    let mut result = Vec::new();
    for ws in all {
        let is_current = ws.id == current_id;
        let db_path = ws.dir().join("sessions.db");
        let sessions = if db_path.exists() {
            match crate::backend::sessions::SessionStore::open(&db_path) {
                Ok(store) => match store.list_sessions() {
                    Ok(metas) => metas.into_iter().map(|m| {
                        let mid = m.id;
                        SessionBrief {
                            id: mid.clone(),
                            title: m.title,
                            message_count: m.event_count,
                            active: is_current && mid == current_session_id,
                        }
                    }).collect(),
                    Err(_) => vec![],
                },
                Err(_) => vec![],
            }
        } else {
            vec![]
        };
        result.push(WorkspaceWithSessions { id: ws.id, name: ws.name, folders: ws.folders, pinned_model: ws.pinned_model, sessions, is_current });
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

#[tauri::command]
pub async fn create_workspace(
    state: State<'_, AppState>,
    name: String,
    folders: Vec<String>,
) -> Result<Workspace, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let id = format!("ws_{:x}", epoch & 0xFFFFFFFF);

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
        current.clone()
    };

    if !ws.folders.contains(&path) {
        ws.folders.push(path.clone());
        ws.save().map_err(|e| e.to_string())?;
    }

    // Update global state
    *state.current_workspace.lock().unwrap() = ws.clone();

    // ensure gitignore
    crate::backend::config::ensure_gitignore(&path);

    // If first folder, update legacy workspace_root for backwards compatibility with legacy tools
    if ws.folders.len() == 1 {
        *state.workspace_root.lock().unwrap() = path.clone();
    }

    // Rescan everything so all nodes have consistent prefixes (especially
    // when going from 1 → 2+ folders where the single-folder prefix flips on).
    let mut graph = crate::backend::knowledge::KnowledgeGraph::new();
    let multi = ws.folders.len() > 1;
    for folder in &ws.folders {
        let prefix = if multi {
            folder.file_name().map(|n| n.to_string_lossy().to_string())
        } else {
            None
        };
        graph.scan_workspace(folder, prefix).map_err(|e| format!("scan error: {e}"))?;
    }
    let graph_path = ws.dir().join("graph.json");
    graph.save(&graph_path).map_err(|e| format!("save graph: {e}"))?;
    *state.graph.lock().unwrap() = graph;

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
        current.clone()
    };

    ws.folders.retain(|f| f != &path);
    ws.save().map_err(|e| e.to_string())?;

    *state.current_workspace.lock().unwrap() = ws.clone();

    // If active root was removed, transition to the next available or workspace folder itself
    let new_root = ws.folders.first().cloned().unwrap_or_else(|| ws.dir());
    *state.workspace_root.lock().unwrap() = new_root;

    // Trigger full rescan on remaining folders
    let mut graph = crate::backend::knowledge::KnowledgeGraph::new();
    let multi_folder = ws.folders.len() > 1;
    for folder in &ws.folders {
        let prefix = if multi_folder {
            folder.file_name().map(|n| n.to_string_lossy().to_string())
        } else {
            None
        };
        let _ = graph.scan_workspace(folder, prefix);
    }
    let graph_path = ws.dir().join("graph.json");
    let _ = graph.save(&graph_path);
    *state.graph.lock().unwrap() = graph;

    Ok(ws)
}

#[tauri::command]
pub async fn rename_workspace(
    state: State<'_, AppState>,
    name: String,
) -> Result<Workspace, String> {
    let mut ws = {
        let current = state.current_workspace.lock().unwrap();
        current.clone()
    };

    ws.name = name;
    ws.save().map_err(|e| e.to_string())?;

    *state.current_workspace.lock().unwrap() = ws.clone();
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
        current.id == id
    };

    if is_current {
        let remaining = list_workspaces();
        if let Some(next) = remaining.first() {
            switch_workspace_internal(&state, next).await?;
        } else {
            // No workspaces left — create a fresh default one
            let fallback = crate::backend::config::app_data_dir().join("workspace-root");
            let _ = std::fs::create_dir_all(&fallback);
            let ws = crate::backend::workspace::bootstrap_default_workspace(&fallback);
            switch_workspace_internal(&state, &ws).await?;
        }
    }

    Ok(())
}

fn workspaces_dir() -> std::path::PathBuf {
    crate::backend::config::app_data_dir().join("workspaces")
}

/// Internal helper to change the current active workspace in AppState
async fn switch_workspace_internal(state: &State<'_, AppState>, ws: &Workspace) -> Result<(), String> {
    // 1. Core paths
    let ws_dir = ws.dir();
    let graph_path = ws_dir.join("graph.json");
    let sessions_db_path = ws_dir.join("sessions.db");

    // 2. Load or create graph
    let graph = match crate::backend::knowledge::KnowledgeGraph::load(&graph_path) {
        Ok(g) if g.total_count() > 0 => g,
        _ => {
            let mut g = crate::backend::knowledge::KnowledgeGraph::new();
            // Scan whichever folders are in the workspace
            let multi_folder = ws.folders.len() > 1;
            for folder in &ws.folders {
                let prefix = if multi_folder {
                    folder.file_name().map(|n| n.to_string_lossy().to_string())
                } else {
                    None
                };
                let _ = g.scan_workspace(folder, prefix);
            }
            let _ = g.save(&graph_path);
            g
        }
    };

    // 3. Setup sessions db
    let store = crate::backend::sessions::SessionStore::open(&sessions_db_path)
        .map_err(|e| e.to_string())?;
    let model = state.chat_model();
    let session_id = match store.latest_session_id() {
        Ok(Some(id)) => id,
        _ => store.create_session("New session", &model).map_err(|e| e.to_string())?,
    };

    let resumed: Vec<crate::backend::llm::Message> = store
        .load_history(&session_id)
        .ok()
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default();

    // 4. Update memory structures in AppState
    let workspace_root = ws.folders.first().cloned().unwrap_or_else(|| ws.dir());
    *state.workspace_root.lock().unwrap() = workspace_root;
    *state.current_workspace.lock().unwrap() = ws.clone();
    *state.graph.lock().unwrap() = graph;
    *state.sessions.lock().unwrap() = store;
    *state.current_session.lock().unwrap() = session_id.clone();

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
