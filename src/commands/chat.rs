use crate::backend::llm::{self, Message};
use crate::backend::tools;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<llm::Usage>,
}

pub fn event_to_message(kind: String, title: Option<String>, content: String) -> ChatMessage {
    let (duration, usage) = match kind.as_str() {
        "thinking" => (title.as_deref().and_then(|t| t.parse::<u64>().ok()), None),
        "assistant" => (
            None,
            title
                .as_deref()
                .and_then(|t| serde_json::from_str::<llm::Usage>(t).ok()),
        ),
        _ => (None, None),
    };
    ChatMessage {
        role: kind,
        content,
        duration,
        usage,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_to_message_plain_text() {
        let m = event_to_message("user".into(), None, "hello".into());
        assert_eq!(m.role, "user");
        assert_eq!(m.content, "hello");
        assert!(m.duration.is_none());
        assert!(m.usage.is_none());
    }

    #[test]
    fn event_to_message_thinking_with_duration() {
        let m = event_to_message("thinking".into(), Some("3450".into()), "hmm...".into());
        assert_eq!(m.role, "thinking");
        assert_eq!(m.duration, Some(3450));
        assert!(m.usage.is_none());
    }

    #[test]
    fn event_to_message_thinking_bad_duration_is_none() {
        let m = event_to_message("thinking".into(), Some("not-a-number".into()), "".into());
        assert!(m.duration.is_none());
    }

    #[test]
    fn event_to_message_assistant_with_usage() {
        let usage_json = r#"{"prompt_tokens":10,"completion_tokens":20,"cost":0.0015}"#;
        let m = event_to_message("assistant".into(), Some(usage_json.into()), "hi".into());
        assert_eq!(m.role, "assistant");
        let u = m.usage.unwrap();
        assert_eq!(u.prompt_tokens, 10);
        assert_eq!(u.completion_tokens, 20);
        assert!((u.cost - 0.0015).abs() < 1e-6);
    }

    #[test]
    fn event_to_message_assistant_bad_usage_is_none() {
        let m = event_to_message("assistant".into(), Some("{bad json}".into()), "hi".into());
        assert!(m.usage.is_none());
    }

    #[test]
    fn event_to_message_unknown_kind() {
        let m = event_to_message("tool".into(), Some("anything".into()), "result".into());
        assert_eq!(m.role, "tool");
        assert!(m.duration.is_none());
        assert!(m.usage.is_none());
    }
}

#[derive(Serialize, Clone)]
pub struct TurnResult {
    pub thinking: String,
    pub tools: Vec<String>,
    pub content: String,
}

/// If there is no active session (`current_session` is empty), create a new one
/// and set it as the current session so the caller can safely use it.
/// This fixes a bug where sending a chat message on a brand-new workspace (no
/// sessions yet) would use an empty session_id, causing orphan events in the DB
/// and a broken in-memory history that never reconciles with any real session.
fn ensure_session(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let is_empty = state.current_session.lock().unwrap().is_empty();
    if !is_empty {
        return Ok(());
    }
    let id = {
        let store = state.sessions.lock().unwrap();
        store
            .create_session("New session", &state.chat_model())
            .map_err(|e| format!("failed to create session: {e}"))?
    };
    *state.current_session.lock().unwrap() = id.clone();
    // No history to load — brand new session
    state.session_histories.lock().unwrap().remove(&id);
    // Emit to the frontend so the sidebar and chat view update their session list
    let _ = app.emit("session_created", serde_json::json!({ "session_id": id }));
    Ok(())
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    content: String,
) -> Result<TurnResult, String> {
    // Auto-create a session if none exists (e.g. brand new workspace).
    ensure_session(&app, &state)?;
    let session_id = state.current_session.lock().unwrap().clone();
    let model = state.session_chat_model(&session_id);

    {
        let mut histories = state.session_histories.lock().unwrap();
        histories
            .entry(session_id.clone())
            .or_default()
            .push(Message::user(&content));
    }

    let messages = state
        .session_histories
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .unwrap_or_default();

    let provider = llm::provider_for_model(&model);
    let system = crate::backend::prompt::system_prompt();
    let mut full = vec![Message::system(&system)];
    full.extend(messages);

    let response = provider.chat(&model, &full, false)?;

    let tools: Vec<String> = match &response.tool_call {
        Some(call) => vec![format!("{} completed\n{}", call.name, call.arguments)],
        None => vec![],
    };

    state
        .session_histories
        .lock()
        .unwrap()
        .entry(session_id)
        .or_default()
        .push(Message::assistant(response.content.clone()));

    app.emit("chat_response", &response.content)
        .map_err(|e| e.to_string())?;

    Ok(TurnResult {
        thinking: response.thinking,
        tools,
        content: response.content,
    })
}

#[tauri::command]
pub async fn start_chat_stream(app: AppHandle, content: String) -> Result<String, String> {
    let (model, workspace_root, graph_json, session_id, history, mode) = {
        let state = app.state::<AppState>();
        // Auto-create a session if none exists (e.g. brand new workspace).
        ensure_session(&app, &state)?;
        let workspace_root = state.workspace_root.lock().unwrap().clone();
        let session_id = state.current_session.lock().unwrap().clone();
        let model = state.session_chat_model(&session_id);
        let mode = state.session_agent_mode(&session_id);

        {
            let store = state.sessions.lock().unwrap();
            if store.event_count(&session_id) == 0 {
                let title: String = content.chars().take(48).collect();
                let _ = store.set_title(&session_id, title.trim());
            }
            let _ = store.append_event(&session_id, "user", None, &content);
        }

        {
            let mut histories = state.session_histories.lock().unwrap();
            histories
                .entry(session_id.clone())
                .or_default()
                .push(Message::user(&content));
        }
        let messages = state
            .session_histories
            .lock()
            .unwrap()
            .get(&session_id)
            .cloned()
            .unwrap_or_default();

        // Locked files are stripped here: this JSON is both the model's graph
        // context and what the `graph` tool reads, so one filter covers both.
        let graph_json = {
            let locks = crate::backend::locks::locked_filter(&workspace_root);
            let graph = state.graph.lock().unwrap();
            graph.serialize_for_model(&locks)
        };

        let mut system = crate::backend::prompt::system_prompt();
        // Chat mode: no tools are sent to the model. Tell it so it doesn't
        // promise actions it can't take and stays purely conversational.
        if mode == crate::backend::review::AgentMode::Chat {
            system.push_str("\n\n");
            system.push_str(crate::backend::prompt::CHAT_MODE);
        }
        let mut history = vec![Message::system(&system)];
        history.extend(messages);
        (model, workspace_root, graph_json, session_id, history, mode)
    };

    // Per-session cancel flag: reset (or create fresh) for this session.
    let cancel = {
        let state = app.state::<AppState>();
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        state
            .session_cancels
            .lock()
            .unwrap()
            .insert(session_id.clone(), cancel.clone());
        cancel
    };

    let provider = llm::provider_for_model(&model);
    let needs_tool = tools::is_file_or_workspace_request(&content);

    let session_id_ret = session_id.clone();
    std::thread::spawn(move || {
        super::agent::run_agent_loop(
            app,
            provider,
            model,
            workspace_root,
            graph_json,
            session_id,
            history,
            cancel,
            needs_tool,
            mode,
        );
    });

    Ok(session_id_ret)
}

#[tauri::command]
pub async fn stop_chat_stream(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<(), String> {
    let cancels = state.session_cancels.lock().unwrap();
    match session_id {
        Some(sid) => {
            if let Some(c) = cancels.get(&sid) {
                c.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        None => {
            for c in cancels.values() {
                c.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn answer_question(state: State<'_, AppState>, answer: String) -> Result<(), String> {
    let entry = state.session_pending.lock().unwrap().take();
    match entry {
        Some((_sid, tx)) => {
            tx.send(answer)
                .map_err(|_| "worker no longer waiting".to_string())?;
            Ok(())
        }
        None => Err("no pending question".into()),
    }
}

#[tauri::command]
pub async fn get_history(state: State<'_, AppState>) -> Result<Vec<ChatMessage>, String> {
    let store = state.sessions.lock().unwrap();
    let current = state.current_session.lock().unwrap().clone();
    let events = store.load_events(&current)?;
    Ok(events
        .into_iter()
        .map(|e| event_to_message(e.kind, e.title, e.content))
        .collect())
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let current = state.current_session.lock().unwrap().clone();
    {
        let store = state.sessions.lock().unwrap();
        let _ = store.clear_events(&current);
    }
    state.session_histories.lock().unwrap().remove(&current);
    Ok(())
}

#[derive(Serialize)]
pub struct CompactResult {
    pub freed: usize,
    pub before: usize,
    pub after: usize,
}

#[tauri::command]
pub async fn compact_chat(app: AppHandle) -> Result<CompactResult, String> {
    tauri::async_runtime::spawn_blocking(move || compact_chat_blocking(&app))
        .await
        .map_err(|e| format!("compact task panicked: {e}"))?
}

fn compact_chat_blocking(app: &AppHandle) -> Result<CompactResult, String> {
    use crate::backend::tokens::count_tokens;
    const KEEP_RECENT: usize = 2;

    let msg_tokens = |msgs: &[Message]| -> usize {
        msgs.iter()
            .map(|m| {
                count_tokens(&m.content)
                    + m.tool_calls_json.as_deref().map(count_tokens).unwrap_or(0)
            })
            .sum()
    };

    let state = app.state::<AppState>();
    let session_id = state.current_session.lock().unwrap().clone();

    let (summarize_model, transcript, before) = {
        let histories = state.session_histories.lock().unwrap();
        let history = histories.get(&session_id).cloned().unwrap_or_default();
        if history.len() <= KEEP_RECENT + 1 {
            return Err("Conversation is too short to compact yet.".into());
        }
        let before = msg_tokens(&history);
        let split = history.len() - KEEP_RECENT;
        let transcript = history[..split]
            .iter()
            .map(|m| {
                let who = match m.role.as_str() {
                    "user" => "User",
                    "assistant" => "Assistant",
                    "tool" => "Tool result",
                    other => other,
                };
                format!("{who}: {}", m.content)
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let summarize_model = state.session_summarize_model(&session_id);
        (summarize_model, transcript, before)
    };

    let provider = llm::provider_for_model(&summarize_model);
    let prompt = format!(
        "Condense the following conversation into a tight summary (aim for under \
         150 words) that still preserves key facts, decisions, code snippets, \
         file paths, and open threads so the assistant can continue seamlessly. \
         Use compact bullet points.\n\n{transcript}"
    );
    let summary = provider.chat_simple(
        &summarize_model,
        "You summarize conversations to preserve context while reducing length.",
        &prompt,
        false,
    )?;

    let after = {
        let mut histories = state.session_histories.lock().unwrap();
        let history = histories.entry(session_id).or_default();
        if history.len() <= KEEP_RECENT + 1 {
            return Ok(CompactResult {
                freed: 0,
                before,
                after: before,
            });
        }
        let split = history.len() - KEEP_RECENT;
        let recent: Vec<Message> = history.split_off(split);
        history.clear();
        history.push(Message::user(&format!(
            "[Earlier conversation summary]\n{}",
            summary.trim()
        )));
        history.extend(recent);
        msg_tokens(history)
    };

    Ok(CompactResult {
        freed: before.saturating_sub(after),
        before,
        after,
    })
}

#[derive(Serialize)]
pub struct ContextSegment {
    pub label: String,
    pub tokens: usize,
}

#[derive(Serialize)]
pub struct ContextWindow {
    pub used: usize,
    pub total: usize,
    pub segments: Vec<ContextSegment>,
}

#[tauri::command]
pub async fn get_context_window(state: State<'_, AppState>) -> Result<ContextWindow, String> {
    use crate::backend::tokens::count_tokens;

    let session_id = state.current_session.lock().unwrap().clone();
    let model = state.session_chat_model(&session_id);
    let provider = llm::provider_for_model(&model);
    let total = provider.context_length(&model);

    // Skills are appended to the system prompt at send time, but the meter
    // accounts for them separately so enabling skills shows its real cost.
    let skills_tokens =
        count_tokens(&crate::backend::skills::SkillRegistry::skills_prompt_section());
    let system_tokens = count_tokens(&crate::backend::prompt::base_system_prompt());
    let chat_mode =
        state.session_agent_mode(&session_id) == crate::backend::review::AgentMode::Chat;
    // Native and MCP tools go to the model as one array, but we account for them
    // separately so the meter shows how much MCP servers add to the context.
    let native_tools_json = if chat_mode {
        tools::tools_json_filtered(tools::CHAT_MODE_TOOLS)
    } else {
        tools::tools_json().to_string()
    };
    let tools_tokens = count_tokens(&native_tools_json);
    let mcp_schema = state.mcp.tools_schema(chat_mode);
    let mcp_tools_tokens = if mcp_schema.is_empty() {
        0
    } else {
        count_tokens(&serde_json::to_string(&mcp_schema).unwrap_or_default())
    };

    let messages_tokens = {
        let histories = state.session_histories.lock().unwrap();
        histories
            .get(&session_id)
            .map(|h| {
                h.iter()
                    .map(|m| {
                        let mut t = count_tokens(&m.content);
                        if let Some(tc) = &m.tool_calls_json {
                            t += count_tokens(tc);
                        }
                        t
                    })
                    .sum()
            })
            .unwrap_or(0)
    };

    let used = system_tokens + skills_tokens + tools_tokens + mcp_tools_tokens + messages_tokens;
    let mut segments = vec![
        ContextSegment {
            label: "Messages".into(),
            tokens: messages_tokens,
        },
        ContextSegment {
            label: "Tools".into(),
            tokens: tools_tokens,
        },
        ContextSegment {
            label: "MCP tools".into(),
            tokens: mcp_tools_tokens,
        },
        ContextSegment {
            label: "Skills".into(),
            tokens: skills_tokens,
        },
        ContextSegment {
            label: "System prompt".into(),
            tokens: system_tokens,
        },
    ];
    segments.retain(|s| s.tokens > 0);
    segments.push(ContextSegment {
        label: "Free space".into(),
        tokens: total.saturating_sub(used),
    });

    Ok(ContextWindow {
        used,
        total,
        segments,
    })
}

/// The current system prompt for the inspector modal: the live text plus
/// whether it's a user-set override (vs. the built-in default).
#[derive(Serialize)]
pub struct SystemPromptInfo {
    pub text: String,
    pub is_custom: bool,
    /// The built-in default, so the modal can preview/restore it without a
    /// second round-trip.
    pub default_text: String,
    /// Active skills section appended at send time — shown read-only in the
    /// inspector (it's part of the prompt, but not editable there).
    pub skills_text: String,
}

#[tauri::command]
pub async fn get_system_prompt() -> Result<SystemPromptInfo, String> {
    Ok(SystemPromptInfo {
        // Base prompt only — active skills are appended at send time and
        // accounted for separately (the "Skills" context segment); showing
        // them here would let an Edit+Save bake them into the override.
        text: crate::backend::prompt::base_system_prompt(),
        is_custom: crate::backend::config::system_prompt_override().is_some(),
        default_text: crate::backend::prompt::default_system_prompt(),
        skills_text: crate::backend::skills::SkillRegistry::skills_prompt_section()
            .trim()
            .to_string(),
    })
}

/// Saves a custom system prompt that overrides the default on every turn.
/// If the text matches the built-in default (ignoring leading/trailing
/// whitespace), the override is cleared instead — so saving an unchanged prompt
/// doesn't leave the session marked "custom". Returns whether an override
/// remains active.
#[tauri::command]
pub async fn set_system_prompt(text: String) -> Result<bool, String> {
    let default = crate::backend::prompt::default_system_prompt();
    if text.trim() == default.trim() {
        crate::backend::config::clear_system_prompt_override();
        Ok(false)
    } else {
        crate::backend::config::save_system_prompt_override(&text);
        Ok(true)
    }
}

/// Clears any custom prompt and returns the built-in default text.
#[tauri::command]
pub async fn reset_system_prompt() -> Result<String, String> {
    crate::backend::config::clear_system_prompt_override();
    Ok(crate::backend::prompt::default_system_prompt())
}

/// Persist a composer-attached image into `.micelio/attachments/` (gitignored)
/// and return its workspace-relative path. The chat model then `vision`-tools
/// that path to see it — keeping the chat model as the orchestrator.
#[tauri::command]
pub async fn save_attachment(
    state: State<'_, AppState>,
    data_base64: String,
    ext: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("decode attachment: {e}"))?;
    let root = state.workspace_root.lock().unwrap().clone();
    let dir = root.join(".micelio/attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create attachments dir: {e}"))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let safe_ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let safe_ext = if safe_ext.is_empty() {
        "png".to_string()
    } else {
        safe_ext.to_lowercase()
    };
    let rel = format!(".micelio/attachments/{ts:x}.{safe_ext}");
    std::fs::write(root.join(&rel), &bytes).map_err(|e| format!("write attachment: {e}"))?;
    Ok(rel)
}

/// One entry in the compacted context the model actually receives.
#[derive(Serialize)]
pub struct TranscriptItem {
    /// "system", "tools", or a message role ("user"/"assistant"/"tool").
    pub role: String,
    pub content: String,
    pub tool_calls_json: Option<String>,
    pub tool_name: Option<String>,
    pub tokens: usize,
}

#[derive(Serialize)]
pub struct Transcript {
    pub model: String,
    pub used: usize,
    pub total: usize,
    pub items: Vec<TranscriptItem>,
}

/// The exact, compacted context window sent to the model this session: system
/// prompt + tool definitions + the (already-compacted) message history. Backs
/// the in-chat "transcript mode".
#[tauri::command]
pub async fn get_transcript(state: State<'_, AppState>) -> Result<Transcript, String> {
    use crate::backend::tokens::count_tokens;

    let session_id = state.current_session.lock().unwrap().clone();
    let model = state.session_chat_model(&session_id);
    let provider = llm::provider_for_model(&model);
    let total = provider.context_length(&model);

    let mut items = Vec::new();

    let system = crate::backend::prompt::system_prompt();
    let system_tokens = count_tokens(&system);
    items.push(TranscriptItem {
        role: "system".into(),
        content: system,
        tool_calls_json: None,
        tool_name: None,
        tokens: system_tokens,
    });

    let chat_mode =
        state.session_agent_mode(&session_id) == crate::backend::review::AgentMode::Chat;
    let tools = tools::all_tools_json(Some(&state.mcp), chat_mode);
    let tools_tokens = count_tokens(&tools);
    if tools_tokens > 0 && tools.trim() != "[]" {
        items.push(TranscriptItem {
            role: "tools".into(),
            content: tools,
            tool_calls_json: None,
            tool_name: None,
            tokens: tools_tokens,
        });
    }

    {
        let histories = state.session_histories.lock().unwrap();
        if let Some(h) = histories.get(&session_id) {
            for m in h {
                let mut tokens = count_tokens(&m.content);
                if let Some(tc) = &m.tool_calls_json {
                    tokens += count_tokens(tc);
                }
                items.push(TranscriptItem {
                    role: m.role.clone(),
                    content: m.content.clone(),
                    tool_calls_json: m.tool_calls_json.clone(),
                    tool_name: m.tool_name.clone(),
                    tokens,
                });
            }
        }
    }

    let used = items.iter().map(|i| i.tokens).sum();
    Ok(Transcript {
        model,
        used,
        total,
        items,
    })
}
