//! Tauri commands for `/loop`: start/stop a self-pacing background loop for a
//! session, and read its current status. Actual driving happens in
//! `backend::loop_runner` on a plain OS thread — see there for the mechanics.

use crate::backend::loop_registry;
use crate::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn start_loop(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: Option<String>,
    prompt: Option<String>,
    forever: Option<bool>,
) -> Result<(), String> {
    let session_id = session_id.unwrap_or_else(|| state.current_session.lock().unwrap().clone());
    if session_id.is_empty() {
        return Err("no active session to loop".to_string());
    }
    let (cancel, generation) = loop_registry::start(&session_id, forever.unwrap_or(false));
    let app2 = app.clone();
    let sid = session_id.clone();
    std::thread::spawn(move || {
        crate::backend::loop_runner::run(app2, sid, cancel, generation, prompt);
    });
    Ok(())
}

#[tauri::command]
pub async fn stop_loop(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<(), String> {
    let session_id = session_id.unwrap_or_else(|| state.current_session.lock().unwrap().clone());
    loop_registry::stop(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn get_loop_status(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<loop_registry::LoopStatus, String> {
    let session_id = session_id.unwrap_or_else(|| state.current_session.lock().unwrap().clone());
    Ok(loop_registry::status(&session_id))
}
