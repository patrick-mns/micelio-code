//! The agentic chat loop: drives one user turn end-to-end, streaming model
//! output, executing tool calls, and re-prompting until the model answers
//! without a tool. Lives in the commands layer because it's tightly coupled to
//! Tauri (event emission + `AppState`); `commands::chat` keeps only the thin
//! `#[tauri::command]` entry points and persistence helpers.

use crate::backend::llm::{self, Message, StreamEvent, ToolResultContent, ELIDED_MARKER_LEN};
use crate::backend::prompt;
use crate::backend::tools;
use crate::AppState;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Runaway guard, not a feature: the loop's real stop condition is the model
/// emitting no tool call. This only bounds a pathological model that never
/// stops calling tools. Set high enough that legitimate multi-step tasks never
/// hit it.
const MAX_TOOL_ROUNDS: usize = 50;
/// Consecutive tool failures that force the loop to stop and report.
const MAX_CONSECUTIVE_ERRORS: u32 = 3;
/// Consecutive failures after which a Reflexion nudge is injected (before the
/// hard stop) to make the model rethink instead of repeating the same call.
const REFLEXION_AFTER_ERRORS: u32 = 2;
/// Identical consecutive tool calls (same name + args) that count as a stuck
/// loop. Cheaper and more reliable than a low round cap for catching the model
/// repeating itself.
const MAX_IDENTICAL_CALLS: u32 = 3;
/// Max characters of a single tool result fed back into context. Large reads /
/// command output are truncated (head + tail) so one call can't blow the
/// window. Tuned for small local models.
const TOOL_RESULT_MAX_CHARS: usize = 8_000;
/// When the estimated history size exceeds this token budget, the content of
/// older tool results is elided (messages are kept so tool_call pairing stays
/// intact) to claw back context room.
const CONTEXT_TOKEN_BUDGET: usize = 24_000;
/// Most recent tool results to keep verbatim during compaction.
const KEEP_RECENT_TOOL_RESULTS: usize = 6;
/// Retuning the window above is fine; zeroing it is not — that would elide
/// every tool result, including the one the model just asked for, leaving it to
/// answer from nothing. Checked here at compile time rather than in a test,
/// since the value is known then.
const _: () = assert!(KEEP_RECENT_TOOL_RESULTS > 0);

/// Drive the whole agent turn on a worker thread. `history` already has the
/// system prompt prepended and the user turn appended.
#[allow(clippy::too_many_arguments)]
pub fn run_agent_loop(
    app: AppHandle,
    provider: Arc<dyn llm::Provider>,
    model: String,
    workspace_root: std::path::PathBuf,
    graph_json: String,
    session_id: String,
    mut history: Vec<Message>,
    cancel: Arc<AtomicBool>,
    needs_tool: bool,
    mode: crate::backend::review::AgentMode,
) {
    use crate::backend::review::AgentMode;
    // Chat mode advertises only a read-only subset of tools (see
    // CHAT_MODE_TOOLS); every other mode gets the full toolset. The subset is
    // computed once and reused for every streamed round this turn.
    let mcp = app.state::<AppState>().mcp.clone();
    let tools_advert = tools::all_tools_json(Some(&mcp), mode == AgentMode::Chat);
    // Chat mode can't write/edit files, so a "change this file" request can
    // never be satisfied there — suppress the tool-nudge retry.
    let needs_tool = needs_tool && mode != AgentMode::Chat;
    let mut did_any_tool = false;
    let mut retried_for_tool = false;
    let mut consecutive_errors: u32 = 0;
    // Stagnation guard: signature of the previous tool call and how many times
    // it has repeated back-to-back.
    let mut last_call_sig: Option<String> = None;
    let mut identical_calls: u32 = 0;
    // Accumulated across the whole turn for the persisted transcript.
    let mut thinking_acc = String::new();
    let mut tool_summaries: Vec<String> = Vec::new();
    let started = std::time::Instant::now();
    // Token usage + cost summed across every model turn in this loop. Shared so
    // the (move) `finish` closure can read the final total without threading it
    // through every call site.
    let usage_acc = Arc::new(Mutex::new(llm::Usage::default()));
    let usage_for_finish = usage_acc.clone();
    // Raw network request/response of the final model call this turn (a tool
    // loop re-streams, so we keep the latest of each for the Turn detail view).
    let req_body_acc = Arc::new(Mutex::new(String::new()));
    let resp_raw_acc = Arc::new(Mutex::new(String::new()));
    let req_body_for_finish = req_body_acc.clone();
    let resp_raw_for_finish = resp_raw_acc.clone();

    // Files written/edited during this turn, coalesced. Drives end-of-turn
    // auto-summarization (one summary per file, only if its content changed).
    let dirty: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let dirty_for_finish = dirty.clone();
    let ws_for_finish = workspace_root.clone();
    let model_for_finish = model.clone();
    let session_id_ref = session_id.clone();

    // Persist the model context + the UI transcript for this turn, then tell
    // the frontend we're done. Finally, kick off background auto-summary of any
    // files this turn touched (non-blocking; emits node_summarized per file).
    let finish = move |app: &AppHandle,
                       history: &[Message],
                       thinking: &str,
                       tools: &[String],
                       content: &str| {
        let state = app.state::<AppState>();
        // Always update this session's per-session history (regardless of which
        // session the user is currently viewing).
        state
            .session_histories
            .lock()
            .unwrap()
            .insert(session_id.clone(), history[1..].to_vec());

        let store = state.sessions.lock().unwrap();
        if !thinking.trim().is_empty() {
            let secs = started.elapsed().as_secs().max(1).to_string();
            let _ = store.append_event(&session_id, "thinking", Some(&secs), thinking.trim());
        }
        for t in tools {
            let _ = store.append_event(&session_id, "tool", None, t);
        }
        // Usage/cost (if the provider reported any) is stashed in the assistant
        // event's `title` as JSON so it survives reload, and emitted live.
        let mut usage = usage_for_finish.lock().unwrap().clone();
        usage.model = Some(model_for_finish.clone());
        let usage_json = serde_json::to_string(&usage).unwrap_or_default();
        if !content.trim().is_empty() {
            let _ = store.append_event(&session_id, "assistant", Some(&usage_json), content.trim());
            // Rich ledger row: latency + request/response previews, durable even
            // if the chat transcript is later cleared. The request is the last
            // user message that drove this turn.
            let request = history
                .iter()
                .rev()
                .find(|m| m.role == "user")
                .map(|m| m.content.as_str())
                .unwrap_or("");
            // Raw views: the exact request body sent to the provider and the
            // raw response stream it returned, both at the network level.
            let request_raw = req_body_for_finish.lock().unwrap().clone();
            let response_raw = resp_raw_for_finish.lock().unwrap().clone();
            // Cost split, only when the provider actually reports it. We don't
            // fabricate it by token share — input/output prices differ, so an
            // apportioned guess would be misleading.
            let (prompt_cost, completion_cost) = (usage.prompt_cost, usage.completion_cost);
            store.log_usage(
                &session_id,
                &model_for_finish,
                usage.prompt_tokens,
                usage.completion_tokens,
                usage.cost,
                started.elapsed().as_millis() as u64,
                request,
                content.trim(),
                prompt_cost,
                completion_cost,
                &request_raw,
                &response_raw,
            );
        }
        let history_json = serde_json::to_string(&history[1..]).unwrap_or_else(|_| "[]".into());
        let _ = store.save_history(&session_id, &history_json, "[]");
        drop(store);

        if !usage.is_empty() {
            let _ = app.emit(
                "stream_usage",
                serde_json::json!({
                    "session_id": session_id,
                    "prompt_tokens": usage.prompt_tokens,
                    "completion_tokens": usage.completion_tokens,
                    "cost": usage.cost,
                }),
            );
        }
        let _ = app.emit(
            "stream_done",
            serde_json::json!({ "session_id": session_id }),
        );

        let touched: Vec<String> = dirty_for_finish.lock().unwrap().drain().collect();
        spawn_auto_summary(app, ws_for_finish.clone(), touched);

        // Generate a smart title after the first turn (event_count == 2: one
        // user + one assistant event). Runs on its own thread so it never
        // blocks the response; emits `session_title` when done.
        {
            let state = app.state::<AppState>();
            let count = state.sessions.lock().unwrap().event_count(&session_id);
            if count == 2 {
                spawn_title_generation(app, session_id.clone());
            }
        }
    };

    for _ in 0..MAX_TOOL_ROUNDS {
        // User hit Stop between rounds — persist what we have and bail.
        if cancel.load(Ordering::SeqCst) {
            finish(&app, &history, &thinking_acc, &tool_summaries, "");
            return;
        }
        // Keep the working context within budget before the next model turn.
        compact_history(&mut history);
        // ---- stream one model turn ----
        let mut stream = match provider.start_stream(&model, &history, &tools_advert) {
            Ok(s) => s,
            Err(e) => {
                let _ = app.emit(
                    "stream_error",
                    serde_json::json!({ "session_id": session_id_ref, "error": e }),
                );
                return;
            }
        };
        let mut content_acc = String::new();
        let mut tool_calls: Vec<llm::ToolCall> = Vec::new();
        let mut turn_done = false;
        let stream_start = std::time::Instant::now();
        let mut last_event = stream_start;
        while !turn_done {
            if cancel.load(Ordering::SeqCst) {
                history.push(Message::assistant(content_acc.clone()));
                finish(&app, &history, &thinking_acc, &tool_summaries, &content_acc);
                return;
            }

            if stream_start.elapsed() > std::time::Duration::from_secs(300) {
                let _ = app.emit("stream_error", serde_json::json!({ "session_id": session_id_ref, "error": "Model timed out — no response after 5 minutes" }));
                return;
            }

            match stream.poll() {
                Ok(events) => {
                    if events.is_empty() {
                        if last_event.elapsed() > std::time::Duration::from_secs(120) {
                            let _ = app.emit("stream_error", serde_json::json!({ "session_id": session_id_ref, "error": "Stream timed out — no data from model for 2 minutes" }));
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(16));
                        continue;
                    }
                    last_event = std::time::Instant::now();
                    for ev in events {
                        match ev {
                            StreamEvent::Content(s) => {
                                content_acc.push_str(&s);
                                let _ = app.emit(
                                    "stream_content",
                                    serde_json::json!({ "session_id": session_id_ref, "delta": s }),
                                );
                            }
                            StreamEvent::Thinking(s) => {
                                thinking_acc.push_str(&s);
                                let _ = app.emit(
                                    "stream_thinking",
                                    serde_json::json!({ "session_id": session_id_ref, "delta": s }),
                                );
                            }
                            StreamEvent::ToolCall(call) => tool_calls.push(call),
                            StreamEvent::Usage(u) => {
                                let mut acc = usage_acc.lock().unwrap();
                                acc.prompt_tokens += u.prompt_tokens;
                                acc.completion_tokens += u.completion_tokens;
                                acc.cost += u.cost;
                                // Carry the breakdown/raw payload through; on a
                                // multi-step turn keep the latest non-empty one.
                                if u.prompt_cost.is_some() {
                                    acc.prompt_cost = u.prompt_cost;
                                }
                                if u.completion_cost.is_some() {
                                    acc.completion_cost = u.completion_cost;
                                }
                                if u.raw.is_some() {
                                    acc.raw = u.raw;
                                }
                            }
                            StreamEvent::RequestBody(b) => {
                                *req_body_acc.lock().unwrap() = b;
                            }
                            StreamEvent::ResponseRaw(r) => {
                                *resp_raw_acc.lock().unwrap() = r;
                            }
                            StreamEvent::Done => turn_done = true,
                        }
                    }
                }
                Err(e) => {
                    let _ = app.emit(
                        "stream_error",
                        serde_json::json!({ "session_id": session_id_ref, "error": e }),
                    );
                    return;
                }
            }
        }

        // ---- model called one or more tools: execute all, then re-prompt ----
        if !tool_calls.is_empty() {
            // Stagnation guard: a model stuck re-issuing the exact same call(s)
            // makes no progress. Detect it before executing so we don't spin.
            let sig = tool_calls
                .iter()
                .map(|c| format!("{}\u{1f}{}", c.name, c.arguments))
                .collect::<Vec<_>>()
                .join("\u{1e}");
            if last_call_sig.as_deref() == Some(sig.as_str()) {
                identical_calls += 1;
            } else {
                identical_calls = 1;
                last_call_sig = Some(sig);
            }
            if identical_calls >= MAX_IDENTICAL_CALLS {
                history.push(Message::assistant(content_acc));
                let summary = force_stop_summary(
                    &app,
                    provider.as_ref(),
                    &model,
                    &mut history,
                    &session_id_ref,
                );
                finish(&app, &history, &thinking_acc, &tool_summaries, &summary);
                return;
            }

            let (summaries, any_error) = run_tool_calls(
                &app,
                provider.as_ref(),
                &mut history,
                content_acc,
                tool_calls,
                &workspace_root,
                &model,
                &graph_json,
                &dirty,
                &session_id_ref,
                mode,
            );
            tool_summaries.extend(summaries);
            if any_error {
                consecutive_errors += 1;
            } else {
                consecutive_errors = 0;
            }
            did_any_tool = true;

            // Too many consecutive errors: force the model to tell the user
            // what went wrong and stop the agentic loop.
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                let summary = force_stop_summary(
                    &app,
                    provider.as_ref(),
                    &model,
                    &mut history,
                    &session_id_ref,
                );
                finish(&app, &history, &thinking_acc, &tool_summaries, &summary);
                return;
            }

            // Repeated (but not yet fatal) failures: nudge the model to reflect
            // on the root cause and change approach before its next attempt.
            if consecutive_errors >= REFLEXION_AFTER_ERRORS {
                history.push(Message::system(prompt::REFLEXION));
            }

            continue;
        }

        // ---- no tool call ----
        let content = content_acc.trim().to_string();

        // Retry-for-tool: the user asked for a file/workspace change but the
        // model answered with nothing — nudge it to use a tool, once.
        if needs_tool && content.is_empty() {
            if !retried_for_tool {
                history.push(Message::system(prompt::NEEDS_TOOL));
                retried_for_tool = true;
                continue;
            }
            // Second consecutive empty response after NEEDS_TOOL: the model
            // ignored the nudge.  Treat as a tool error so that the reflection
            // and hard-stop machinery fires instead of silently finishing.
            consecutive_errors += 1;
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                let summary = force_stop_summary(
                    &app,
                    provider.as_ref(),
                    &model,
                    &mut history,
                    &session_id_ref,
                );
                finish(&app, &history, &thinking_acc, &tool_summaries, &summary);
                return;
            }
            if consecutive_errors >= REFLEXION_AFTER_ERRORS {
                history.push(Message::system(prompt::REFLEXION));
            }
            continue;
        }

        history.push(Message::assistant(content_acc.clone()));

        // No tool call this turn → the model considers itself done. We trust
        // that signal instead of nagging it to find more work (the old
        // self-eval auto-continue caused scope creep and wasted round-trips).

        // If tools ran but the model produced no text summary, request one so
        // the user always gets a meaningful response.
        let final_content = if did_any_tool && content.is_empty() {
            request_summary(
                &app,
                provider.as_ref(),
                &model,
                &mut history,
                &session_id_ref,
            )
        } else {
            content
        };

        finish(
            &app,
            &history,
            &thinking_acc,
            &tool_summaries,
            &final_content,
        );
        return;
    }

    // Safety valve: too many rounds — ask model for a summary so the user
    // always gets a final response, then finish.
    let summary_content = request_summary(
        &app,
        provider.as_ref(),
        &model,
        &mut history,
        &session_id_ref,
    );
    finish(
        &app,
        &history,
        &thinking_acc,
        &tool_summaries,
        &summary_content,
    );
}

/// Pop a trailing system message if present (used to remove an injected nudge
/// after a one-shot `chat` call).
fn pop_trailing_system(history: &mut Vec<Message>) {
    if history.last().map(|m| m.role == "system").unwrap_or(false) {
        history.pop();
    }
}

/// Inject the failure-stop nudge, get a final report from the model, and clean
/// up the nudge. Returns the (already emitted) summary text.
fn force_stop_summary(
    app: &AppHandle,
    provider: &dyn llm::Provider,
    model: &str,
    history: &mut Vec<Message>,
    session_id: &str,
) -> String {
    pop_trailing_system(history);
    history.push(Message::system(prompt::TOOL_FAILURE_STOP));
    match provider.chat(model, history, false) {
        Ok(resp) => {
            history.pop();
            let _ = app.emit(
                "stream_content",
                serde_json::json!({ "session_id": session_id, "delta": resp.content }),
            );
            resp.content
        }
        Err(_) => {
            history.pop();
            String::new()
        }
    }
}

/// Inject the summary request, get a concise wrap-up from the model, and clean
/// up the nudge. Returns the (already emitted) summary text.
fn request_summary(
    app: &AppHandle,
    provider: &dyn llm::Provider,
    model: &str,
    history: &mut Vec<Message>,
    session_id: &str,
) -> String {
    history.push(Message::system(prompt::SUMMARY_REQUEST));
    match provider.chat(model, history, false) {
        Ok(resp) => {
            history.pop();
            if !resp.content.trim().is_empty() {
                let _ = app.emit(
                    "stream_content",
                    serde_json::json!({ "session_id": session_id, "delta": resp.content }),
                );
            }
            resp.content
        }
        Err(_) => {
            history.pop();
            String::new()
        }
    }
}

/// Records ONE assistant turn carrying all of `calls` (parallel tool calls),
/// then executes each in order, appending a `tool` result message per call so
/// the wire-format pairing (OpenAI `tool_call_id`, Ollama FIFO) stays valid.
/// Returns each call's UI summary plus whether any of them errored.
// Orchestration entry point: each argument is a distinct piece of turn
// context (history, provider, workspace, dirty-set, …) with its own lifetime,
// so bundling them into a struct would only add indirection here.
#[allow(clippy::too_many_arguments)]
pub fn run_tool_calls(
    app: &AppHandle,
    provider: &dyn llm::Provider,
    history: &mut Vec<Message>,
    assistant_content: String,
    calls: Vec<llm::ToolCall>,
    workspace_root: &std::path::Path,
    model: &str,
    graph_json: &str,
    dirty: &Arc<Mutex<HashSet<String>>>,
    session_id: &str,
    mode: crate::backend::review::AgentMode,
) -> (Vec<String>, bool) {
    history.push(Message::assistant_with_tool_call(
        assistant_content,
        provider.tool_calls_history_json(&calls),
    ));

    let mut summaries = Vec::with_capacity(calls.len());
    // Single boolean: true if ANY tool in this parallel batch errored.
    // The caller increments `consecutive_errors` at most once per round,
    // so parallel failures don't inflate the count.
    let mut any_error = false;
    for call in calls {
        let (summary, is_error, touched) = execute_tool_call(
            app,
            history,
            call,
            workspace_root,
            model,
            graph_json,
            session_id,
            mode,
        );

        // `touched` is only Some when the file was actually written to disk
        // (not e.g. a rejected review-mode edit), so the turn-end auto-summary
        // only refreshes files that really changed.
        if let Some(path) = touched {
            dirty.lock().unwrap().insert(path);
        }
        any_error |= is_error;
        summaries.push(summary);
    }
    (summaries, any_error)
}

/// Executes a single tool call and appends its `tool` result message. The
/// assistant message carrying the call(s) must already be in `history` (see
/// [`run_tool_calls`]). Returns `(summary, is_error, touched_path)` — the
/// third element is `Some(path)` only when a file was actually written to
/// disk this call, so the caller can dirty-track just the files that really
/// changed (a rejected review-mode edit does not count).
#[allow(clippy::too_many_arguments)]
fn execute_tool_call(
    app: &AppHandle,
    history: &mut Vec<Message>,
    call: llm::ToolCall,
    workspace_root: &std::path::Path,
    model: &str,
    graph_json: &str,
    session_id: &str,
    mode: crate::backend::review::AgentMode,
) -> (String, bool, Option<String>) {
    // `ask_user` is interactive: hand the questions to the UI and block this
    // worker thread until the user answers (or cancels / stops the stream).
    if call.name == "ask_user" {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        {
            let st = app.state::<AppState>();
            *st.session_pending.lock().unwrap() = Some((session_id.to_string(), tx));
        }
        let _ = app.emit(
            "ask_user",
            serde_json::json!({ "session_id": session_id, "args": &call.arguments }),
        );

        let cancel = {
            let st = app.state::<AppState>();
            let c = st.session_cancels.lock().unwrap().get(session_id).cloned();
            c
        };
        let answer = loop {
            let canceled = cancel
                .as_ref()
                .map(|c| c.load(Ordering::SeqCst))
                .unwrap_or(false);
            if canceled {
                break "(canceled)".to_string();
            }
            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(a) => break a,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    break "(no answer)".to_string()
                }
            }
        };
        {
            let st = app.state::<AppState>();
            *st.session_pending.lock().unwrap() = None;
        }

        let summary = format!("ask_user completed\n{answer}");
        let _ = app.emit(
            "stream_tool",
            serde_json::json!({ "session_id": session_id, "summary": summary }),
        );
        history.push(Message::tool("ask_user", &answer));
        return (summary, false, None);
    }

    // Chat mode is read-only. The model is only offered read-only tools, but
    // guard execution too so a stray call (e.g. a `file` write) can never touch
    // disk — return an explanatory result instead of running it.
    let chat_mode = mode == crate::backend::review::AgentMode::Chat;
    let mcp_state = app.state::<AppState>().mcp.clone();
    let mode_blocks = if call.name.starts_with(crate::backend::mcp::MCP_PREFIX) {
        // MCP tools follow the mode: in Chat mode only read-only ones run.
        !tools::mcp_mode_allows(Some(&mcp_state), &call.name, chat_mode)
    } else {
        chat_mode && !tools::chat_mode_allows(&call.name, &call.arguments)
    };
    if mode_blocks {
        let msg = format!(
            "Chat mode is read-only — `{}` isn't available here. Switch to Auto or Review mode to make changes.",
            call.name
        );
        let summary = format!("{} blocked\n{msg}", call.name);
        let _ = app.emit(
            "stream_tool",
            serde_json::json!({ "session_id": session_id, "summary": summary }),
        );
        history.push(Message::tool_with_content(
            &call.name,
            ToolResultContent::Full(msg),
        ));
        return (summary, false, None);
    }

    let ws = app
        .state::<AppState>()
        .current_workspace
        .lock()
        .unwrap()
        .clone();
    let workspace_roots = match ws {
        Some(w) if !w.folders.is_empty() => w.folders,
        _ => vec![workspace_root.to_path_buf()],
    };

    let ctx = tools::ToolContext {
        workspace_root: workspace_root.to_path_buf(),
        workspace_roots,
        model_name: model.to_string(),
        vision_model: app.state::<AppState>().session_vision_model(session_id),
        history_len: history.len(),
        show_tools: true,
        debug: false,
        graph_json: graph_json.to_string(),
        mcp: Some(app.state::<AppState>().mcp.clone()),
    };

    // ── Review mode: pause file write/edit for user approval ────────────
    // Normalize the tool name the same way tools::run does (handles stuttering).
    let normalized = tools::normalize_tool_name(&call.name);
    let is_file_mod = normalized == "file"
        && tools::get_string_field(&call.arguments, "action")
            .as_deref()
            .map(|a| a == "write" || a == "edit")
            .unwrap_or(false);
    // Also handle legacy tool names that map to write/edit.
    let is_legacy_mod = matches!(normalized, "write_file" | "edit_file");
    let is_edit = normalized == "edit_file"
        || (normalized == "file"
            && tools::get_string_field(&call.arguments, "action").as_deref() == Some("edit"));

    let review_on =
        (is_file_mod || is_legacy_mod) && mode == crate::backend::review::AgentMode::Review;

    // ── Review mode: pause side-effecting non-file tools for confirmation ──
    // terminal / bg-stop / context_node don't produce a diff, so they get a
    // generic confirmation card instead of the EditApprovalCard. The user can
    // reject, allow once, or "always allow" the tool for the rest of the
    // session (tracked in `session_tool_allow`). File write/edit is handled by
    // the diff flow below, so it's excluded from `needs_review_confirmation`.
    // MCP tools follow the same rule as native side-effecting tools in Review
    // mode: a non-read-only MCP tool (per its readOnlyHint) needs confirmation.
    // Read-only MCP tools run freely.
    let mcp_needs_confirm = normalized.starts_with(crate::backend::mcp::MCP_PREFIX)
        && !mcp_state.is_read_only(normalized);
    if mode == crate::backend::review::AgentMode::Review
        && (tools::needs_review_confirmation(normalized, &call.arguments) || mcp_needs_confirm)
    {
        let already_allowed = {
            let st = app.state::<AppState>();
            let map = st.session_tool_allow.lock().unwrap();
            map.get(session_id)
                .map(|set| set.contains(normalized))
                .unwrap_or(false)
        };

        if !already_allowed {
            let (title, detail) = tools::confirm_summary(normalized, &call.arguments);

            let (tx, rx) = std::sync::mpsc::channel::<crate::backend::review::ConfirmDecision>();
            {
                let st = app.state::<AppState>();
                *st.pending_confirm.lock().unwrap() = Some((session_id.to_string(), tx));
            }
            let _ = app.emit(
                "confirm_request",
                serde_json::json!({
                    "session_id": session_id,
                    "tool": normalized,
                    "title": title,
                    "detail": detail,
                }),
            );

            let cancel = {
                let st = app.state::<AppState>();
                let c = st.session_cancels.lock().unwrap().get(session_id).cloned();
                c
            };
            let decision = loop {
                let canceled = cancel
                    .as_ref()
                    .map(|c| c.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if canceled {
                    break crate::backend::review::ConfirmDecision::Reject;
                }
                match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(d) => break d,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        break crate::backend::review::ConfirmDecision::Reject
                    }
                }
            };
            {
                let st = app.state::<AppState>();
                *st.pending_confirm.lock().unwrap() = None;
            }

            match decision {
                crate::backend::review::ConfirmDecision::Reject => {
                    let msg = format!("`{}` was rejected by the user — it was not run.", call.name);
                    let summary = format!("{} blocked\n{msg}", call.name);
                    let _ = app.emit(
                        "stream_tool",
                        serde_json::json!({ "session_id": session_id, "summary": summary }),
                    );
                    history.push(Message::tool_with_content(
                        &call.name,
                        ToolResultContent::Full(msg),
                    ));
                    return (summary, false, None);
                }
                crate::backend::review::ConfirmDecision::Always => {
                    let st = app.state::<AppState>();
                    st.session_tool_allow
                        .lock()
                        .unwrap()
                        .entry(session_id.to_string())
                        .or_default()
                        .insert(normalized.to_string());
                }
                crate::backend::review::ConfirmDecision::Once => {}
            }
        }
    }

    let (is_error, tool_content, touched) = if review_on {
        let path =
            tools::get_string_field(&call.arguments, "path").unwrap_or_else(|| "unknown".into());
        let full_path = workspace_root.join(&path);
        let original = std::fs::read_to_string(&full_path).unwrap_or_default();

        // Compute the proposed content with the exact same validation the real
        // write/edit tools use, so a bad edit (unmatched old_string, ambiguous
        // match, etc.) errors out here instead of silently "succeeding".
        let proposed = if is_edit {
            match tools::file::resolve_edit_content(&original, &call.arguments, &path) {
                Ok((after, _, _)) => after,
                Err(e) => {
                    let summary = format!("{} completed\nerror: {e}", call.name);
                    let _ = app.emit(
                        "stream_tool",
                        serde_json::json!({ "session_id": session_id, "summary": summary }),
                    );
                    let tc = ToolResultContent::Full(format!("error: {e}"));
                    history.push(Message::tool_with_content(&call.name, tc));
                    return (summary, true, None);
                }
            }
        } else {
            match tools::file::resolve_write_content(&call.arguments) {
                Ok(c) => c,
                Err(e) => {
                    let summary = format!("{} completed\nerror: {e}", call.name);
                    let _ = app.emit(
                        "stream_tool",
                        serde_json::json!({ "session_id": session_id, "summary": summary }),
                    );
                    let tc = ToolResultContent::Full(format!("error: {e}"));
                    history.push(Message::tool_with_content(&call.name, tc));
                    return (summary, true, None);
                }
            }
        };

        // Ask the frontend to show a diff and wait for the user's decision —
        // the same blocking pattern `ask_user` uses, so a rejected edit never
        // touches disk and an accepted one is written immediately (no
        // in-memory staging area to keep in sync with the real filesystem).
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        {
            let st = app.state::<AppState>();
            *st.pending_edit.lock().unwrap() = Some((session_id.to_string(), tx));
        }
        let _ = app.emit(
            "review_request",
            serde_json::json!({
                "session_id": session_id,
                "path": path,
                "original_content": original,
                "proposed_content": proposed,
            }),
        );

        let cancel = {
            let st = app.state::<AppState>();
            let c = st.session_cancels.lock().unwrap().get(session_id).cloned();
            c
        };
        let accepted = loop {
            let canceled = cancel
                .as_ref()
                .map(|c| c.load(Ordering::SeqCst))
                .unwrap_or(false);
            if canceled {
                break false;
            }
            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(a) => break a,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break false,
            }
        };
        {
            let st = app.state::<AppState>();
            *st.pending_edit.lock().unwrap() = None;
        }

        if accepted {
            match std::fs::write(&full_path, &proposed) {
                Ok(()) => {
                    let _ = app.emit("review_changed", serde_json::json!({}));
                    (
                        false,
                        ToolResultContent::Full(format!("`{path}` updated and applied.")),
                        Some(path),
                    )
                }
                Err(e) => (
                    true,
                    ToolResultContent::Full(format!(
                        "error: failed to write {}: {e}",
                        full_path.display()
                    )),
                    None,
                ),
            }
        } else {
            (
                false,
                ToolResultContent::Full(format!(
                    "`{path}` change was rejected by the user — the file was not modified."
                )),
                None,
            )
        }
    } else {
        let touched = if is_file_mod || is_legacy_mod {
            tools::get_string_field(&call.arguments, "path")
        } else {
            None
        };
        match tools::run(&call.name, &call.arguments, &ctx) {
            Ok(r) => {
                let tc = truncate_for_context(&r.content);
                (false, tc, touched)
            }
            Err(e) => (true, ToolResultContent::Full(format!("error: {e}")), None),
        }
    };
    let summary = format!("{} completed\n{}", call.name, tool_content.render());
    let _ = app.emit(
        "stream_tool",
        serde_json::json!({ "session_id": session_id, "summary": summary }),
    );
    history.push(Message::tool_with_content(&call.name, tool_content));
    (summary, is_error, touched)
}

/// Generates a short session title using the summarize model and emits
/// `session_title` so the sidebar can update without a full refresh.
fn spawn_title_generation(app: &AppHandle, session_id: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        let (summarize_model, first_user, first_assistant) = {
            let state = app.state::<AppState>();
            let summarize_model = state.session_summarize_model(&session_id);
            let store = state.sessions.lock().unwrap();
            let events = store.load_events(&session_id).unwrap_or_default();
            let user = events
                .iter()
                .find(|e| e.kind == "user")
                .map(|e| e.content.clone())
                .unwrap_or_default();
            let asst = events
                .iter()
                .find(|e| e.kind == "assistant")
                .map(|e| e.content.clone())
                .unwrap_or_default();
            (summarize_model, user, asst)
        };

        if first_user.is_empty() {
            return;
        }

        let provider = llm::provider_for_model(&summarize_model);
        let prompt = format!(
            "Generate a short title (3-6 words, no quotes, no period) for this conversation.\n\
             User: {}\nAssistant: {}",
            first_user.chars().take(300).collect::<String>(),
            first_assistant.chars().take(300).collect::<String>(),
        );
        let Ok(title) = provider.chat_simple(
            &summarize_model,
            "You generate concise chat titles. Reply with only the title, nothing else.",
            &prompt,
            false,
        ) else {
            return;
        };

        let title = title
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        if title.is_empty() {
            return;
        }

        {
            let state = app.state::<AppState>();
            let store = state.sessions.lock().unwrap();
            let _ = store.set_title(&session_id, &title);
        }
        let _ = app.emit(
            "session_title",
            serde_json::json!({
                "session_id": session_id,
                "title": title,
            }),
        );
    });
}

/// Background, gradual auto-summarization of files touched during a turn.
/// Runs on its own thread (never blocks the chat), processing one file at a
/// time so summaries trickle in. Skips files whose content hash is unchanged,
/// creates a graph node for newly-written files, and emits `node_summarized` +
/// `graph_updated` per file so the UI updates live. Gated by the
/// `auto_summarize` setting (default on).
fn spawn_auto_summary(app: &AppHandle, workspace_root: std::path::PathBuf, files: Vec<String>) {
    if files.is_empty() || !crate::backend::config::auto_summarize() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        use crate::backend::knowledge::{content_hash, extract_span, NodeKind};

        let summarize_model = app.state::<AppState>().summarize_model();
        let provider = llm::provider_for_model(&summarize_model);

        let locks = crate::backend::locks::locked_filter(&workspace_root);

        for path in files {
            // Defense in depth: writes to a locked file are already blocked, so
            // it shouldn't land here — but this path ships content to a model,
            // so it re-checks rather than trusting the caller.
            if locks.is_locked(&path) {
                continue;
            }
            let full = workspace_root.join(&path);
            let Ok(file_text) = std::fs::read_to_string(&full) else {
                continue;
            };

            // Resolve the node + its span up front, deciding whether work is
            // even needed, all under a single short-lived graph lock.
            let plan = {
                let st = app.state::<AppState>();
                let mut graph = st.graph.lock().unwrap();
                let existing = graph
                    .nodes()
                    .iter()
                    .find(|n| {
                        n.attachment
                            .as_ref()
                            .map(|a| a.path == path)
                            .unwrap_or(false)
                    })
                    .map(|n| {
                        (
                            n.id,
                            n.content_hash,
                            n.attachment.as_ref().and_then(|a| a.span),
                        )
                    });

                match existing {
                    Some((id, stored, span)) => {
                        let content = extract_span(&file_text, span);
                        let hash = content_hash(&content);
                        if stored == Some(hash) {
                            None // unchanged since last summary — skip
                        } else {
                            Some((id, content, hash))
                        }
                    }
                    None => {
                        // Newly-written file not in the graph yet: add a File node.
                        let id = graph.add(&path, NodeKind::File);
                        graph.set_attachment(id, &path, None, file_text.len());
                        let hash = content_hash(&file_text);
                        Some((id, file_text.clone(), hash))
                    }
                }
            };
            let Some((node_id, content, hash)) = plan else {
                continue;
            };
            if content.trim().is_empty() {
                continue;
            }

            // The slow part — the LLM call — runs WITHOUT holding the lock.
            let prompt = format!("Summarize this code in 1-2 sentences:\n\n```\n{content}\n```");
            let Ok(summary) = provider.chat_simple(
                &summarize_model,
                "You are a code summarizer.",
                &prompt,
                false,
            ) else {
                continue;
            };

            // Store, persist, and notify the UI.
            {
                let st = app.state::<AppState>();
                let mut graph = st.graph.lock().unwrap();
                graph.set_summary(node_id, summary.trim(), Some(hash));
                let root = st.workspace_root.lock().unwrap().clone();
                let _ = graph.save(&root.join(".micelio/graph.json"));
            }
            let _ = app.emit("node_summarized", (node_id, summary.trim().to_string()));
            let _ = app.emit("graph_updated", ());
        }
    });
}

/// Cap a single tool result for context: keep the head and tail with a clear
/// elision marker in between, so neither a huge file read nor a chatty command
/// can blow the window. Char-based on UTF-8 boundaries.
/// Returns a [`ToolResultContent`] instead of a raw string so the caller can
/// avoid re-allocating the full content on compaction.
fn truncate_for_context(s: &str) -> ToolResultContent {
    if s.len() <= TOOL_RESULT_MAX_CHARS {
        return ToolResultContent::Full(s.to_string());
    }
    let head_len = TOOL_RESULT_MAX_CHARS * 3 / 4;
    let tail_len = TOOL_RESULT_MAX_CHARS - head_len;
    let head_end = floor_char_boundary(s, head_len);
    let tail_start = ceil_char_boundary(s, s.len() - tail_len);
    ToolResultContent::Truncated {
        head: s[..head_end].to_string(),
        tail: s[tail_start..].to_string(),
    }
}

/// Shrink `history` in place when it exceeds the token budget by replacing the
/// content of older tool results with `ToolResultContent::Elided`.  Messages are
/// preserved (so OpenAI-style tool_call/result pairing stays intact) — only the
/// bulky `content` of tool-role messages beyond the most recent few is replaced
/// with a zero-allocation marker.
fn compact_history(history: &mut [Message]) {
    let total: usize = history
        .iter()
        .map(|m| crate::backend::tokens::count_tokens(&m.content))
        .sum();
    if total <= CONTEXT_TOKEN_BUDGET {
        return;
    }
    let tool_indices: Vec<usize> = history
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "tool")
        .map(|(i, _)| i)
        .collect();
    if tool_indices.len() <= KEEP_RECENT_TOOL_RESULTS {
        return;
    }
    let elide_until = tool_indices.len() - KEEP_RECENT_TOOL_RESULTS;
    for &idx in &tool_indices[..elide_until] {
        let m = &mut history[idx];
        // Already compacted — skip the cheap path.
        if matches!(m.tool_content, Some(ToolResultContent::Elided)) {
            continue;
        }
        // Short messages (< marker overhead) aren't worth replacing.
        if m.content.len() <= ELIDED_MARKER_LEN {
            continue;
        }
        m.tool_content = Some(ToolResultContent::Elided);
        m.content = "[elided]".into();
    }
}

/// `str::floor_char_boundary` is unstable; inline a stable version.
fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// `str::ceil_char_boundary` is unstable; inline a stable version.
fn ceil_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    /// "aé" is 3 bytes — `a` at 0, `é` spanning 1..3 — so byte 2 sits inside a
    /// character. Slicing there would panic, which is the whole reason these
    /// two helpers exist.
    const MIXED: &str = "aé";

    #[test]
    fn char_boundary_helpers_step_off_the_middle_of_a_character() {
        assert!(!MIXED.is_char_boundary(2), "test premise");
        assert_eq!(floor_char_boundary(MIXED, 2), 1, "floor walks back");
        assert_eq!(ceil_char_boundary(MIXED, 2), 3, "ceil walks forward");

        // Already on a boundary: both are identities.
        for i in [0, 1, 3] {
            assert_eq!(floor_char_boundary(MIXED, i), i);
            assert_eq!(ceil_char_boundary(MIXED, i), i);
        }
    }

    #[test]
    fn char_boundary_helpers_clamp_past_the_end() {
        // Past-the-end must clamp rather than run off: floor would underflow
        // looking for a boundary that isn't there, ceil would overrun.
        assert_eq!(floor_char_boundary(MIXED, 99), MIXED.len());
        assert_eq!(ceil_char_boundary(MIXED, 99), MIXED.len());
        assert_eq!(floor_char_boundary("", 0), 0);
        assert_eq!(ceil_char_boundary("", 5), 0);
    }

    #[test]
    fn short_tool_results_are_kept_whole() {
        let s = "a".repeat(TOOL_RESULT_MAX_CHARS);
        match truncate_for_context(&s) {
            ToolResultContent::Full(f) => assert_eq!(f, s, "at the limit, nothing is cut"),
            other => panic!("expected Full, got {other:?}"),
        }
    }

    #[test]
    fn long_tool_results_keep_the_head_and_the_tail() {
        let s: String = (0..20_000)
            .map(|i| ((i % 26) as u8 + b'a') as char)
            .collect();
        match truncate_for_context(&s) {
            ToolResultContent::Truncated { head, tail } => {
                assert!(s.starts_with(&head), "head comes from the start");
                assert!(s.ends_with(&tail), "tail comes from the end");

                // Pin both sizes. `starts_with`/`ends_with` alone are far too
                // weak — every string ends with "", so an empty tail would sail
                // past them. A boundary nudge can shave at most one character.
                let want_head = TOOL_RESULT_MAX_CHARS * 3 / 4;
                let want_tail = TOOL_RESULT_MAX_CHARS - want_head;
                assert!(
                    head.len() <= want_head && head.len() + 4 >= want_head,
                    "head should be ~{want_head} bytes, got {}",
                    head.len()
                );
                assert!(
                    tail.len() <= want_tail && tail.len() + 4 >= want_tail,
                    "tail should be ~{want_tail} bytes, got {}",
                    tail.len()
                );

                // The two halves must not overlap and re-feed the same bytes.
                assert!(s.len() - tail.len() >= head.len(), "head and tail overlap");
            }
            other => panic!("expected Truncated, got {other:?}"),
        }
    }

    /// A tool result is arbitrary bytes from disk or a command — it can easily
    /// put a multi-byte character exactly where the cut lands.
    #[test]
    fn truncating_never_splits_a_character() {
        // One leading ASCII byte offsets every following 2-byte `é`, so the
        // cut points land mid-character instead of aligning by luck.
        let s = format!("a{}", "é".repeat(TOOL_RESULT_MAX_CHARS));
        match truncate_for_context(&s) {
            ToolResultContent::Truncated { head, tail } => {
                // Reaching here at all means no panic. Both halves must still
                // be the characters that were there, not severed bytes.
                assert!(head.chars().all(|c| c == 'a' || c == 'é'));
                assert!(tail.chars().all(|c| c == 'é'));
            }
            other => panic!("expected Truncated, got {other:?}"),
        }
    }

    /// Prose, not a repeated character: `"x".repeat(20_000)` is only ~2.5k
    /// tokens because the tokenizer collapses runs, so a history built from it
    /// silently stays under budget and `compact_history` returns before doing
    /// anything. This is ~4k tokens per message, close to real tool output.
    fn big_tool_msg(name: &str) -> Message {
        Message::tool(
            name,
            &"the quick brown fox jumps over the lazy dog ".repeat(450),
        )
    }

    /// Guards the premise of every compaction test below: if these histories
    /// ever slip back under the budget, `compact_history` no-ops and the tests
    /// would keep passing while testing nothing.
    fn assert_over_budget(h: &[Message]) {
        let total: usize = h
            .iter()
            .map(|m| crate::backend::tokens::count_tokens(&m.content))
            .sum();
        assert!(
            total > CONTEXT_TOKEN_BUDGET,
            "fixture is under budget ({total} <= {CONTEXT_TOKEN_BUDGET}); compaction wouldn't run"
        );
    }

    #[test]
    fn compaction_leaves_a_small_history_alone() {
        let mut h = vec![Message::user("hi"), Message::tool("file", "small")];
        let before = h.clone();
        compact_history(&mut h);
        assert_eq!(h.len(), before.len());
        assert_eq!(
            h[1].content, before[1].content,
            "under budget, nothing elided"
        );
    }

    /// A long conversation of small tool calls: more results than the
    /// keep-recent window, but nowhere near the token budget. The budget check
    /// is the only thing standing between these and elision — without it, a
    /// chatty-but-cheap session would lose its history for no reason.
    #[test]
    fn compaction_leaves_many_small_results_alone_while_under_budget() {
        let mut h: Vec<Message> = (0..KEEP_RECENT_TOOL_RESULTS + 5)
            .map(|i| Message::tool(&format!("t{i}"), "a short result, past the marker length"))
            .collect();
        let before = h.clone();
        compact_history(&mut h);
        for (i, m) in h.iter().enumerate() {
            assert_eq!(
                m.content, before[i].content,
                "message {i} elided under budget"
            );
            assert!(
                m.tool_content.is_none(),
                "message {i} marked elided under budget"
            );
        }
    }

    #[test]
    fn compaction_elides_old_tool_results_and_keeps_the_recent_ones() {
        // Written against the constant rather than a literal, so retuning the
        // window doesn't break this — it's a knob, not a contract. The one
        // value that isn't tuning, zero, is ruled out where it's declared.
        let total = KEEP_RECENT_TOOL_RESULTS + 4;
        let mut h: Vec<Message> = (0..total).map(|i| big_tool_msg(&format!("t{i}"))).collect();
        let kept_len = h[total - 1].content.len();
        assert_over_budget(&h);
        compact_history(&mut h);

        // Messages themselves must survive: dropping one would break the
        // tool_call/tool_result pairing providers require.
        assert_eq!(h.len(), total, "no message was removed");

        for (i, m) in h.iter().enumerate() {
            if i < total - KEEP_RECENT_TOOL_RESULTS {
                assert!(
                    matches!(m.tool_content, Some(ToolResultContent::Elided)),
                    "message {i} should be elided"
                );
                assert_eq!(m.content, "[elided]");
            } else {
                assert_eq!(
                    m.content.len(),
                    kept_len,
                    "recent message {i} kept verbatim"
                );
            }
        }
    }

    #[test]
    fn compaction_spares_non_tool_messages() {
        let mut h = vec![Message::user(
            &"a user turn that is quite wordy ".repeat(400),
        )];
        h.extend((0..KEEP_RECENT_TOOL_RESULTS + 2).map(|i| big_tool_msg(&format!("t{i}"))));
        let user_before = h[0].content.clone();
        assert_over_budget(&h);
        compact_history(&mut h);
        assert_eq!(h[0].content, user_before, "a user turn is never elided");
    }

    #[test]
    fn compaction_skips_results_smaller_than_the_marker() {
        // Replacing a 2-byte result with "[elided]" would *grow* the history.
        let mut h = vec![Message::tool("tiny", "ok")];
        h.extend((0..KEEP_RECENT_TOOL_RESULTS + 2).map(|i| big_tool_msg(&format!("t{i}"))));
        assert_over_budget(&h);
        compact_history(&mut h);
        assert_eq!(h[0].content, "ok", "short result left as-is");
        assert!(h[0].tool_content.is_none());
    }

    #[test]
    fn pop_trailing_system_removes_only_a_trailing_nudge() {
        let mut h = vec![Message::user("q"), Message::system("nudge")];
        pop_trailing_system(&mut h);
        assert_eq!(h.len(), 1, "the nudge is gone");
        assert_eq!(h[0].role, "user");

        // A system message that isn't last (the prompt) must stay.
        let mut h = vec![Message::system("prompt"), Message::user("q")];
        pop_trailing_system(&mut h);
        assert_eq!(h.len(), 2, "the system prompt is not a trailing nudge");

        let mut empty: Vec<Message> = vec![];
        pop_trailing_system(&mut empty);
        assert!(empty.is_empty());
    }
}
