//! Ollama implementation of the provider-agnostic [`crate::backend::llm`]
//! layer. Vendor specifics live here: the local HTTP endpoint, `think:true`,
//! `num_ctx`, `ollama list/show` shelling, and the tool-call wire format.

#![allow(dead_code)]

use crate::backend::cmd::no_window_cmd;
use crate::backend::error::{BackendError, BackendResult};
use crate::backend::llm::{AssistantResponse, Message, ModelChoice, StreamEvent, ToolCall};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub const DEFAULT_CONTEXT_LENGTH: usize = 32_768;

/// Cap on the context window we actually request from Ollama. Models advertise
/// enormous maximums (gemma4 reports 131072); forcing `num_ctx` that high makes
/// Ollama allocate a giant KV cache that spills to swap, turning a trivial "oi"
/// into a 90s+ stall. The `ollama run` CLI is fast precisely because it uses a
/// small default window. Cap to keep replies snappy while leaving room for
/// real conversations + tool output.
pub const NUM_CTX_CAP: usize = 8_192;

/// The context window to actually send in a request: the model's real maximum,
/// capped by [`NUM_CTX_CAP`].
fn request_num_ctx(model: &str) -> usize {
    model_context_length(model).min(NUM_CTX_CAP)
}

static MODEL_CONTEXT_CACHE: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();

/// Stateless handle implementing [`crate::backend::llm::Provider`] over
/// the free functions in this module.
pub struct OllamaProvider;

impl crate::backend::llm::Provider for OllamaProvider {
    fn id(&self) -> String {
        crate::backend::llm::OLLAMA_ID.to_string()
    }
    fn label(&self) -> String {
        "Ollama".to_string()
    }
    fn list_models(&self) -> BackendResult<Vec<ModelChoice>> {
        list_models()
    }
    fn context_length(&self, model: &str) -> usize {
        model_context_length(model)
    }
    fn chat(
        &self,
        model: &str,
        history: &[Message],
        debug: bool,
    ) -> BackendResult<AssistantResponse> {
        chat_with_tools(model, history, debug)
    }
    fn chat_simple(
        &self,
        model: &str,
        system: &str,
        user: &str,
        debug: bool,
    ) -> BackendResult<String> {
        chat_raw(model, system, user, debug)
    }
    fn describe_image(
        &self,
        model: &str,
        image_base64: &str,
        _mime: &str,
        prompt: &str,
        debug: bool,
    ) -> BackendResult<String> {
        describe_image_raw(model, image_base64, prompt, debug)
    }
    fn start_stream(
        &self,
        model: &str,
        history: &[Message],
        tools_json: &str,
    ) -> BackendResult<Box<dyn crate::backend::llm::ChatStream>> {
        Ok(Box::new(ChatStream::start(model, history, tools_json)?))
    }
    fn tool_calls_history_json(&self, calls: &[ToolCall]) -> String {
        tool_calls_to_json(calls)
    }
}

pub struct ChatStream {
    stream: TcpStream,
    buf: Vec<u8>,
    header_done: bool,
    finished: bool,
    /// Raw request body, emitted once on the first poll.
    req_body: Option<String>,
    /// Full raw NDJSON stream, accumulated for the "raw response" view.
    raw_resp: String,
}

impl crate::backend::llm::ChatStream for ChatStream {
    fn poll(&mut self) -> BackendResult<Vec<StreamEvent>> {
        ChatStream::poll(self)
    }
}

impl ChatStream {
    pub fn start(model: &str, history: &[Message], tools_json: &str) -> BackendResult<Self> {
        let messages_json = messages_to_json(history);
        let num_ctx = request_num_ctx(model);
        let think = model_supports_thinking(model);
        // `tools_json` is already mode-filtered by the caller; an empty array
        // omits tools so the model can only reply with text.
        let tools_json = if tools_json.trim().is_empty() {
            "[]"
        } else {
            tools_json
        };
        let body = format!(
            "{{\"model\":{},\"messages\":[{}],\"tools\":{},\"stream\":true,\"think\":{},\"options\":{{\"temperature\":0,\"num_ctx\":{}}}}}",
            json_string(model),
            messages_json,
            tools_json,
            think,
            num_ctx,
        );

        let socket = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 11434);
        let stream = TcpStream::connect_timeout(&socket, Duration::from_secs(10))?;
        stream.set_read_timeout(Some(Duration::from_millis(250)))?;

        let request = format!(
            "POST /api/chat HTTP/1.1\r\nHost: 127.0.0.1:11434\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let mut tmp = stream.try_clone()?;
        tmp.write_all(request.as_bytes())?;

        // Pretty-print the body for the raw view; fall back to compact on parse failure.
        let pretty = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| serde_json::to_string_pretty(&v).ok())
            .unwrap_or_else(|| body.clone());

        Ok(Self {
            stream,
            buf: Vec::new(),
            header_done: false,
            finished: false,
            req_body: Some(pretty),
            raw_resp: String::new(),
        })
    }

    pub fn poll(&mut self) -> BackendResult<Vec<StreamEvent>> {
        if self.finished {
            return Ok(vec![StreamEvent::Done]);
        }

        // Emit the raw request body exactly once, before any response bytes.
        let mut events = Vec::new();
        if let Some(body) = self.req_body.take() {
            events.push(StreamEvent::RequestBody(body));
        }

        let mut read_buf = [0u8; 4096];
        loop {
            match self.stream.read(&mut read_buf) {
                Ok(0) => {
                    self.finished = true;
                    break;
                }
                Ok(n) => self.buf.extend_from_slice(&read_buf[..n]),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break
                }
                Err(e) => return Err(format!("read: {e}").into()),
            }
        }

        if self.buf.is_empty() {
            return Ok(events);
        }

        if !self.header_done {
            if let Some(pos) = self.buf.windows(4).position(|w| w == b"\r\n\r\n") {
                self.header_done = true;
                self.buf.drain(..pos + 4);
            } else {
                return Ok(events);
            }
        }

        let mut i = 0;
        while i < self.buf.len() {
            if let Some(nl) = self.buf[i..].iter().position(|&b| b == b'\n') {
                let line = &self.buf[i..i + nl];
                i += nl + 1;
                if line.is_empty() {
                    continue;
                }
                // Strip optional \r at end of line
                let line = if line.last() == Some(&b'\r') {
                    &line[..line.len() - 1]
                } else {
                    line
                };
                if line.is_empty() {
                    continue;
                }
                // Skip chunked-encoding size lines (pure hex digits)
                if line.iter().all(|&b| b.is_ascii_hexdigit()) {
                    continue;
                }
                let s = std::str::from_utf8(line)
                    .map_err(|e| BackendError::Provider(format!("utf8: {e}")))?;
                events.extend(events_from_line(s, &mut self.raw_resp)?);
            } else {
                break;
            }
        }
        if i > 0 {
            self.buf.drain(..i);
        }

        Ok(events)
    }
}

/// Turn one NDJSON line from `/api/chat` into stream events, appending it to
/// `raw_resp` for the raw-response view.
///
/// A free function rather than a method: everything here is wire format, and
/// `ChatStream` owns a live `TcpStream`, so folding this into `poll` would mean
/// no test could reach it without opening a socket to a real Ollama.
fn events_from_line(s: &str, raw_resp: &mut String) -> BackendResult<Vec<StreamEvent>> {
    let mut events = Vec::new();
    raw_resp.push_str(s);
    raw_resp.push('\n');

    // Ollama signals failures as a JSON object with an `error` field (e.g. a
    // model that doesn't support thinking/tools). Surface it instead of ending
    // the stream with nothing.
    if let Some(err) = extract_json_string_field(s, "error") {
        return Err(format!("ollama: {err}").into());
    }

    if s.contains("\"done\":true") {
        // Ollama reports token counts in the final done chunk.
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(s) {
            let prompt = json["prompt_eval_count"].as_u64().unwrap_or(0);
            let completion = json["eval_count"].as_u64().unwrap_or(0);
            if prompt > 0 || completion > 0 {
                events.push(StreamEvent::Usage(crate::backend::llm::Usage {
                    prompt_tokens: prompt,
                    completion_tokens: completion,
                    cost: 0.0,
                    prompt_cost: None,
                    completion_cost: None,
                    raw: serde_json::to_string_pretty(&json).ok(),
                    model: None,
                }));
            }
        }
        events.push(StreamEvent::ResponseRaw(std::mem::take(raw_resp)));
        events.push(StreamEvent::Done);
    } else {
        if let Some(content) = extract_json_string_field(s, "content") {
            if !content.is_empty() {
                events.push(StreamEvent::Content(content));
            }
        }
        if let Some(thinking) = extract_json_string_field(s, "thinking") {
            if !thinking.is_empty() {
                events.push(StreamEvent::Thinking(thinking));
            }
        }
        if let Some(tc) = extract_tool_call(s) {
            events.push(StreamEvent::ToolCall(tc));
        }
    }
    Ok(events)
}

pub fn list_models() -> BackendResult<Vec<ModelChoice>> {
    let output = no_window_cmd("ollama").arg("list").output()?;
    if !output.status.success() {
        return Err(BackendError::Provider(format!(
            "`ollama list` failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models = Vec::new();
    for line in stdout.lines().skip(1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let name = trimmed.split_whitespace().next().unwrap_or("").to_string();
        if !name.is_empty() {
            let vision = model_supports_vision(&name);
            models.push(ModelChoice { name, vision });
        }
    }
    Ok(models)
}

/// Whether `model` supports Ollama's `think` flag. Sending `think:true` to a
/// model without the thinking capability (e.g. gemma, llama3) makes Ollama
/// reject the whole request, which would silently break streaming. We probe
/// `ollama show` once per model and cache the result.
pub fn model_supports_thinking(model: &str) -> bool {
    static CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(model) {
            return *value;
        }
    }
    // `ollama show` lists a "Capabilities" section; "thinking" appears there
    // only for models that support reasoning.
    let supports = no_window_cmd("ollama")
        .args(["show", model])
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("thinking")
        })
        .unwrap_or(false);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(model.to_string(), supports);
    }
    supports
}

/// Whether `model` supports image input (vision). Probes `ollama show` for a
/// "vision" capability string, mirroring the approach used for thinking
/// detection. Results are cached so each model is probed at most once.
pub fn model_supports_vision(model: &str) -> bool {
    static CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(model) {
            return *value;
        }
    }
    // `ollama show` lists a "Capabilities" section; "vision" appears there
    // only for multimodal models.
    let supports = no_window_cmd("ollama")
        .args(["show", model])
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains("vision")
        })
        .unwrap_or(false);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(model.to_string(), supports);
    }
    supports
}

pub fn model_context_length(model: &str) -> usize {
    let cache = MODEL_CONTEXT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(model) {
            return *value;
        }
    }

    let resolved = fetch_model_context_length(model).unwrap_or(DEFAULT_CONTEXT_LENGTH);

    if let Ok(mut guard) = cache.lock() {
        guard.insert(model.to_string(), resolved);
    }

    resolved
}

fn fetch_model_context_length(model: &str) -> BackendResult<usize> {
    let output = no_window_cmd("ollama").args(["show", model]).output()?;
    if !output.status.success() {
        return Err(BackendError::Provider(format!(
            "`ollama show {model}` failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if !line.contains("context length") {
            continue;
        }
        let digits: String = line.chars().filter(|ch| ch.is_ascii_digit()).collect();
        if let Ok(value) = digits.parse::<usize>() {
            return Ok(value);
        }
    }

    Err(BackendError::Provider(format!(
        "context length not found for model `{model}`"
    )))
}

pub fn chat_with_tools(
    model: &str,
    history: &[Message],
    debug: bool,
) -> BackendResult<AssistantResponse> {
    let messages_json = messages_to_json(history);
    let num_ctx = request_num_ctx(model);
    let think = model_supports_thinking(model);
    let body = format!(
        "{{\"model\":{},\"messages\":[{}],\"tools\":{},\"stream\":false,\"think\":{},\"options\":{{\"temperature\":0,\"num_ctx\":{}}}}}",
        json_string(model),
        messages_json,
        crate::backend::tools::tools_json(),
        think,
        num_ctx,
    );
    if debug {
        println!("[debug] request body:");
        println!("{body}");
    }
    let response = http_post("127.0.0.1:11434", "/api/chat", &body)?;
    if debug {
        println!("[debug] raw response:");
        println!("{response}");
    }
    let content = extract_json_string_field(&response, "content").unwrap_or_default();
    let thinking = extract_json_string_field(&response, "thinking").unwrap_or_default();
    let tool_call = extract_tool_call(&response);
    if debug {
        println!("[debug] parsed content:");
        println!("{content}");
        println!("[debug] parsed thinking:");
        println!("{thinking}");
        match &tool_call {
            Some(tc) => {
                println!("[debug] parsed tool_call name:");
                println!("{}", tc.name);
                println!("[debug] parsed tool_call arguments:");
                println!("{}", tc.arguments);
            }
            None => println!("[debug] parsed tool_call: none"),
        }
    }
    Ok(AssistantResponse {
        content,
        thinking,
        tool_call,
    })
}

pub fn chat_raw(model: &str, system: &str, user: &str, debug: bool) -> BackendResult<String> {
    let num_ctx = request_num_ctx(model);
    let body = format!(
        "{{\"model\":{},\"messages\":[{{\"role\":\"system\",\"content\":{}}},{{\"role\":\"user\",\"content\":{}}}],\"stream\":false,\"options\":{{\"temperature\":0.3,\"num_ctx\":{}}}}}",
        json_string(model),
        json_string(system),
        json_string(user),
        num_ctx,
    );
    if debug {
        println!("[debug] chat_raw body:");
        println!("{body}");
    }
    let response = http_post("127.0.0.1:11434", "/api/chat", &body)?;
    if debug {
        println!("[debug] chat_raw response:");
        println!("{response}");
    }
    Ok(extract_json_string_field(&response, "content").unwrap_or_default())
}

/// Describe an image via Ollama's vision path: `/api/chat` accepts an `images`
/// array of raw base64 strings (no data-URL prefix) on a message. Mirrors
/// [`chat_raw`] but carries the image alongside the prompt.
pub fn describe_image_raw(
    model: &str,
    image_base64: &str,
    prompt: &str,
    debug: bool,
) -> BackendResult<String> {
    let num_ctx = request_num_ctx(model);
    let body = format!(
        "{{\"model\":{},\"messages\":[{{\"role\":\"user\",\"content\":{},\"images\":[{}]}}],\"stream\":false,\"options\":{{\"temperature\":0.3,\"num_ctx\":{}}}}}",
        json_string(model),
        json_string(prompt),
        json_string(image_base64),
        num_ctx,
    );
    if debug {
        println!("[debug] describe_image_raw model={model}");
    }
    let response = http_post("127.0.0.1:11434", "/api/chat", &body)?;
    if debug {
        println!("[debug] describe_image_raw response:");
        println!("{response}");
    }
    Ok(extract_json_string_field(&response, "content").unwrap_or_default())
}

fn messages_to_json(history: &[Message]) -> String {
    let mut out = String::new();
    for (idx, msg) in history.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"role\":{},\"content\":{}",
            json_string(&msg.role),
            json_string(&msg.content)
        ));
        if let Some(tool_calls_json) = &msg.tool_calls_json {
            out.push_str(&format!(",\"tool_calls\":{}", tool_calls_json));
        }
        if let Some(tool_name) = &msg.tool_name {
            out.push_str(&format!(",\"tool_name\":{}", json_string(tool_name)));
        }
        out.push('}');
    }
    out
}

fn http_post(host: &str, path: &str, body: &str) -> BackendResult<String> {
    let socket = SocketAddr::new(
        host.parse::<IpAddr>()
            .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        11434,
    );
    let mut stream = TcpStream::connect_timeout(&socket, Duration::from_secs(10))?;
    // Per-read timeout so a request that wedges Ollama (the failure mode
    // when too many summaries run at once) errors out instead of blocking
    // the worker forever and hanging the whole join. Generous enough that
    // a slow-but-progressing generation still completes.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(180)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let request = format!(
        "POST {} HTTP/1.1\r\nHost: 127.0.0.1:11434\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path, body.len(), body
    );
    stream.write_all(request.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    response
        .split("\r\n\r\n")
        .nth(1)
        .map(|s| s.to_string())
        .ok_or_else(|| BackendError::Provider("invalid HTTP response".into()))
}

fn extract_tool_call(json: &str) -> Option<ToolCall> {
    let tool_calls_idx = json.find("\"tool_calls\"")?;
    let slice = &json[tool_calls_idx..];
    let name = extract_nested_string(slice, "name")?;
    let arguments = extract_nested_value(slice, "arguments")?;
    Some(ToolCall {
        name,
        arguments,
        id: None,
    })
}

fn extract_nested_string(haystack: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\":\"", key);
    let start = haystack.find(&pattern)? + pattern.len();
    let s = &haystack[start..];
    let mut escaped = false;
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if escaped {
            escaped = false;
            if ch == 'u' {
                if let Some(decoded) = decode_unicode_escape(&mut chars) {
                    out.push(decoded);
                }
                continue;
            }
            out.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

/// Decodes a `\uXXXX` JSON escape (the `\u` already consumed), pairing
/// surrogates into a single `char` so emoji and `&`-style escapes
/// (`&`, `<`, `>`, often emitted by HTML-safe JSON encoders) render right.
fn decode_unicode_escape(chars: &mut std::str::Chars) -> Option<char> {
    let hi = take_hex4(chars)?;
    // High surrogate: needs a following `\uXXXX` low surrogate.
    if (0xD800..=0xDBFF).contains(&hi) {
        if chars.clone().next() == Some('\\') {
            chars.next();
            if chars.clone().next() == Some('u') {
                chars.next();
                let lo = take_hex4(chars)?;
                // The pairing arithmetic below subtracts 0xDC00 from `lo`, so a
                // second escape that isn't a low surrogate underflows — a model
                // emitting a stray `\uD83DA` would panic the parse. Reject
                // it as the malformed escape it is instead.
                if !(0xDC00..=0xDFFF).contains(&lo) {
                    return None;
                }
                let c = 0x10000 + ((hi as u32 - 0xD800) << 10) + (lo as u32 - 0xDC00);
                return char::from_u32(c);
            }
        }
        return None;
    }
    char::from_u32(hi as u32)
}

/// Reads exactly four hex digits. `take(4)` alone will happily accept fewer at
/// the end of the input, so a truncated `\uAB` would decode as U+00AB rather
/// than being rejected.
fn take_hex4(chars: &mut std::str::Chars) -> Option<u16> {
    let hex: String = chars.by_ref().take(4).collect();
    if hex.len() != 4 {
        return None;
    }
    u16::from_str_radix(&hex, 16).ok()
}

fn extract_nested_value(haystack: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\":", key);
    let start = haystack.find(&pattern)? + pattern.len();
    let s = haystack[start..].trim_start();
    if s.starts_with('{') {
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        for (idx, ch) in s.char_indices() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_string = false;
                }
            } else if ch == '"' {
                in_string = true;
            } else if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(s[..=idx].to_string());
                }
            }
        }
        None
    } else {
        extract_nested_string(haystack, key)
    }
}

fn json_string(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // JSON forbids every control character below 0x20 in a string, not
            // just the ones with short escapes. Tool output carries them
            // routinely — ANSI colour codes from `terminal` are ESC-prefixed —
            // and emitting one raw makes the whole request body unparseable.
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn extract_json_string_field(json: &str, key: &str) -> Option<String> {
    extract_nested_string(json, key)
}

pub fn tool_calls_to_json(calls: &[ToolCall]) -> String {
    let items: Vec<String> = calls
        .iter()
        .map(|c| {
            format!(
                "{{\"function\":{{\"name\":{},\"arguments\":{}}}}}",
                json_string(&c.name),
                c.arguments
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `\uXXXX` escape as it appears on the wire — a real backslash, not the
    /// character it denotes. Built here so the tests don't depend on how a
    /// literal survives the source file.
    fn esc(hex: &str) -> String {
        format!("\\u{hex}")
    }

    fn field(body: &str) -> String {
        format!("\"t\":\"{body}\"")
    }

    #[test]
    fn json_escapes_control_characters() {
        // `terminal` hands back whatever the command printed, and anything
        // colourised is full of ESC. Raw, it makes the body unparseable.
        let ansi = "\u{1b}[31merror\u{1b}[0m";
        let encoded = json_string(ansi);
        assert!(!encoded.contains('\u{1b}'), "raw ESC left in: {encoded:?}");

        let body = format!("{{\"content\":{encoded}}}");
        let parsed: serde_json::Value =
            serde_json::from_str(&body).expect("body must be valid JSON");
        assert_eq!(parsed["content"], ansi, "round-trips back to the same text");
    }

    #[test]
    fn json_escapes_the_usual_suspects() {
        let s = "a\"b\\c\nd\te";
        let parsed: serde_json::Value =
            serde_json::from_str(&format!("{{\"v\":{}}}", json_string(s))).unwrap();
        assert_eq!(parsed["v"], s);
    }

    #[test]
    fn surrogate_pairs_decode_to_one_char() {
        let json = field(&format!("{}{}", esc("D83D"), esc("DE00")));
        assert_eq!(extract_nested_string(&json, "t").as_deref(), Some("😀"));
    }

    /// A local model emitting a stray high surrogate used to panic the parse:
    /// the pairing maths subtracted 0xDC00 from whatever followed.
    #[test]
    fn a_high_surrogate_followed_by_a_plain_escape_is_rejected_not_fatal() {
        let json = field(&format!("{}{}", esc("D83D"), esc("0041")));
        // Reaching an assert at all is the point — this used to be a panic.
        assert_eq!(extract_nested_string(&json, "t").as_deref(), Some(""));
    }

    #[test]
    fn malformed_escapes_are_dropped_rather_than_guessed() {
        for (body, why) in [
            (esc("D83D"), "high surrogate with nothing after it"),
            (esc("DC00"), "low surrogate on its own"),
            ("\\uZZZZ".to_string(), "not hex at all"),
        ] {
            let json = field(&body);
            assert_eq!(
                extract_nested_string(&json, "t").as_deref(),
                Some(""),
                "{why}"
            );
        }
    }

    /// A `\u` escape must carry four hex digits. Given fewer, the closing quote
    /// is what fills the gap, so the string never terminates and the field
    /// can't be read — which beats the old behaviour of quietly reading `\uAB`
    /// as U+00AB and handing back a plausible-looking wrong answer.
    #[test]
    fn a_truncated_escape_fails_the_field_rather_than_inventing_a_char() {
        let json = field("\\uAB");
        assert_eq!(extract_nested_string(&json, "t"), None);
    }

    #[test]
    fn plain_escapes_decode() {
        let json = field(&format!("line{}tab{}end", "\\n", "\\t"));
        assert_eq!(
            extract_nested_string(&json, "t").as_deref(),
            Some("line\ntab\tend")
        );
    }

    #[test]
    fn a_tool_call_survives_the_round_trip() {
        // The arguments carry a nested object and a brace inside a string on
        // purpose: `extract_nested_value` counts depth to find the end, so flat
        // arguments would pass even if it stopped at the first `}` it saw.
        let calls = [ToolCall {
            name: "file".into(),
            arguments: r#"{"path":"a.rs","opts":{"deep":{"n":1}},"note":"a } brace"}"#.into(),
            id: None,
        }];
        let wire = format!("{{\"tool_calls\":{}}}", tool_calls_to_json(&calls));
        let got = extract_tool_call(&wire).expect("tool call parsed back");
        assert_eq!(got.name, "file");

        let args: serde_json::Value = serde_json::from_str(&got.arguments).unwrap();
        assert_eq!(args["path"], "a.rs");
        assert_eq!(args["opts"]["deep"]["n"], 1, "nested object kept whole");
        assert_eq!(
            args["note"], "a } brace",
            "a brace inside a string isn't an end"
        );
    }

    /// A `\u` escape is exactly four hex digits by spec. Tested directly: the
    /// callers happen to reject short escapes for their own reasons, so this
    /// guard would otherwise be untested and free to rot.
    #[test]
    fn hex_escapes_are_exactly_four_digits() {
        assert_eq!(take_hex4(&mut "0041".chars()), Some(0x41));
        assert_eq!(take_hex4(&mut "d83d".chars()), Some(0xD83D));
        assert_eq!(take_hex4(&mut "AB".chars()), None, "short is not U+00AB");
        assert_eq!(take_hex4(&mut "".chars()), None);
        assert_eq!(take_hex4(&mut "ZZZZ".chars()), None, "not hex");
        // Only the four digits are consumed; the rest of the string is the
        // caller's to keep reading.
        let mut rest = "0041rest".chars();
        assert_eq!(take_hex4(&mut rest), Some(0x41));
        assert_eq!(rest.as_str(), "rest");
    }

    fn events(line: &str) -> Vec<StreamEvent> {
        let mut raw = String::new();
        events_from_line(line, &mut raw).expect("line should parse")
    }

    #[test]
    fn a_content_chunk_becomes_one_content_event() {
        let got = events(r#"{"message":{"role":"assistant","content":"hi"},"done":false}"#);
        assert!(matches!(&got[..], [StreamEvent::Content(c)] if c == "hi"));
    }

    #[test]
    fn an_empty_content_chunk_emits_nothing() {
        // Ollama sends these while warming up; forwarding them would flicker
        // the UI with empty deltas.
        let got = events(r#"{"message":{"role":"assistant","content":""},"done":false}"#);
        assert!(got.is_empty(), "got {got:?}");
    }

    #[test]
    fn a_thinking_chunk_is_kept_apart_from_content() {
        let got = events(r#"{"message":{"role":"assistant","thinking":"hmm"},"done":false}"#);
        assert!(matches!(&got[..], [StreamEvent::Thinking(t)] if t == "hmm"));
    }

    /// Ollama reports a refusal (no tool support, bad options) as a normal
    /// 200 line with an `error` field. Missing it ends the turn silently, and
    /// the user sees an empty reply with no reason.
    #[test]
    fn an_error_line_fails_the_stream_with_its_message() {
        let mut raw = String::new();
        let err = events_from_line(r#"{"error":"model does not support tools"}"#, &mut raw)
            .expect_err("must not be swallowed");
        assert!(
            err.to_string().contains("does not support tools"),
            "the reason must survive: {err}"
        );
    }

    #[test]
    fn the_done_chunk_carries_usage_and_closes_the_stream() {
        let line = r#"{"message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":12,"eval_count":34}"#;
        let got = events(line);
        let usage = got.iter().find_map(|e| match e {
            StreamEvent::Usage(u) => Some(u),
            _ => None,
        });
        let usage = usage.expect("token counts come from the done chunk");
        assert_eq!((usage.prompt_tokens, usage.completion_tokens), (12, 34));
        assert!(
            matches!(got.last(), Some(StreamEvent::Done)),
            "Done comes last"
        );
    }

    #[test]
    fn a_done_chunk_without_counts_still_closes_the_stream() {
        let got = events(r#"{"done":true}"#);
        assert!(
            !got.iter().any(|e| matches!(e, StreamEvent::Usage(_))),
            "no counts, so no usage row to invent"
        );
        assert!(matches!(got.last(), Some(StreamEvent::Done)));
    }

    #[test]
    fn the_raw_response_accumulates_and_ships_with_done() {
        let mut raw = String::new();
        events_from_line(r#"{"message":{"content":"a"},"done":false}"#, &mut raw).unwrap();
        events_from_line(r#"{"message":{"content":"b"},"done":false}"#, &mut raw).unwrap();
        let got = events_from_line(r#"{"done":true}"#, &mut raw).unwrap();

        let shipped = got.iter().find_map(|e| match e {
            StreamEvent::ResponseRaw(r) => Some(r),
            _ => None,
        });
        let shipped = shipped.expect("raw response ships on done");
        assert_eq!(shipped.lines().count(), 3, "every line, in order");
        assert!(shipped.contains(r#""content":"a""#));
        assert!(
            raw.is_empty(),
            "taken, not cloned, so the next turn starts clean"
        );
    }

    #[test]
    fn a_tool_call_chunk_becomes_a_tool_call_event() {
        let line = r#"{"message":{"tool_calls":[{"function":{"name":"search","arguments":{"pattern":"fn main"}}}]},"done":false}"#;
        let got = events(line);
        let call = got.iter().find_map(|e| match e {
            StreamEvent::ToolCall(c) => Some(c),
            _ => None,
        });
        let call = call.expect("tool call parsed out of the chunk");
        assert_eq!(call.name, "search");
        let args: serde_json::Value = serde_json::from_str(&call.arguments).unwrap();
        assert_eq!(args["pattern"], "fn main");
    }

    #[test]
    fn a_message_history_serialises_to_valid_json() {
        let history = [
            Message::system("be brief"),
            Message::user("hi"),
            // Tool output with a control character in it, the case that broke
            // the body before.
            Message::tool("terminal", "\u{1b}[32mok\u{1b}[0m"),
        ];
        let json = format!("[{}]", messages_to_json(&history));
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed.as_array().unwrap().len(), 3);
        assert_eq!(parsed[2]["content"], "\u{1b}[32mok\u{1b}[0m");
    }
}
