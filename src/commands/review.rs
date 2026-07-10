//! Tauri commands backing the review UI. File edit/write approval itself is
//! synchronous and handled inline in `commands::agent::execute_tool_call`
//! (see `answer_edit_review` below); these commands cover the review-mode
//! toggle and the unstaged-git-changes panel.

use crate::backend::review::{self, AgentMode, WorkspaceChanges};
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct ReviewStatusInfo {
    pub pending_count: usize,
    pub changes: WorkspaceChanges,
}

#[tauri::command]
pub async fn get_review_status(state: State<'_, AppState>) -> Result<ReviewStatusInfo, String> {
    let root = state.workspace_root.lock().unwrap().clone();
    let mut r = state.review.lock().unwrap();
    r.refresh_git_diff(&root);
    Ok(ReviewStatusInfo {
        pending_count: r.pending_count(),
        changes: WorkspaceChanges {
            git_files: r.git_changes(),
        },
    })
}

#[tauri::command]
pub async fn set_agent_mode(state: State<'_, AppState>, mode: String) -> Result<String, String> {
    let mut r = state.review.lock().unwrap();
    r.mode = AgentMode::from_str(&mode);
    Ok(r.mode.as_str().to_string())
}

#[tauri::command]
pub async fn get_agent_mode(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.review.lock().unwrap().mode.as_str().to_string())
}

/// The effective mode for a session — its pinned value, or the global default
/// when unset. Never empty, so the UI can display it directly.
#[tauri::command]
pub async fn get_session_mode(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    Ok(state.session_agent_mode(&session_id).as_str().to_string())
}

/// Pin a mode to a session. Also updates the global default so newly created
/// chats inherit the most recent choice.
#[tauri::command]
pub async fn set_session_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: String,
) -> Result<String, String> {
    let parsed = AgentMode::from_str(&mode);
    state
        .sessions
        .lock()
        .unwrap()
        .set_session_mode(&session_id, parsed.as_str())
        .map_err(|e| e.to_string())?;
    state.review.lock().unwrap().mode = parsed;
    Ok(parsed.as_str().to_string())
}

#[tauri::command]
pub async fn git_revert_review_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let root = state.workspace_root.lock().unwrap().clone();
    review::git_revert_file(&root, &path)
}

#[tauri::command]
pub async fn git_revert_all_review(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let root = state.workspace_root.lock().unwrap().clone();
    review::git_revert_all(&root)
}

/// Answer a pending edit approval request (see `execute_tool_call`), the same
/// way `answer_question` answers a pending `ask_user` call.
#[tauri::command]
pub async fn answer_edit_review(state: State<'_, AppState>, accepted: bool) -> Result<(), String> {
    let entry = state.pending_edit.lock().unwrap().take();
    match entry {
        Some((_sid, tx)) => tx
            .send(accepted)
            .map_err(|_| "worker no longer waiting".to_string()),
        None => Err("no pending edit review".into()),
    }
}
