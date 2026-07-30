//! Tauri commands backing the Terminal dock tab. The sessions themselves —
//! shells, scrollback, and the threads that pump output — live in
//! `backend::pty`; these only expose them to the frontend.
//!
//! A terminal's `id` is the dock tab's id, so the frontend never has to track
//! a second handle: the tab it renders *is* the session it talks to.

use crate::backend::pty;
use crate::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Where a terminal's output is mirrored so the text survives the app closing.
///
/// Under the *workspace's* own directory, next to its `sessions.db`, rather than
/// under the selected folder: the folder can change while the terminal stays
/// put, and the transcript would then be looked for somewhere it never was.
/// `None` before a workspace exists, which means that terminal simply isn't
/// remembered — there's nowhere yet to remember it.
fn history_path(state: &AppState, id: &str) -> Option<PathBuf> {
    let dir = state.current_workspace.lock().unwrap().as_ref()?.dir();
    // Ids carry ':' separators, which are legal here but not on Windows.
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    Some(dir.join("terminals").join(format!("{safe}.log")))
}

/// Start (or re-attach to) the shell for `id`, returning its scrollback as
/// base64 so the caller can replay it into a fresh terminal.
///
/// `cwd` omitted means the selected workspace folder — a new terminal opens
/// where the user is already working, the way the changes panel and file
/// search are scoped.
#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let dir = match cwd {
        Some(path) => Some(PathBuf::from(path)),
        None => Some(state.workspace_root.lock().unwrap().clone()),
    };
    let history = history_path(&state, &id);
    pty::open(app, id, dir, cols.max(1), rows.max(1), history)
}

/// Keystrokes, straight through. xterm.js hands over the bytes a terminal
/// would send — including escape sequences for arrows and Ctrl-C — so this
/// forwards them untouched rather than interpreting anything.
#[tauri::command]
pub async fn pty_write(id: String, data: String) -> Result<(), String> {
    pty::write_input(&id, &data)
}

#[tauri::command]
pub async fn pty_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize(&id, cols.max(1), rows.max(1))
}

/// Kill the shell and drop the session. Bound to closing the *tab* — leaving
/// the tab only unmounts the view, and the shell has to survive that.
#[tauri::command]
pub async fn pty_close(id: String) {
    pty::close(&id);
}

/// Whether the shell behind `id` is still running, for a tab that mounts after
/// the exit event has already gone by.
#[tauri::command]
pub async fn pty_is_alive(id: String) -> bool {
    pty::is_alive(&id)
}
