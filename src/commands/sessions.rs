use crate::backend::llm::Message;
use crate::commands::chat::ChatMessage;
use crate::AppState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Default)]
pub struct ModelStat {
    pub model: String,
    pub provider: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cost: f64,
    pub turns: u64,
}

#[derive(Serialize, Default)]
pub struct UsageStats {
    pub total_cost: f64,
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
    pub total_turns: u64,
    pub by_model: Vec<ModelStat>,
}

#[tauri::command]
pub async fn get_usage_stats(
    state: State<'_, AppState>,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<UsageStats, String> {
    let store = state.sessions.lock().unwrap();
    let rows = store.usage_by_model(from, to)?;

    let mut by_model: Vec<ModelStat> = rows
        .into_iter()
        .map(|(model, pt, ct, cost, turns)| {
            let provider = crate::backend::llm::provider_kind_for_model(&model)
                .map(|k| format!("{k:?}").to_lowercase())
                .unwrap_or_else(|| "unknown".to_string());
            ModelStat {
                model,
                provider,
                prompt_tokens: pt as u64,
                completion_tokens: ct as u64,
                cost,
                turns: turns as u64,
            }
        })
        .collect();

    by_model.sort_by(|a, b| {
        b.cost
            .partial_cmp(&a.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let total_cost = by_model.iter().map(|m| m.cost).sum();
    let total_prompt_tokens = by_model.iter().map(|m| m.prompt_tokens).sum();
    let total_completion_tokens = by_model.iter().map(|m| m.completion_tokens).sum();
    let total_turns = by_model.iter().map(|m| m.turns).sum();

    Ok(UsageStats {
        total_cost,
        total_prompt_tokens,
        total_completion_tokens,
        total_turns,
        by_model,
    })
}

#[tauri::command]
pub async fn clear_usage(state: State<'_, AppState>) -> Result<(), String> {
    let store = state.sessions.lock().unwrap();
    Ok(store.clear_usage()?)
}

#[derive(Serialize)]
pub struct UsageLogEntry {
    pub id: i64,
    pub ts: i64,
    pub session_id: String,
    pub session_title: String,
    pub model: String,
    pub provider: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cost: f64,
    pub duration_ms: u64,
    pub request: String,
    pub response: String,
    pub prompt_cost: Option<f64>,
    pub completion_cost: Option<f64>,
    pub request_raw: String,
    pub response_raw: String,
}

#[tauri::command]
pub async fn get_usage_log(
    state: State<'_, AppState>,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<UsageLogEntry>, String> {
    let store = state.sessions.lock().unwrap();
    let rows = store.usage_log(from, to, 500)?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let provider = crate::backend::llm::provider_kind_for_model(&r.model)
                .map(|k| format!("{k:?}").to_lowercase())
                .unwrap_or_else(|| "unknown".to_string());
            UsageLogEntry {
                id: r.id,
                ts: r.ts,
                session_id: r.session_id,
                session_title: r.session_title,
                model: r.model,
                provider,
                prompt_tokens: r.prompt_tokens as u64,
                completion_tokens: r.completion_tokens as u64,
                cost: r.cost,
                duration_ms: r.duration_ms as u64,
                request: r.request,
                response: r.response,
                prompt_cost: r.prompt_cost,
                completion_cost: r.completion_cost,
                request_raw: r.request_raw,
                response_raw: r.response_raw,
            }
        })
        .collect())
}

#[derive(Serialize)]
pub struct UsageRaw {
    pub request: String,
    pub response: String,
    pub request_raw: String,
    pub response_raw: String,
}

/// Heavy request/response payloads for one ledger row, fetched on demand when
/// the detail panel opens (the list query omits them to stay fast).
#[tauri::command]
pub async fn get_usage_raw(state: State<'_, AppState>, id: i64) -> Result<UsageRaw, String> {
    let store = state.sessions.lock().unwrap();
    let (request, response, request_raw, response_raw) = store.usage_raw(id)?;
    Ok(UsageRaw {
        request,
        response,
        request_raw,
        response_raw,
    })
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub message_count: usize,
    pub active: bool,
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, String> {
    let store = state.sessions.lock().unwrap();
    let current = state.current_session.lock().unwrap().clone();
    let metas = store.list_sessions()?;
    Ok(metas
        .into_iter()
        .map(|m| SessionInfo {
            active: m.id == current,
            id: m.id,
            title: m.title,
            message_count: m.event_count,
        })
        .collect())
}

#[tauri::command]
pub async fn new_session(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let model = state.chat_model();
    let id = {
        let store = state.sessions.lock().unwrap();
        store.create_session("New session", &model)?
    };
    *state.current_session.lock().unwrap() = id.clone();
    state.session_histories.lock().unwrap().remove(&id);
    let _ = app.emit("session_created", serde_json::json!({ "session_id": id }));
    Ok(id)
}

#[tauri::command]
pub async fn switch_session(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<ChatMessage>, String> {
    let (history_json, events) = {
        let store = state.sessions.lock().unwrap();
        (store.load_history(&id)?, store.load_events(&id)?)
    };

    let model_history: Vec<Message> = serde_json::from_str(&history_json).unwrap_or_default();
    state
        .session_histories
        .lock()
        .unwrap()
        .insert(id.clone(), model_history);
    *state.current_session.lock().unwrap() = id;

    Ok(events
        .into_iter()
        .map(|e| crate::commands::chat::event_to_message(e.kind, e.title, e.content))
        .collect())
}

/// Per-session model assignments (chat / summarize / vision). Empty means "use
/// the global default".
#[derive(Serialize)]
pub struct SessionModels {
    pub chat: String,
    pub summarize: String,
    pub vision: String,
}

/// Resolve the models pinned to a session — returns the per-session values (or
/// empty strings for unset). The caller should fall back to globals when empty.
#[tauri::command]
pub async fn get_session_models(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionModels, String> {
    let store = state.sessions.lock().unwrap();
    Ok(SessionModels {
        chat: store.session_model(&session_id, "chat"),
        summarize: store.session_model(&session_id, "summarize"),
        vision: store.session_model(&session_id, "vision"),
    })
}

/// Pin a model to a role for a specific session. Pass an empty `model` to unset
/// the pin (reverting to the global default for that role).
#[tauri::command]
pub async fn set_session_model(
    state: State<'_, AppState>,
    session_id: String,
    role: String,
    model: String,
) -> Result<(), String> {
    let store = state.sessions.lock().unwrap();
    store.set_session_model(&session_id, &role, &model)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_session(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let store = state.sessions.lock().unwrap();
    store.delete_session(&id)?;

    // Clean up in-memory state for the deleted session.
    state.session_histories.lock().unwrap().remove(&id);
    state.session_cancels.lock().unwrap().remove(&id);

    let mut current = state.current_session.lock().unwrap();
    if *current == id {
        let next = match store.latest_session_id()? {
            Some(latest) => {
                let hist: Vec<Message> = store
                    .load_history(&latest)
                    .ok()
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default();
                state
                    .session_histories
                    .lock()
                    .unwrap()
                    .insert(latest.clone(), hist);
                latest
            }
            None => String::new(),
        };
        *current = next.clone();
        let _ = app.emit("session_switched", serde_json::json!({ "session_id": next }));
        return Ok(next);
    }
    Ok(current.clone())
}
