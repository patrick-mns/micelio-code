//! Tauri commands backing the frontend's background-tasks panel. The actual
//! registry + process control lives in `backend::tools::bg` (shared with the
//! `bg` model tool); these just expose it to the UI in a serializable shape.

use crate::backend::tools::bg;
use serde::Serialize;

#[derive(Serialize)]
pub struct BgTaskInfo {
    pub pid: u32,
    pub command: String,
    /// "running" or "exited:<code>", matching what the panel parses.
    pub status: String,
    pub uptime_secs: u64,
    /// Folder the task was started in — the panel is global, so this tells the
    /// user which workspace each task belongs to.
    pub workspace_path: String,
}

#[tauri::command]
pub async fn list_bg_tasks() -> Vec<BgTaskInfo> {
    bg::snapshot()
        .into_iter()
        .map(|t| BgTaskInfo {
            pid: t.pid,
            command: t.command,
            status: match t.status {
                bg::BgStatus::Running => "running".to_string(),
                bg::BgStatus::Exited(code) => format!("exited:{code}"),
            },
            uptime_secs: t.uptime_secs,
            workspace_path: t.workspace_path,
        })
        .collect()
}

#[tauri::command]
pub async fn stop_bg_task(pid: u32) -> bool {
    bg::stop_task(pid)
}

#[tauri::command]
pub async fn clear_bg_tasks() {
    bg::clear_finished();
}

/// Full log output of one background task, for the panel's inline log viewer.
/// Tail-capped so a noisy task can't return megabytes. Empty string if there's
/// no output yet; error only if the pid is unknown.
#[tauri::command]
pub async fn get_bg_task_log(pid: u32) -> Result<String, String> {
    bg::read_full_log(pid, 64_000)
        .map(|(text, _status)| text)
        .ok_or_else(|| format!("no task with pid {pid}"))
}
