//! Registry of background processes started by the `terminal` tool, plus the
//! `bg` tool the model uses to inspect them (list / read incremental logs /
//! stop). Tools are stateless functions, so the registry lives in a
//! process-global keyed by PID — the same id the user sees in `kill <pid>`.

use super::{ToolContext, ToolResult};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq)]
pub enum BgStatus {
    Running,
    Exited(i32),
}

struct BgTask {
    command: String,
    log_path: PathBuf,
    /// Folder the task was started in (the spawning session's workspace_root),
    /// so the global panel can show where each task came from.
    workspace_path: String,
    started_at: Instant,
    read_offset: u64,
    status: BgStatus,
}

/// One entry in the background-task snapshot, shared by the UI panel command
/// and the `bg` model tool.
pub struct BgSnapshot {
    pub pid: u32,
    pub command: String,
    pub status: BgStatus,
    pub uptime_secs: u64,
    pub workspace_path: String,
}

fn registry() -> &'static Mutex<HashMap<u32, BgTask>> {
    static REGISTRY: OnceLock<Mutex<HashMap<u32, BgTask>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Cap on finished tasks kept around. Running tasks are never evicted (they're
/// live processes the user must be able to stop); only the oldest finished ones
/// are dropped once the panel would otherwise grow unbounded.
const MAX_FINISHED: usize = 30;

/// Evict the oldest finished tasks so at most `MAX_FINISHED` remain. Leaves all
/// running tasks untouched. Caller holds the registry lock.
fn prune_finished(reg: &mut HashMap<u32, BgTask>) {
    let mut finished: Vec<(u32, Instant)> = reg
        .iter()
        .filter(|(_, t)| t.status != BgStatus::Running)
        .map(|(pid, t)| (*pid, t.started_at))
        .collect();
    if finished.len() <= MAX_FINISHED {
        return;
    }
    finished.sort_by_key(|(_, started)| *started); // oldest first
    let excess = finished.len() - MAX_FINISHED;
    for (pid, _) in finished.into_iter().take(excess) {
        if let Some(task) = reg.remove(&pid) {
            let _ = std::fs::remove_file(&task.log_path); // don't leave orphan logs
        }
    }
}

/// Set once at startup so the exit-watcher thread can emit UI events.
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP.set(handle);
}

/// Register a freshly spawned detached process. Takes ownership of the `Child`
/// and spawns a watcher thread that reaps it on exit, records the exit code,
/// and notifies the UI. Returns the PID.
pub fn register(command: &str, log_path: PathBuf, workspace_path: String, child: Child) -> u32 {
    let pid = child.id();
    registry().lock().unwrap().insert(
        pid,
        BgTask {
            command: command.to_string(),
            log_path,
            workspace_path,
            started_at: Instant::now(),
            read_offset: 0,
            status: BgStatus::Running,
        },
    );

    let command = command.to_string();
    std::thread::spawn(move || {
        let mut child = child;
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        {
            let mut reg = registry().lock().unwrap();
            if let Some(task) = reg.get_mut(&pid) {
                task.status = BgStatus::Exited(code);
            }
            // A task just finished — keep the registry bounded.
            prune_finished(&mut reg);
        }
        if let Some(app) = APP.get() {
            use tauri::Emitter;
            let _ = app.emit(
                "bg_task_exited",
                serde_json::json!({ "pid": pid, "command": command, "code": code }),
            );
        }
    });

    pid
}

/// Read everything written to a task's log since the last read, advancing its
/// cursor. Returns the new text (capped) and the task's current status.
fn read_new(pid: u32, max_bytes: usize) -> Option<(String, BgStatus)> {
    let mut reg = registry().lock().unwrap();
    let task = reg.get_mut(&pid)?;
    let mut text = String::new();
    if let Ok(mut f) = std::fs::File::open(&task.log_path) {
        if f.seek(SeekFrom::Start(task.read_offset)).is_ok() {
            let mut buf = Vec::new();
            if f.read_to_end(&mut buf).is_ok() {
                task.read_offset += buf.len() as u64;
                if buf.len() > max_bytes {
                    buf = buf.split_off(buf.len() - max_bytes);
                }
                text = String::from_utf8_lossy(&buf).into_owned();
            }
        }
    }
    Some((text, task.status))
}

/// Read the entire log of a task (tail-capped) without touching the model
/// tool's read cursor. Backs the UI panel's inline log viewer. Returns the
/// text and current status, or None if the task is unknown.
pub fn read_full_log(pid: u32, max_bytes: usize) -> Option<(String, BgStatus)> {
    let reg = registry().lock().unwrap();
    let task = reg.get(&pid)?;
    let mut text = String::new();
    if let Ok(mut buf) = std::fs::read(&task.log_path) {
        if buf.len() > max_bytes {
            buf = buf.split_off(buf.len() - max_bytes);
        }
        text = String::from_utf8_lossy(&buf).into_owned();
    }
    Some((text, task.status))
}

fn status_of(pid: u32) -> Option<BgStatus> {
    registry().lock().unwrap().get(&pid).map(|t| t.status)
}

fn status_label(s: BgStatus) -> String {
    match s {
        BgStatus::Running => "running".into(),
        BgStatus::Exited(c) => format!("exited (code {c})"),
    }
}

/// Snapshot of all known tasks (running + finished), newest first so fresh
/// tasks land at the top of the panel.
pub fn snapshot() -> Vec<BgSnapshot> {
    let reg = registry().lock().unwrap();
    let mut tasks: Vec<(&u32, &BgTask)> = reg.iter().collect();
    tasks.sort_by_key(|(_, t)| std::cmp::Reverse(t.started_at));
    tasks
        .into_iter()
        .map(|(pid, t)| BgSnapshot {
            pid: *pid,
            command: t.command.clone(),
            status: t.status,
            uptime_secs: t.started_at.elapsed().as_secs(),
            workspace_path: t.workspace_path.clone(),
        })
        .collect()
}

/// Stop a task (frontend panel command). Returns true if the task existed.
pub fn stop_task(pid: u32) -> bool {
    terminate(pid)
}

/// Drop all finished tasks from the registry (frontend panel "Clear"), deleting
/// each one's log file so `.micelio/bg` doesn't accumulate orphans.
pub fn clear_finished() {
    registry().lock().unwrap().retain(|_, t| {
        if t.status == BgStatus::Running {
            true
        } else {
            let _ = std::fs::remove_file(&t.log_path);
            false
        }
    });
}

/// Terminate the whole session/group of a background task.
///
/// On Unix the process was started with `setsid`, so its pgid == pid and
/// `kill(-pid)` takes down the real worker (e.g. the `node` under
/// `sh -lc npm run dev`) too. On Windows there is no process group / setsid,
/// so we kill the process tree with `taskkill /T`.
fn terminate(pid: u32) -> bool {
    if status_of(pid).is_none() {
        return false;
    }
    #[cfg(unix)]
    {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        const SIGTERM: i32 = 15;
        unsafe {
            kill(-(pid as i32), SIGTERM);
        }
    }
    #[cfg(windows)]
    {
        use crate::backend::cmd::no_window_cmd;
        let _ = no_window_cmd("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    true
}

// ---- the `bg` tool ---------------------------------------------------------

pub fn run(arguments: &str, _context: &ToolContext) -> Result<ToolResult, String> {
    let action = super::get_string_field(arguments, "action")
        .ok_or_else(|| "bg tool: missing `action` (list | logs | stop)".to_string())?;

    match action.as_str() {
        "list" => Ok(list()),
        "logs" => logs(arguments),
        "stop" => stop(arguments),
        other => Err(format!(
            "bg tool: unknown action `{other}` (use list | logs | stop)"
        )),
    }
}

fn list() -> ToolResult {
    let tasks = snapshot();
    if tasks.is_empty() {
        return ToolResult {
            content: "no background tasks".into(),
        };
    }
    let mut s = String::from("background tasks:\n");
    for t in tasks {
        s.push_str(&format!(
            "- pid {} · {} · {}s · {}\n",
            t.pid,
            status_label(t.status),
            t.uptime_secs,
            t.command
        ));
    }
    ToolResult { content: s }
}

fn logs(arguments: &str) -> Result<ToolResult, String> {
    let pid = super::get_int_field(arguments, "pid")
        .ok_or_else(|| "bg logs: missing `pid`".to_string())? as u32;
    let wait_ms = super::get_int_field(arguments, "wait_ms")
        .unwrap_or(0)
        .max(0) as u64;

    if status_of(pid).is_none() {
        return Err(format!("bg logs: no task with pid {pid}"));
    }

    // Optional wait: return as soon as a URL shows up or the process exits,
    // without blocking the worker past the budget.
    if wait_ms > 0 {
        let start = Instant::now();
        let budget = Duration::from_millis(wait_ms.min(60_000));
        while start.elapsed() < budget {
            if matches!(status_of(pid), Some(BgStatus::Exited(_))) {
                break;
            }
            if let Ok(text) =
                std::fs::read_to_string(&registry().lock().unwrap().get(&pid).unwrap().log_path)
            {
                if text.contains("http://") || text.contains("https://") {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    let (text, status) =
        read_new(pid, 8_000).ok_or_else(|| format!("bg logs: no task with pid {pid}"))?;
    let body = if text.trim().is_empty() {
        "(no new output)".to_string()
    } else {
        text.trim_end().to_string()
    };
    Ok(ToolResult {
        content: format!("pid {pid} · {}\n{body}", status_label(status)),
    })
}

fn stop(arguments: &str) -> Result<ToolResult, String> {
    let pid = super::get_int_field(arguments, "pid")
        .ok_or_else(|| "bg stop: missing `pid`".to_string())? as u32;
    if terminate(pid) {
        Ok(ToolResult {
            content: format!("sent SIGTERM to pid {pid}"),
        })
    } else {
        Err(format!("bg stop: no task with pid {pid}"))
    }
}
