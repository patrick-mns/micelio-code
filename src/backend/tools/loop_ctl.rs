//! Control tools for `/loop` sessions. Neither tool touches disk — they only
//! signal `backend::loop_registry`, which the loop's driver thread
//! (`backend::loop_runner`) reads once the current turn finishes. Calling
//! either outside of an active `/loop` is a harmless no-op, reported back to
//! the model so it doesn't think it scheduled something that didn't happen.

use super::{ToolContext, ToolResult};
use crate::backend::loop_registry;

pub fn run_schedule_wakeup(arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let delay_secs = super::get_int_field(arguments, "delay_seconds")
        .ok_or_else(|| "tool call missing `delay_seconds`".to_string())?
        .clamp(10, 3600) as u64;
    let reason = super::get_string_field(arguments, "reason")
        .unwrap_or_else(|| "continuing the loop".to_string());

    let scheduled =
        loop_registry::set_pending_wakeup(&context.session_id, delay_secs, reason.clone());
    let content = if scheduled {
        format!("Next loop iteration scheduled in {delay_secs}s. Reason: {reason}")
    } else {
        "No active /loop for this session — nothing scheduled. This tool only has an effect during a /loop.".to_string()
    };
    Ok(ToolResult { content })
}

pub fn run_stop_loop(_arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    loop_registry::stop(&context.session_id);
    Ok(ToolResult {
        content: "Loop stopped.".to_string(),
    })
}
