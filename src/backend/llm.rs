//! Provider-agnostic LLM layer.
//!
//! Everything outside `backend` talks to the model through these types and
//! the [`Provider`] trait — never to a vendor module directly. Vendor
//! quirks (Ollama's `think:true`, `num_ctx`, endpoints, wire formats for
//! reasoning/tool-calls) stay inside each implementation, so adding a new
//! backend (Claude API, OpenAI, llama.cpp, …) means implementing this
//! trait and wiring it into [`active`], with no UI/worker changes.

use crate::backend::error::BackendResult;
use std::sync::OnceLock;

/// Identity of each model backend. This enum is the catalog's backbone:
/// adding a provider = add a variant here, implement [`Provider`] for it,
/// register it in [`providers`], and it shows up grouped in the model
/// selector (and anywhere else that iterates [`ProviderKind::ALL`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ProviderKind {
    Ollama,
    OpenRouter,
}

impl ProviderKind {
    /// Every registered kind, in catalog display order.
    pub const ALL: [ProviderKind; 2] = [ProviderKind::Ollama, ProviderKind::OpenRouter];

    /// Human label for catalog section headers.
    pub fn label(self) -> &'static str {
        match self {
            Self::Ollama => "Ollama",
            Self::OpenRouter => "OpenRouter",
        }
    }
}

/// One selectable model in the catalog, tagged with the provider that
/// serves it.
#[derive(Debug, Clone)]
pub struct CatalogModel {
    pub provider: ProviderKind,
    pub name: String,
    /// Whether the model accepts image input (drives the Vision role filter).
    pub vision: bool,
}

#[derive(Debug, Clone)]
pub struct ModelChoice {
    pub name: String,
    /// Accepts image input. Derived from provider metadata where available
    /// (OpenRouter's `architecture.input_modalities`); `false` when the
    /// provider doesn't expose modalities (e.g. Ollama).
    pub vision: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
    /// Tool calls attached to an assistant turn, pre-serialized in the
    /// active provider's wire format (see [`Provider::tool_call_history_json`]).
    /// Kept as a string so session persistence stays format-stable.
    pub tool_calls_json: Option<String>,
    pub tool_name: Option<String>,
}

impl Message {
    pub fn system(content: &str) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
            tool_calls_json: None,
            tool_name: None,
        }
    }
    pub fn user(content: &str) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
            tool_calls_json: None,
            tool_name: None,
        }
    }
    pub fn assistant(content: String) -> Self {
        Self {
            role: "assistant".into(),
            content,
            tool_calls_json: None,
            tool_name: None,
        }
    }
    pub fn assistant_with_tool_call(content: String, tool_calls_json: String) -> Self {
        Self {
            role: "assistant".into(),
            content,
            tool_calls_json: Some(tool_calls_json),
            tool_name: None,
        }
    }
    pub fn tool(name: &str, content: &str) -> Self {
        Self {
            role: "tool".into(),
            content: content.into(),
            tool_calls_json: None,
            tool_name: Some(name.into()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub name: String,
    /// Raw JSON object with the call arguments, as sent by the model.
    pub arguments: String,
    /// Provider-specific tool call ID (used by OpenAI/OpenRouter to link tool results).
    pub id: Option<String>,
}

/// One complete assistant turn. `thinking` is empty when the provider or
/// model has no reasoning trace — callers must treat it as optional.
#[derive(Debug, Clone)]
pub struct AssistantResponse {
    pub content: String,
    pub thinking: String,
    pub tool_call: Option<ToolCall>,
}

/// Token usage + cost for a turn, when the provider reports it (OpenRouter
/// returns this in the final stream chunk when asked). Cost is in USD.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cost: f64,
    /// Per-direction cost split, in USD. Filled from the provider's
    /// `cost_details` when present, otherwise derived from tokens × pricing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_cost: Option<f64>,
    /// Raw provider usage object (JSON), for the Turn detail "raw" view.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    /// Model that produced this usage. Set before persisting; absent in live stream events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

impl Usage {
    pub fn is_empty(&self) -> bool {
        self.prompt_tokens == 0 && self.completion_tokens == 0 && self.cost == 0.0
    }
}

pub enum StreamEvent {
    Content(String),
    Thinking(String),
    ToolCall(ToolCall),
    Usage(Usage),
    /// Raw HTTP request body sent to the provider (JSON), emitted once at the
    /// start of the stream. Backs the Turn detail "raw request" view.
    RequestBody(String),
    /// Raw HTTP response payload received from the provider (the concatenated
    /// SSE/NDJSON stream), emitted once when the turn finishes.
    ResponseRaw(String),
    Done,
}

/// An in-flight streamed chat. `poll` is non-blocking: it returns the
/// events that arrived since the last call (possibly none) and `Done`
/// exactly once when the turn finishes.
pub trait ChatStream: Send {
    fn poll(&mut self) -> BackendResult<Vec<StreamEvent>>;
}

/// A chat-model backend. Implementations are stateless handles (cheap,
/// `Send + Sync`) — per-request state lives in the returned values.
pub trait Provider: Send + Sync {
    /// Which catalog identity this backend serves.
    fn kind(&self) -> ProviderKind;

    /// Short vendor id, e.g. "ollama".
    fn name(&self) -> &'static str;

    /// Models this backend can serve right now.
    fn list_models(&self) -> BackendResult<Vec<ModelChoice>>;

    /// Context window (tokens) for `model`, with a sane fallback. Backs the
    /// context-window breakdown UI (see `get_context_window`).
    fn context_length(&self, model: &str) -> usize;

    /// One non-streamed turn with full history + tool definitions.
    fn chat(
        &self,
        model: &str,
        history: &[Message],
        debug: bool,
    ) -> BackendResult<AssistantResponse>;

    /// Fire-and-forget single prompt (no tools, no history) returning the
    /// bare text — used for cheap utility calls like node summaries.
    fn chat_simple(
        &self,
        model: &str,
        system: &str,
        user: &str,
        debug: bool,
    ) -> BackendResult<String>;

    /// Describe an image with a vision-capable model: one non-streamed,
    /// historyless call carrying a base64 image plus a text prompt, returning
    /// the model's text description. Backs the "Vision" role (image summaries,
    /// the `vision` tool, attachments). Default: unsupported — providers that
    /// can send images override this.
    fn describe_image(
        &self,
        _model: &str,
        _image_base64: &str,
        _mime: &str,
        _prompt: &str,
        _debug: bool,
    ) -> BackendResult<String> {
        Err("this provider does not support image input".into())
    }

    /// Begin a streamed turn with full history + tool definitions.
    fn start_stream(&self, model: &str, history: &[Message]) -> BackendResult<Box<dyn ChatStream>>;

    /// Serializes one or more tool calls made in the SAME assistant turn
    /// (parallel tool calls) into this provider's history wire format — an
    /// array of call objects stored on one assistant [`Message`]. Each call's
    /// result must then follow as a `tool` message in the same order.
    fn tool_calls_history_json(&self, calls: &[ToolCall]) -> String;
}

static PROVIDERS: OnceLock<Vec<Box<dyn Provider>>> = OnceLock::new();

/// All registered backends, one per [`ProviderKind`].
fn providers() -> &'static [Box<dyn Provider>] {
    PROVIDERS.get_or_init(|| {
        vec![
            Box::new(crate::backend::ollama::OllamaProvider),
            Box::new(crate::backend::openrouter::OpenRouterProvider),
        ]
    })
}

/// Resolve the backend serving `kind`. Panics only on a programming error
/// (a `ProviderKind` variant without a registered implementation).
pub fn provider(kind: ProviderKind) -> &'static dyn Provider {
    providers()
        .iter()
        .find(|p| p.kind() == kind)
        .map(|p| p.as_ref())
        .unwrap_or_else(|| panic!("no provider registered for {kind:?}"))
}

/// The provider driving the chat loop. Fixed to Ollama today; a future
/// config option can swap it without touching call sites.
pub fn active() -> &'static dyn Provider {
    provider(ProviderKind::Ollama)
}

/// Full model catalog: every model from every registered provider, in
/// [`ProviderKind::ALL`] order. A provider that fails to list (daemon
/// down, no network) contributes nothing instead of failing the whole
/// catalog.
pub fn catalog() -> Vec<CatalogModel> {
    let mut out = Vec::new();
    for kind in ProviderKind::ALL {
        if let Ok(models) = provider(kind).list_models() {
            out.extend(models.into_iter().map(|m| CatalogModel {
                provider: kind,
                name: m.name,
                vision: m.vision,
            }));
        }
    }
    out
}

/// Resolve a model name to the [`ProviderKind`] that serves it, by checking
/// each provider's current model list. Returns `None` when no provider lists
/// this model (e.g. because the daemon is down or the model was removed).
pub fn provider_kind_for_model(model: &str) -> Option<ProviderKind> {
    for kind in ProviderKind::ALL {
        if let Ok(models) = provider(kind).list_models() {
            if models.iter().any(|m| m.name == model) {
                return Some(kind);
            }
        }
    }
    None
}

/// Resolve a model name to the [`Provider`] that serves it. Falls back to
/// [`active`] when no provider is found.
pub fn provider_for_model(model: &str) -> &'static dyn Provider {
    provider_kind_for_model(model)
        .map(provider)
        .unwrap_or_else(active)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_kind_all_have_distinct_labels() {
        // Every registered kind resolves to an implementation and a unique
        // label — guards against adding a variant without wiring it up.
        let labels: Vec<&str> = ProviderKind::ALL.iter().map(|k| k.label()).collect();
        assert_eq!(labels.len(), ProviderKind::ALL.len());
        let unique: std::collections::HashSet<_> = labels.iter().collect();
        assert_eq!(unique.len(), labels.len(), "labels must be distinct");
        for kind in ProviderKind::ALL {
            assert_eq!(
                provider(kind).kind(),
                kind,
                "provider registered for {kind:?}"
            );
        }
    }

    #[test]
    fn usage_is_empty_only_when_zeroed() {
        assert!(Usage::default().is_empty());
        assert!(!Usage {
            prompt_tokens: 1,
            ..Default::default()
        }
        .is_empty());
        assert!(!Usage {
            cost: 0.01,
            ..Default::default()
        }
        .is_empty());
    }

    #[test]
    fn message_constructors_set_roles_and_tool_fields() {
        assert_eq!(Message::system("s").role, "system");
        assert_eq!(Message::user("u").role, "user");

        let plain = Message::assistant("hi".into());
        assert_eq!(plain.role, "assistant");
        assert!(plain.tool_calls_json.is_none());

        let with_call = Message::assistant_with_tool_call("".into(), "[{}]".into());
        assert_eq!(with_call.tool_calls_json.as_deref(), Some("[{}]"));

        let tool = Message::tool("search", "results");
        assert_eq!(tool.role, "tool");
        assert_eq!(tool.tool_name.as_deref(), Some("search"));
    }

    #[test]
    fn message_survives_json_roundtrip() {
        let msg = Message::assistant_with_tool_call("body".into(), "[{\"x\":1}]".into());
        let json = serde_json::to_string(&msg).unwrap();
        let back: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(back.content, "body");
        assert_eq!(back.tool_calls_json, msg.tool_calls_json);
    }
}
