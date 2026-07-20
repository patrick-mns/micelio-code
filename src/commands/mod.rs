use std::collections::HashMap;

/// Pull one parked reply channel out of a per-session pending map. When a
/// `session_id` is given the matching entry is removed and returned; otherwise
/// (legacy callers) an arbitrary pending entry is drained so a single in-flight
/// prompt still resolves.
pub(crate) fn take_pending<T>(
    pending: &mut HashMap<String, T>,
    session_id: Option<&str>,
) -> Option<T> {
    match session_id {
        Some(sid) => pending.remove(sid),
        None => {
            let key = pending.keys().next().cloned();
            key.and_then(|k| pending.remove(&k))
        }
    }
}

pub mod agent;
pub mod bg;
pub mod chat;
pub mod graph;
pub mod mcp;
pub mod openers;
pub mod review;
pub mod sessions;
pub mod settings;
pub mod skills;
pub mod updater;
pub mod workspace;
