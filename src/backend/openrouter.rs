//! OpenRouter backend — an OpenAI-compatible gateway to Claude, GPT,
//! DeepSeek, Gemini, Llama, etc. behind one key. Implements the
//! provider-agnostic [`crate::backend::llm`] layer.
//!
//! Supports function calling (tools) using OpenAI-compatible format.

#![allow(dead_code)]

use crate::backend::config;
use crate::backend::error::{BackendError, BackendResult};
use crate::backend::llm::{
    AssistantResponse, ChatStream, Message, ModelChoice, Provider, ProviderKind, StreamEvent,
    ToolCall,
};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const BASE: &str = "https://openrouter.ai/api/v1";

/// model id -> context_length, filled by `list_models`.
fn ctx_cache() -> &'static Mutex<HashMap<String, usize>> {
    static C: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct OpenRouterProvider;

impl Provider for OpenRouterProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::OpenRouter
    }
    fn name(&self) -> &'static str {
        "openrouter"
    }

    fn list_models(&self) -> BackendResult<Vec<ModelChoice>> {
        // No key = provider simply off; contribute nothing to the catalog.
        let Some(key) = config::openrouter_key() else {
            return Ok(Vec::new());
        };
        let resp = ureq::get(&format!("{BASE}/models"))
            .set("Authorization", &format!("Bearer {key}"))
            .call()
            .map_err(|e| BackendError::Provider(format!("openrouter models: {e}")))?;
        let json: serde_json::Value = resp
            .into_json()
            .map_err(|e| BackendError::Provider(format!("openrouter models parse: {e}")))?;
        let mut out = Vec::new();
        if let Some(arr) = json["data"].as_array() {
            if let Ok(mut cache) = ctx_cache().lock() {
                for m in arr {
                    if let Some(id) = m["id"].as_str() {
                        // Vision = the model lists "image" among its accepted
                        // input modalities (OpenRouter exposes this per model).
                        let vision = m["architecture"]["input_modalities"]
                            .as_array()
                            .map(|mods| mods.iter().any(|x| x.as_str() == Some("image")))
                            .unwrap_or(false);
                        out.push(ModelChoice {
                            name: id.to_string(),
                            vision,
                        });
                        if let Some(ctx) = m["context_length"].as_u64() {
                            cache.insert(id.to_string(), ctx as usize);
                        }
                    }
                }
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn context_length(&self, model: &str) -> usize {
        ctx_cache()
            .lock()
            .ok()
            .and_then(|c| c.get(model).copied())
            .unwrap_or(128_000)
    }

    fn chat(
        &self,
        model: &str,
        history: &[Message],
        debug: bool,
    ) -> BackendResult<AssistantResponse> {
        let key = require_key()?;
        let mut body = serde_json::json!({
            "model": model,
            "messages": to_openai_messages(history),
            "stream": false,
        });
        // Include tools in the request if any are defined.
        let tools_json = crate::backend::tools::tools_json();
        if !tools_json.trim().is_empty() && tools_json != "[]" {
            if let Ok(tools) = serde_json::from_str::<Vec<serde_json::Value>>(tools_json) {
                if !tools.is_empty() {
                    body["tools"] = serde_json::Value::Array(tools);
                }
            }
        }
        let json = post_json(&key, "/chat/completions", body, debug)?;
        let msg = &json["choices"][0]["message"];
        let content = msg["content"].as_str().unwrap_or("").to_string();
        // DeepSeek-R1 and friends expose reasoning here.
        let thinking = msg["reasoning_content"]
            .as_str()
            .or_else(|| msg["reasoning"].as_str())
            .unwrap_or("")
            .to_string();
        // Extract tool calls if present.
        let tool_call = extract_tool_call(msg);
        Ok(AssistantResponse {
            content,
            thinking,
            tool_call,
        })
    }

    fn chat_simple(
        &self,
        model: &str,
        system: &str,
        user: &str,
        debug: bool,
    ) -> BackendResult<String> {
        let key = require_key()?;
        let body = serde_json::json!({
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": false,
        });
        let json = post_json(&key, "/chat/completions", body, debug)?;
        Ok(json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }

    fn describe_image(
        &self,
        model: &str,
        image_base64: &str,
        mime: &str,
        prompt: &str,
        debug: bool,
    ) -> BackendResult<String> {
        let key = require_key()?;
        // OpenAI/OpenRouter multimodal format: the user message content is an
        // array mixing text and image_url parts (image as a data URL).
        let body = serde_json::json!({
            "model": model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": format!("data:{mime};base64,{image_base64}")}},
                ],
            }],
            "stream": false,
        });
        let json = post_json(&key, "/chat/completions", body, debug)?;
        Ok(json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }

    fn start_stream(&self, model: &str, history: &[Message]) -> BackendResult<Box<dyn ChatStream>> {
        let key = require_key()?;
        let mut body = serde_json::json!({
            "model": model,
            "messages": to_openai_messages(history),
            "stream": true,
            // Ask OpenRouter to stream reasoning tokens for models that
            // support it (Claude extended thinking, DeepSeek-R1, etc.).
            // Ignored by models without reasoning.
            "reasoning": { "enabled": true },
            // Ask for token usage + cost in the final stream chunk.
            "usage": { "include": true },
        });
        let tools_json = crate::backend::tools::tools_json();
        if !tools_json.trim().is_empty() && tools_json != "[]" {
            if let Ok(tools) = serde_json::from_str::<Vec<serde_json::Value>>(tools_json) {
                if !tools.is_empty() {
                    body["tools"] = serde_json::Value::Array(tools);
                }
            }
        }

        let req_body_raw = serde_json::to_string_pretty(&body).unwrap_or_default();

        // The POST blocks only until response headers arrive (fast); the body
        // is read incrementally on a worker thread feeding the channel.
        let resp = ureq::post(&format!("{BASE}/chat/completions"))
            .set("Authorization", &format!("Bearer {key}"))
            .set(
                "HTTP-Referer",
                "https://github.com/patrick-mns/minimal-context",
            )
            .set("X-Title", "Micelio Code")
            .set("Accept", "text/event-stream")
            .send_json(body);
        let resp = match resp {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) => {
                let detail = r.into_string().unwrap_or_default();
                return Err(BackendError::Http {
                    status: code,
                    detail,
                });
            }
            Err(e) => return Err(BackendError::Provider(format!("openrouter: {e}"))),
        };

        let (tx, rx) = std::sync::mpsc::channel();
        let _ = tx.send(StreamEvent::RequestBody(req_body_raw));
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(resp.into_reader());
            // Tool calls arrive fragmented across deltas, and a model may emit
            // several in parallel — distinguished by `index`. Accumulate one
            // (name, args, id) slot per index.
            let mut tool_slots: Vec<(String, String, Option<String>)> = Vec::new();
            // Full raw SSE stream, for the Turn detail "raw response" view.
            let mut raw_resp = String::new();

            for line in reader.lines() {
                let Ok(line) = line else { break };
                raw_resp.push_str(&line);
                raw_resp.push('\n');
                let Some(data) = line.strip_prefix("data: ") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    break;
                }
                let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };

                // Usage/cost arrives in a trailing chunk (often with no choices).
                if let Some(u) = json.get("usage").filter(|u| !u.is_null()) {
                    // Provider may report a per-direction cost split under
                    // `cost_details`; keys vary, so probe the common ones.
                    let cd = &u["cost_details"];
                    let prompt_cost = cd["upstream_inference_prompt_cost"]
                        .as_f64()
                        .or_else(|| cd["prompt_cost"].as_f64())
                        .or_else(|| cd["input_cost"].as_f64());
                    let completion_cost = cd["upstream_inference_completions_cost"]
                        .as_f64()
                        .or_else(|| cd["completion_cost"].as_f64())
                        .or_else(|| cd["output_cost"].as_f64());
                    let _ = tx.send(StreamEvent::Usage(crate::backend::llm::Usage {
                        prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0),
                        completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
                        cost: u["cost"].as_f64().unwrap_or(0.0),
                        prompt_cost,
                        completion_cost,
                        raw: serde_json::to_string_pretty(u).ok(),
                        model: None,
                    }));
                }

                let delta = &json["choices"][0]["delta"];

                if let Some(c) = delta["content"].as_str() {
                    if !c.is_empty() {
                        let _ = tx.send(StreamEvent::Content(c.to_string()));
                    }
                }
                if let Some(r) = delta["reasoning"]
                    .as_str()
                    .or_else(|| delta["reasoning_content"].as_str())
                {
                    if !r.is_empty() {
                        let _ = tx.send(StreamEvent::Thinking(r.to_string()));
                    }
                }
                // Tool-call deltas: name comes once, arguments in fragments,
                // each entry tagged with its `index` for parallel calls.
                if let Some(calls) = delta["tool_calls"].as_array() {
                    for call in calls {
                        let index = call["index"].as_u64().unwrap_or(0) as usize;
                        while tool_slots.len() <= index {
                            tool_slots.push((String::new(), String::new(), None));
                        }
                        let slot = &mut tool_slots[index];
                        if let Some(id) = call["id"].as_str() {
                            if !id.is_empty() {
                                slot.2 = Some(id.to_string());
                            }
                        }
                        // Some providers repeat the name across deltas — only
                        // capture it once so we don't get "filefilefile".
                        if slot.0.is_empty() {
                            if let Some(n) = call["function"]["name"].as_str() {
                                slot.0.push_str(n);
                            }
                        }
                        if let Some(a) = call["function"]["arguments"].as_str() {
                            slot.1.push_str(a);
                        }
                    }
                }
            }

            for (name, args, id) in tool_slots {
                if name.is_empty() {
                    continue;
                }
                let _ = tx.send(StreamEvent::ToolCall(ToolCall {
                    name,
                    arguments: if args.is_empty() { "{}".into() } else { args },
                    id,
                }));
            }
            let _ = tx.send(StreamEvent::ResponseRaw(raw_resp));
            let _ = tx.send(StreamEvent::Done);
        });

        Ok(Box::new(SseStream { rx }))
    }

    fn tool_calls_history_json(&self, calls: &[ToolCall]) -> String {
        // OpenAI format requires `arguments` to be a STRING (the JSON text),
        // not an inline object. Build via serde so the string is escaped
        // correctly — a hand-rolled format! would inject the args as a raw
        // object and corrupt the history on the next request.
        let arr: Vec<serde_json::Value> = calls
            .iter()
            .map(|call| {
                let id = call.id.as_deref().unwrap_or("call_unknown");
                serde_json::json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": call.arguments,
                    }
                })
            })
            .collect();
        serde_json::Value::Array(arr).to_string()
    }
}

fn require_key() -> BackendResult<String> {
    config::openrouter_key().ok_or_else(|| {
        BackendError::Provider("no OpenRouter API key set (Settings → Providers)".into())
    })
}

/// Extract the first tool call from an OpenAI-format message, if present.
fn extract_tool_call(msg: &serde_json::Value) -> Option<ToolCall> {
    msg["tool_calls"]
        .as_array()
        .and_then(|calls| calls.first())
        .and_then(|call| {
            let func = &call["function"];
            let name = func["name"].as_str()?.to_string();
            // `arguments` is normally a JSON string, but some providers
            // (Claude via OpenRouter/Bedrock/Vertex) hand it back as an inline
            // JSON object. Accept both: serialize an object to its JSON text so
            // the tool's field parser still finds `path`, `command`, etc.
            let arguments = match &func["arguments"] {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Null => "{}".to_string(),
                other => other.to_string(),
            };
            let id = call["id"].as_str().map(|s| s.to_string());
            Some(ToolCall {
                name,
                arguments,
                id,
            })
        })
}

/// Maps our history to OpenAI chat messages. Preserves tool_calls from
/// assistant messages and uses proper OpenAI tool message format.
///
/// Strict APIs (Anthropic via OpenRouter) reject a `tool_use` that isn't
/// immediately followed by its `tool_result`. We track the open tool_call
/// ids from each assistant turn and, before moving on to any non-tool
/// message (or at the end), synthesize a placeholder `tool` result for any
/// that went unanswered — so a cancelled/failed turn can't poison the whole
/// conversation.
fn to_openai_messages(history: &[Message]) -> Vec<serde_json::Value> {
    let mut result = Vec::new();
    // tool_call ids from the last assistant turn still awaiting a result.
    let mut pending_ids: Vec<String> = Vec::new();

    fn flush_pending(result: &mut Vec<serde_json::Value>, pending: &mut Vec<String>) {
        for id in pending.drain(..) {
            result.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": id,
                "name": "unknown",
                "content": "(no result — tool did not complete)",
            }));
        }
    }

    for m in history {
        match m.role.as_str() {
            "tool" => {
                let mut msg = serde_json::json!({
                    "role": "tool",
                    "content": m.content,
                    "name": m.tool_name.as_deref().unwrap_or("unknown"),
                });
                // Pair with the next open tool_call id (FIFO).
                if !pending_ids.is_empty() {
                    msg["tool_call_id"] = serde_json::Value::String(pending_ids.remove(0));
                }
                result.push(msg);
            }
            other => {
                // Any non-tool message means the previous assistant's tool
                // calls are done being answered — fill any gaps first.
                flush_pending(&mut result, &mut pending_ids);

                match other {
                    "system" => {
                        result.push(serde_json::json!({"role": "system", "content": m.content}));
                    }
                    "assistant" => {
                        let mut msg = serde_json::json!({
                            "role": "assistant",
                            "content": m.content,
                        });
                        if let Some(ref tc_json) = m.tool_calls_json {
                            if let Ok(tool_calls) =
                                serde_json::from_str::<Vec<serde_json::Value>>(tc_json)
                            {
                                if !tool_calls.is_empty() {
                                    // Track every tool_call id so each gets a result.
                                    for call in &tool_calls {
                                        if let Some(id) = call["id"].as_str() {
                                            pending_ids.push(id.to_string());
                                        }
                                    }
                                    msg["tool_calls"] = serde_json::Value::Array(tool_calls);
                                }
                            }
                        }
                        result.push(msg);
                    }
                    _ => {
                        result.push(serde_json::json!({"role": "user", "content": m.content}));
                    }
                }
            }
        }
    }
    // Conversation ends with unanswered tool calls (e.g. cancelled mid-run).
    flush_pending(&mut result, &mut pending_ids);
    result
}

fn post_json(
    key: &str,
    path: &str,
    body: serde_json::Value,
    debug: bool,
) -> BackendResult<serde_json::Value> {
    if debug {
        println!("[openrouter] POST {path}\n{body}");
    }
    let result = ureq::post(&format!("{BASE}{path}"))
        .set("Authorization", &format!("Bearer {key}"))
        // OpenRouter attribution headers (optional but recommended).
        .set(
            "HTTP-Referer",
            "https://github.com/patrick-mns/minimal-context",
        )
        .set("X-Title", "Micelio Code")
        .send_json(body);
    match result {
        Ok(resp) => resp
            .into_json()
            .map_err(|e| BackendError::Provider(format!("openrouter parse: {e}"))),
        Err(ureq::Error::Status(code, resp)) => {
            let detail = resp.into_string().unwrap_or_default();
            Err(BackendError::Http {
                status: code,
                detail,
            })
        }
        Err(e) => Err(BackendError::Provider(format!("openrouter: {e}"))),
    }
}

/// Real SSE stream: a background thread reads the chunked response and pushes
/// decoded events into this channel. `poll` drains whatever has arrived
/// (non-blocking), matching the [`ChatStream`] contract.
struct SseStream {
    rx: std::sync::mpsc::Receiver<StreamEvent>,
}

impl ChatStream for SseStream {
    fn poll(&mut self) -> BackendResult<Vec<StreamEvent>> {
        let mut events = Vec::new();
        while let Ok(ev) = self.rx.try_recv() {
            events.push(ev);
        }
        Ok(events)
    }
}
