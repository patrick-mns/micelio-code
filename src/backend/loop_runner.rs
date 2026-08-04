//! Driver thread for a `/loop` session: runs one agent turn, then either
//! sleeps for the delay the model requested (via the `schedule_wakeup` tool)
//! and fires again, or stops if the model didn't ask to continue.

use super::loop_registry;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Delay used for a `--forever` loop's auto-continue when the model didn't
/// call `schedule_wakeup` on its own. Same default a well-behaved model
/// would pick for "nothing urgent, check back later".
const FOREVER_DEFAULT_DELAY_SECS: u64 = 300;

fn emit_status(app: &AppHandle, session_id: &str, status: &loop_registry::LoopStatus) {
    let _ = app.emit(
        "loop_status",
        serde_json::json!({
            "session_id": session_id,
            "active": status.active,
            "status": status.status,
            "pending_delay_secs": status.pending_delay_secs,
            "pending_reason": status.pending_reason,
        }),
    );
}

/// Entry point spawned by `start_loop`. `generation` pins this thread to the
/// loop instance created by `loop_registry::start` — if the user starts a new
/// loop for the same session before this one ends, its `take_pending_wakeup`
/// calls start returning `None` and it exits quietly instead of double-firing.
pub fn run(
    app: AppHandle,
    session_id: String,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    generation: u64,
    initial_prompt: Option<String>,
) {
    let mut content = initial_prompt.unwrap_or_else(|| {
        "[/loop start] Begin the loop: figure out what needs to happen based on the \
recent conversation, do the next slice of work, then call `schedule_wakeup` to keep going \
or stop_loop when there's nothing left to do."
            .to_string()
    });

    loop {
        if cancel.load(Ordering::SeqCst) {
            break;
        }

        let forever = loop_registry::is_forever(&session_id, generation);
        crate::commands::chat::run_turn_blocking(
            app.clone(),
            session_id.clone(),
            content.clone(),
            true,
            forever,
        );

        if cancel.load(Ordering::SeqCst) {
            break;
        }

        let wakeup = loop_registry::take_pending_wakeup(&session_id, generation).or_else(|| {
            // --forever: the model didn't ask to continue, but the loop only
            // ends on an explicit stop (stop_loop tool or manual Stop), so
            // keep it alive on a default cadence instead of ending here.
            loop_registry::is_forever(&session_id, generation).then(|| {
                (
                    FOREVER_DEFAULT_DELAY_SECS,
                    "forever loop: no wakeup requested, continuing on the default cadence"
                        .to_string(),
                )
            })
        });

        match wakeup {
            Some((delay_secs, reason)) => {
                loop_registry::set_status(&session_id, generation, "waiting");
                emit_status(
                    &app,
                    &session_id,
                    &loop_registry::LoopStatus {
                        active: true,
                        status: "waiting".to_string(),
                        pending_delay_secs: Some(delay_secs),
                        pending_reason: Some(reason),
                        forever: loop_registry::is_forever(&session_id, generation),
                    },
                );

                let mut waited = 0u64;
                let mut canceled = false;
                while waited < delay_secs {
                    if cancel.load(Ordering::SeqCst) {
                        canceled = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                    waited += 1;
                }
                if canceled {
                    break;
                }
                loop_registry::set_status(&session_id, generation, "running");
                content = crate::backend::prompt::LOOP_TICK.to_string();
            }
            None => break,
        }
    }

    loop_registry::stop(&session_id);
    emit_status(&app, &session_id, &loop_registry::status(&session_id));
}
