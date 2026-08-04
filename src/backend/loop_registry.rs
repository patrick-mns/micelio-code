//! Process-global registry of active `/loop` sessions, keyed by session id —
//! same shape as `tools::bg`'s registry, since both need state reachable from
//! a tool call (which only carries a `session_id`, no `AppHandle`) and from a
//! background driver thread.
//!
//! A loop is self-paced: after each turn the model is expected to call the
//! `schedule_wakeup` tool to say when it wants to run again. The driver
//! thread (`backend::loop_runner`) reads that request after the turn ends. If
//! the model doesn't call it, the loop ends on its own — same "no reschedule,
//! no continuation" rule as Claude Code's dynamic `/loop`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

struct LoopEntry {
    cancel: Arc<AtomicBool>,
    /// Bumped on every `start`; lets a stale sleeping thread from a
    /// superseded loop detect it's no longer the active one and no-op instead
    /// of firing a second, duplicate loop for the same session.
    generation: u64,
    pending_wakeup: Option<(u64, String)>,
    /// Human-readable status for the UI: "running" | "waiting" | "stopped".
    status: &'static str,
    /// `/loop --forever`: keep going even if the model doesn't call
    /// `schedule_wakeup` — only an explicit `stop_loop` call or manual stop
    /// ends it. See `loop_runner::run`.
    forever: bool,
}

fn registry() -> &'static Mutex<HashMap<String, LoopEntry>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, LoopEntry>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Snapshot for the frontend / `get_loop_status`.
#[derive(Clone, serde::Serialize)]
pub struct LoopStatus {
    pub active: bool,
    pub status: String,
    pub pending_delay_secs: Option<u64>,
    pub pending_reason: Option<String>,
    pub forever: bool,
}

/// Register a new loop for `session_id`, replacing (and implicitly
/// cancelling) any previous one. Returns the cancel flag and generation the
/// driver thread must use.
pub fn start(session_id: &str, forever: bool) -> (Arc<AtomicBool>, u64) {
    let mut reg = registry().lock().unwrap();
    let generation = reg.get(session_id).map(|e| e.generation + 1).unwrap_or(0);
    // Cancel whatever was running before so its thread unwinds on its next check.
    if let Some(prev) = reg.get(session_id) {
        prev.cancel.store(true, Ordering::SeqCst);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    reg.insert(
        session_id.to_string(),
        LoopEntry {
            cancel: cancel.clone(),
            generation,
            pending_wakeup: None,
            status: "running",
            forever,
        },
    );
    (cancel, generation)
}

/// Whether `session_id`'s loop (current generation) is a `--forever` loop.
pub fn is_forever(session_id: &str, generation: u64) -> bool {
    let reg = registry().lock().unwrap();
    reg.get(session_id)
        .filter(|e| e.generation == generation)
        .map(|e| e.forever)
        .unwrap_or(false)
}

/// Called by the `schedule_wakeup` tool. No-op if there's no active loop for
/// this session (e.g. the model called it outside of a `/loop`).
pub fn set_pending_wakeup(session_id: &str, delay_secs: u64, reason: String) -> bool {
    let mut reg = registry().lock().unwrap();
    match reg.get_mut(session_id) {
        Some(e) => {
            e.pending_wakeup = Some((delay_secs, reason));
            true
        }
        None => false,
    }
}

/// Take (and clear) the pending wakeup request for the current generation of
/// `session_id`'s loop. Returns `None` both when nothing was scheduled and
/// when the entry has since moved to a newer generation (superseded).
pub fn take_pending_wakeup(session_id: &str, generation: u64) -> Option<(u64, String)> {
    let mut reg = registry().lock().unwrap();
    let entry = reg.get_mut(session_id)?;
    if entry.generation != generation {
        return None;
    }
    entry.pending_wakeup.take()
}

pub fn set_status(session_id: &str, generation: u64, status: &'static str) {
    let mut reg = registry().lock().unwrap();
    if let Some(e) = reg.get_mut(session_id) {
        if e.generation == generation {
            e.status = status;
        }
    }
}

/// Stops the loop (if any) for `session_id` — called on explicit user cancel,
/// the `stop_loop` tool, session deletion, or the driver thread exiting.
pub fn stop(session_id: &str) {
    let mut reg = registry().lock().unwrap();
    if let Some(e) = reg.get_mut(session_id) {
        e.cancel.store(true, Ordering::SeqCst);
        e.status = "stopped";
    }
}

pub fn status(session_id: &str) -> LoopStatus {
    let reg = registry().lock().unwrap();
    match reg.get(session_id) {
        Some(e) if e.status != "stopped" => LoopStatus {
            active: true,
            status: e.status.to_string(),
            pending_delay_secs: e.pending_wakeup.as_ref().map(|(d, _)| *d),
            pending_reason: e.pending_wakeup.as_ref().map(|(_, r)| r.clone()),
            forever: e.forever,
        },
        _ => LoopStatus {
            active: false,
            status: "stopped".to_string(),
            pending_delay_secs: None,
            pending_reason: None,
            forever: false,
        },
    }
}
