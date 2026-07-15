//! OpenAI-compatible provider — a reusable backend for any service that
//! speaks the OpenAI Chat Completions wire format (/v1/chat/completions,
//! /v1/models, SSE streaming, function/tool calling).
//!
//! Instances are built at runtime from [`config::ProviderConfig`], one per
//! endpoint the user configured (OpenRouter, LiteLLM, vLLM, llama.cpp, …), so
//! adding a gateway is data, not code.

#![allow(dead_code)]

use crate::backend::config::{ProviderConfig, ProviderFlavor};
use crate::backend::error::{BackendError, BackendResult};
use crate::backend::llm::{
    AssistantResponse, ChatStream, Message, ModelChoice, Provider, StreamEvent, ToolCall,
};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

// ── Params & ctx cache ──────────────────────────────────────────────────────────

/// model id -> context_length, filled by `list_models`.
fn ctx_cache() -> &'static Mutex<HashMap<String, usize>> {
    static C: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct OpenAiCompatProvider {
    /// Stable id of the configured endpoint (matches `ProviderConfig::id`).
    id: String,
    /// Display label shown as the catalog section header.
    label: String,
    /// Base URL for this endpoint (may include the /v1 path).
    base_url: String,
    /// API key, or `None` when the endpoint needs no auth (local vLLM etc.) —
    /// in that case no Authorization header is sent.
    api_key: Option<String>,
    /// Whether to include OpenRouter-specific request fields (`reasoning`,
    /// `usage`) and attribution headers (Referer, X-Title).
    openrouter_extensions: bool,
}

impl OpenAiCompatProvider {
    /// Build a live provider from a configured endpoint.
    pub fn from_config(c: &ProviderConfig) -> Self {
        let key = c.api_key.trim();
        Self {
            id: c.id.clone(),
            label: c.name.clone(),
            base_url: c.base_url.trim().trim_end_matches('/').to_string(),
            api_key: (!key.is_empty()).then(|| key.to_string()),
            openrouter_extensions: c.flavor == ProviderFlavor::Openrouter,
        }
    }

    /// Apply auth + vendor headers to a request. A keyless endpoint gets no
    /// Authorization header rather than being disabled.
    fn with_headers(&self, req: ureq::Request) -> ureq::Request {
        let mut req = match &self.api_key {
            Some(key) => req.set("Authorization", &format!("Bearer {key}")),
            None => req,
        };
        if self.openrouter_extensions {
            req = req
                .set(
                    "HTTP-Referer",
                    "https://github.com/patrick-mns/minimal-context",
                )
                .set("X-Title", "Micelio Code");
        }
        req
    }
}

impl Provider for OpenAiCompatProvider {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn label(&self) -> String {
        self.label.clone()
    }

    fn list_models(&self) -> BackendResult<Vec<ModelChoice>> {
        if self.base_url.is_empty() {
            return Ok(Vec::new());
        }
        let resp = self
            .with_headers(ureq::get(&format!("{}/models", self.base_url)))
            .call()
            .map_err(|e| BackendError::Provider(format!("{} models: {e}", self.label)))?;
        let json: serde_json::Value = resp
            .into_json()
            .map_err(|e| BackendError::Provider(format!("{} models parse: {e}", self.label)))?;
        let mut out = Vec::new();
        if let Some(arr) = json["data"].as_array() {
            if let Ok(mut cache) = ctx_cache().lock() {
                for m in arr {
                    if let Some(id) = m["id"].as_str() {
                        let vision = m["architecture"]["input_modalities"]
                            .as_array()
                            .map(|mods| mods.iter().any(|x| x.as_str() == Some("image")))
                            .unwrap_or(false);
                        out.push(ModelChoice {
                            name: id.to_string(),
                            vision,
                        });
                        // Populate context-length cache (default 0 if missing).
                        let ctx = m["context_length"].as_u64().unwrap_or(0) as usize;
                        cache.insert(id.to_string(), ctx);
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
        let body = serde_json::json!({
            "model": model,
            "messages": to_openai_messages(history),
            "stream": false,
        });
        let tools_json = crate::backend::tools::tools_json();
        if !tools_json.trim().is_empty() && tools_json != "[]" {
            if let Ok(tools) = serde_json::from_str::<Vec<serde_json::Value>>(tools_json) {
                if !tools.is_empty() {
                    let _body = body;
                    // tools go into a new object so we can mutate it
                    let mut b = _body;
                    b["tools"] = serde_json::Value::Array(tools);
                    let json = self.post_json("/chat/completions", b, debug)?;
                    let msg = &json["choices"][0]["message"];
                    let content = msg["content"].as_str().unwrap_or("").to_string();
                    let thinking = msg["reasoning_content"]
                        .as_str()
                        .or_else(|| msg["reasoning"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let tool_call = extract_tool_call(msg);
                    return Ok(AssistantResponse {
                        content,
                        thinking,
                        tool_call,
                    });
                }
            }
        }
        let json = self.post_json("/chat/completions", body, debug)?;
        let msg = &json["choices"][0]["message"];
        let content = msg["content"].as_str().unwrap_or("").to_string();
        let thinking = msg["reasoning_content"]
            .as_str()
            .or_else(|| msg["reasoning"].as_str())
            .unwrap_or("")
            .to_string();
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
        let body = serde_json::json!({
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": false,
        });
        let json = self.post_json("/chat/completions", body, debug)?;
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
        let json = self.post_json("/chat/completions", body, debug)?;
        Ok(json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }

    fn start_stream(
        &self,
        model: &str,
        history: &[Message],
        tools_json: &str,
    ) -> BackendResult<Box<dyn ChatStream>> {
        let mut body = serde_json::json!({
            "model": model,
            "messages": to_openai_messages(history),
            "stream": true,
        });

        // OpenRouter-specific extensions: reasoning streaming + usage in the
        // final chunk.  Harmless for other providers (they simply ignore them).
        if self.openrouter_extensions {
            body["reasoning"] = serde_json::json!({ "enabled": true });
            body["usage"] = serde_json::json!({ "include": true });
        }

        // Advertise only the tools the caller passed (already mode-filtered).
        // An empty list omits tools entirely so the model can only reply text.
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
        let req = self.with_headers(ureq::post(&format!("{}/chat/completions", self.base_url)));
        let resp = req.set("Accept", "text/event-stream").send_json(body);
        let resp = match resp {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) => {
                let detail = r.into_string().unwrap_or_default();
                return Err(BackendError::Http {
                    status: code,
                    detail,
                });
            }
            Err(e) => return Err(BackendError::Provider(format!("{}: {e}", self.label))),
        };

        let (tx, rx) = std::sync::mpsc::channel();
        let _ = tx.send(StreamEvent::RequestBody(req_body_raw));
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(resp.into_reader());
            let mut tool_slots: Vec<(String, String, Option<String>)> = Vec::new();
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

                if let Some(u) = json.get("usage").filter(|u| !u.is_null()) {
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

            // Flush any accumulated tool calls.
            for (name, arguments, id) in &tool_slots {
                if !name.is_empty() {
                    let _ = tx.send(StreamEvent::ToolCall(ToolCall {
                        name: name.clone(),
                        arguments: arguments.clone(),
                        id: id.clone(),
                    }));
                }
            }

            let _ = tx.send(StreamEvent::ResponseRaw(raw_resp));
            let _ = tx.send(StreamEvent::Done);
        });

        Ok(Box::new(SseStream { rx }))
    }

    /// Re-serialize a finished tool call's arguments + id into the OpenAI wire
    /// format the next request expects.
    fn tool_calls_history_json(&self, calls: &[ToolCall]) -> String {
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

impl OpenAiCompatProvider {
    fn post_json(
        &self,
        path: &str,
        body: serde_json::Value,
        debug: bool,
    ) -> BackendResult<serde_json::Value> {
        if debug {
            println!("[{}] POST {path}\n{body}", self.label);
        }
        let req = self.with_headers(ureq::post(&format!("{}{}", self.base_url, path)));
        let result = req.send_json(body);
        match result {
            Ok(resp) => resp
                .into_json()
                .map_err(|e| BackendError::Provider(format!("{} parse: {e}", self.label))),
            Err(ureq::Error::Status(code, resp)) => {
                let detail = resp.into_string().unwrap_or_default();
                Err(BackendError::Http {
                    status: code,
                    detail,
                })
            }
            Err(e) => Err(BackendError::Provider(format!("{}: {e}", self.label))),
        }
    }
}

// ── Parsing helpers ─────────────────────────────────────────────────────────────

/// Extract the first tool call from an OpenAI-format message, if present.
fn extract_tool_call(msg: &serde_json::Value) -> Option<ToolCall> {
    msg["tool_calls"]
        .as_array()
        .and_then(|calls| calls.first())
        .and_then(|call| {
            let func = &call["function"];
            let name = func["name"].as_str()?.to_string();
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
fn to_openai_messages(history: &[Message]) -> Vec<serde_json::Value> {
    let mut result = Vec::new();
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
                if !pending_ids.is_empty() {
                    msg["tool_call_id"] = serde_json::Value::String(pending_ids.remove(0));
                }
                result.push(msg);
            }
            other => {
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
    flush_pending(&mut result, &mut pending_ids);
    result
}

// ── SSE streaming ───────────────────────────────────────────────────────────────

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    fn cfg(base_url: &str, api_key: &str) -> ProviderConfig {
        ProviderConfig {
            id: "test".into(),
            name: "Test".into(),
            base_url: base_url.into(),
            api_key: api_key.into(),
            enabled: true,
            flavor: ProviderFlavor::Openai,
        }
    }

    /// One-shot `/models` server. Returns its base URL and the Authorization
    /// header it saw (None when the client sent none).
    fn spawn_models_server() -> (String, std::thread::JoinHandle<Option<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(&stream);
            let mut auth = None;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                    break;
                }
                if let Some(v) = line.strip_prefix("Authorization: ") {
                    auth = Some(v.trim().to_string());
                }
            }
            let body = r#"{"data":[{"id":"llama-3","context_length":8192},{"id":"gpt-4o","architecture":{"input_modalities":["text","image"]}}]}"#;
            let mut stream = &stream;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
            auth
        });
        (format!("http://127.0.0.1:{port}"), handle)
    }

    #[test]
    fn from_config_maps_fields_and_treats_blank_key_as_none() {
        let p = OpenAiCompatProvider::from_config(&cfg("https://x.dev/v1/", "  sk-abc  "));
        assert_eq!(p.base_url, "https://x.dev/v1", "trailing slash trimmed");
        assert_eq!(p.api_key.as_deref(), Some("sk-abc"), "key trimmed");
        assert!(!p.openrouter_extensions);

        let keyless = OpenAiCompatProvider::from_config(&cfg("http://localhost:8000/v1", "   "));
        assert_eq!(keyless.api_key, None, "blank key means no auth");
    }

    #[test]
    fn openrouter_flavor_enables_extensions() {
        let mut c = cfg("https://openrouter.ai/api/v1", "k");
        c.flavor = ProviderFlavor::Openrouter;
        assert!(OpenAiCompatProvider::from_config(&c).openrouter_extensions);
    }

    #[test]
    fn list_models_parses_catalog_and_sends_key() {
        let (base, server) = spawn_models_server();
        let p = OpenAiCompatProvider::from_config(&cfg(&base, "sk-test"));
        let models = p.list_models().unwrap();

        assert_eq!(models.len(), 2);
        // Sorted by name, and image modality drives the vision flag.
        assert_eq!(models[0].name, "gpt-4o");
        assert!(models[0].vision);
        assert_eq!(models[1].name, "llama-3");
        assert!(!models[1].vision);
        assert_eq!(p.context_length("llama-3"), 8192);
        assert_eq!(server.join().unwrap().as_deref(), Some("Bearer sk-test"));
    }

    /// A keyless endpoint (local vLLM, llama.cpp) must still list its models —
    /// it previously returned an empty catalog and looked broken.
    #[test]
    fn keyless_endpoint_lists_models_without_auth_header() {
        let (base, server) = spawn_models_server();
        let p = OpenAiCompatProvider::from_config(&cfg(&base, ""));
        let models = p.list_models().unwrap();

        assert_eq!(models.len(), 2, "keyless endpoint still lists models");
        assert_eq!(server.join().unwrap(), None, "no Authorization header sent");
    }
}
