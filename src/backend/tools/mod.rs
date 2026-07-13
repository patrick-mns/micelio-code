pub mod bg;
mod context;
mod context_node;
mod fetch;
pub mod file;
mod graph;
mod search;
mod terminal;
mod vision;

use std::path::PathBuf;
use std::sync::Arc;

use crate::backend::mcp::McpManager;

#[derive(Clone)]
pub struct ToolContext {
    pub workspace_root: PathBuf,
    pub workspace_roots: Vec<PathBuf>,
    pub model_name: String,
    /// Vision-role model for this session (empty = unassigned). Used by the
    /// `vision` tool so each session can target its own image model.
    pub vision_model: String,
    pub history_len: usize,
    pub show_tools: bool,
    pub debug: bool,
    pub graph_json: String,
    /// Shared MCP client manager. `None` when MCP is unavailable (e.g. tests);
    /// present in the real app so `mcp__*` tool calls can be routed to servers.
    pub mcp: Option<Arc<McpManager>>,
}

impl ToolContext {
    pub fn resolve_path(&self, arg: &str) -> PathBuf {
        let path = std::path::Path::new(arg);
        if path.is_absolute() {
            return path.to_path_buf();
        }

        // Resolve by the root whose prefix produces the shortest relative path.
        // This avoids the ambiguity of `exists()` when the same relative path
        // happens to exist under multiple roots.
        let mut best: Option<(usize, &PathBuf)> = None;
        for root in &self.workspace_roots {
            let candidate = root.join(path);
            // Only consider roots that actually contain the file.
            if candidate.exists() {
                let depth = root.components().count();
                best = match best {
                    Some((prev_depth, _)) if depth >= prev_depth => best,
                    _ => Some((depth, root)),
                };
            }
        }

        if let Some((_, root)) = best {
            return root.join(path);
        }

        // Brand-new file (or non-existent path): land in the primary root
        self.workspace_root.join(path)
    }
}

#[derive(Debug)]
pub struct ToolResult {
    pub content: String,
}

/// If `args` is a JSON object that already has `action`, return it unchanged.
/// Otherwise inject `action` into the object. Handles empty/malformed input
/// gracefully so a stuttering model doesn't cause a panic.
fn inject_action(args: &str, action: &str) -> String {
    let trimmed = args.trim();
    if trimmed.starts_with('{') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if val.get("action").and_then(|a| a.as_str()).is_some() {
                return trimmed.to_string();
            }
        }
        // Strip opening `{` and inject action.
        let inner = trimmed.strip_prefix('{').unwrap_or_default().trim_start();
        if inner.is_empty() || inner == "}" {
            return format!("{{\"action\":\"{action}\"}}");
        }
        return format!("{{\"action\":\"{action}\",{inner}");
    }
    format!("{{\"action\":\"{action}\"}}")
}

/// Normalize a tool name that may contain stuttering/repetition (e.g.
/// `filefilefilefile` or `read_fileread_file`) by looking for a known tool
/// name as a substring. Falls back to the original name if nothing matches.
pub fn normalize_tool_name(name: &str) -> &str {
    // MCP tools are namespaced (`mcp__<server>__<tool>`) and routed verbatim.
    // Skip the stutter/substring normalization so their names are never mangled.
    if name.starts_with(crate::backend::mcp::MCP_PREFIX) {
        return name;
    }
    const KNOWN: &[&str] = &[
        // Longest first so `context_node` matches before `context`, etc.
        "context_node",
        "graph_focus",
        "read_file",
        "write_file",
        "edit_file",
        "terminal",
        "context",
        "search",
        "fetch",
        "graph",
        "vision",
        "file",
        "ask_user",
        "bg",
    ];
    if KNOWN.contains(&name) {
        return name;
    }
    for &k in KNOWN {
        if name.contains(k) {
            return k;
        }
    }
    name
}

pub fn run(name: &str, arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let name = normalize_tool_name(name);
    // MCP tools are routed to their server via the shared manager.
    if name.starts_with(crate::backend::mcp::MCP_PREFIX) {
        let mcp = context
            .mcp
            .as_ref()
            .ok_or_else(|| "MCP is not available in this context".to_string())?;
        return mcp
            .call(name, arguments)
            .map(|content| ToolResult { content });
    }
    match name {
        "terminal" => terminal::run(arguments, context),
        "file" => file::run(arguments, context),
        // Backwards compat: legacy names route to the unified file tool.
        // If arguments is already a JSON object with an "action" field,
        // pass it through as-is; otherwise inject the action.
        "read_file" => file::run(&inject_action(arguments, "read"), context),
        "write_file" => file::run(&inject_action(arguments, "write"), context),
        "edit_file" => file::run(&inject_action(arguments, "edit"), context),
        "search" => search::run(arguments, context),
        "fetch" => fetch::run(arguments, context),
        "context" => context::run(arguments, context),
        "context_node" => context_node::run(arguments, context),
        "graph" => graph::run_view(arguments, context),
        "graph_focus" => graph::run_focus(arguments, context),
        "vision" => vision::run(arguments, context),
        "bg" => bg::run(arguments, context),
        // ask_user is handled specially in the worker (intercepts before calling run)
        "ask_user" => Err("ask_user tool error: should have been intercepted by worker".into()),
        other => Err(format!("unknown tool `{other}`")),
    }
}

pub fn get_string_field(arguments: &str, key: &str) -> Option<String> {
    // Robust path: parse as JSON and read the field. Handles whitespace
    // (`"command": "ls"`), escaping, and key order.
    // Also handles models that emit multiple concatenated JSON objects
    // (parallel tool calls) by extracting only the first valid object.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(arguments) {
        match v.get(key) {
            Some(serde_json::Value::String(s)) => return Some(s.clone()),
            // Coerce non-string scalars (a model may emit a bare number/bool).
            Some(x) if !x.is_null() && !x.is_object() && !x.is_array() => {
                return Some(x.to_string());
            }
            _ => {}
        }
    }
    // Trailing data after a valid JSON object? serde_json rejects it. Try
    // extracting just the first brace-delimited object.
    if let Some(start) = arguments.find('{') {
        let mut depth = 0;
        let mut end = None;
        for (i, ch) in arguments[start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(start + i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        if let Some(end) = end {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&arguments[start..end]) {
                if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
                    return Some(s.to_string());
                }
            }
        }
    }
    // Fallback: manual scan for slightly malformed JSON.
    get_string_field_manual(arguments, key)
}

fn get_string_field_manual(arguments: &str, key: &str) -> Option<String> {
    // JSON may have `"key":"value"` or `"key": "value"`.
    let pat = format!("\"{}\":", key);
    let pos = arguments.find(&pat)?;
    let after_colon = &arguments[pos + pat.len()..];
    // Skip optional whitespace then the opening `"`.
    let start = after_colon.trim_start().strip_prefix('"')?;
    let mut escaped = false;
    let mut out = String::new();
    let mut chars = start.chars();
    while let Some(ch) = chars.next() {
        if escaped {
            escaped = false;
            if ch == 'u' {
                let hex: String = chars.by_ref().take(4).collect();
                if let Ok(code) = u16::from_str_radix(&hex, 16) {
                    if let Some(decoded) = char::from_u32(code as u32) {
                        out.push(decoded);
                        continue;
                    }
                }
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

/// Parse a boolean field like `"background":true` from raw JSON args.
pub fn get_bool_field(arguments: &str, key: &str) -> Option<bool> {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(arguments) {
        if let Some(b) = v.get(key).and_then(|x| x.as_bool()) {
            return Some(b);
        }
        // Some models send booleans as strings ("true").
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            return match s.to_ascii_lowercase().as_str() {
                "true" | "yes" | "on" => Some(true),
                "false" | "no" | "off" => Some(false),
                _ => None,
            };
        }
    }
    // Fallback: manual scan.
    let pattern = format!("\"{}\":", key);
    let start = arguments.find(&pattern)? + pattern.len();
    let rest = arguments[start..].trim_start().trim_start_matches('"');
    if rest.starts_with("true") {
        Some(true)
    } else if rest.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

/// Parse an integer field like `"start_line":42` from raw JSON args.
pub fn get_int_field(arguments: &str, key: &str) -> Option<i64> {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(arguments) {
        if let Some(n) = v.get(key).and_then(|x| x.as_i64()) {
            return Some(n);
        }
        // Some models send numbers as strings ("42").
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            if let Ok(n) = s.trim().parse() {
                return Some(n);
            }
        }
    }
    // Fallback: manual scan.
    let pattern = format!("\"{}\":", key);
    let start = arguments.find(&pattern)? + pattern.len();
    let rest = arguments[start..].trim_start().trim_start_matches('"');
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != '-')
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

pub fn tools_json() -> &'static str {
    r#"
    [
        {"type":"function","function":{"name":"terminal","description":"Run a shell command on the local machine and return stdout/stderr. Commands run in the workspace root. For long-running processes (dev servers, watchers like `npm run dev`, `vite`, `python -m http.server`) set background:true so they start without blocking — output goes to a log file and you get the PID back.","parameters":{"type":"object","properties":{"command":{"type":"string","description":"Shell command to run"},"background":{"type":"boolean","description":"Run detached in background (for servers/watchers that don't exit). Returns PID + log path immediately."}},"required":["command"]}}},
        {"type":"function","function":{"name":"ask_user","description":"Ask the user one or more questions and wait for the answers. Use it for decisions, clarifications and confirmations — always call it before changing the knowledge graph (context_node). Prefer asking several related questions in one call instead of many separate calls.","parameters":{"type":"object","properties":{"questions":{"type":"array","description":"The questions to show the user, rendered as a single card.","items":{"type":"object","properties":{"question":{"type":"string","description":"The question text"},"header":{"type":"string","description":"Very short label/chip for the question, e.g. \"Auth method\" (max ~12 chars)"},"options":{"type":"array","items":{"type":"string"},"description":"Short answer choices to pick from"},"multiSelect":{"type":"boolean","description":"true to let the user pick more than one option"}},"required":["question"]}}},"required":["questions"]}}},
        {"type":"function","function":{"name":"context_node","description":"Register a knowledge graph node (a file, concept, function, class, etc.). Call this when the user mentions something important you want to track in the context graph. Confirm with ask_user before registering.","parameters":{"type":"object","properties":{"label":{"type":"string","description":"Name or path of the node"},"kind":{"type":"string","description":"Type: file, concept, func, class, dir, note"},"description":{"type":"string","description":"Optional summary of what this node represents"}},"required":["label"]}}},
        {"type":"function","function":{"name":"file","description":"Read, write, or edit text files. Cannot read image files (png, jpg, gif, svg, ico, webp, bmp, tiff) — for those, use the `vision` tool to get a description. Responses always include [path:line-line] for reference.","parameters":{"type":"object","properties":{"action":{"type":"string","description":"read, write, or edit","enum":["read","write","edit"]},"path":{"type":"string","description":"Absolute or relative path to the file"},"start_line":{"type":"integer","description":"For read: first line (1-based). Ignored for write/edit."},"limit":{"type":"integer","description":"For read: how many lines from start_line. Ignored for write/edit."},"content":{"type":"string","description":"Required for write: the content to create/overwrite. Ignored for read/edit."},"old_string":{"type":"string","description":"Required for edit: exact text to find and replace (copy verbatim). Ignored for read/write."},"new_string":{"type":"string","description":"Required for edit: replacement text. Ignored for read/write."},"replace_all":{"type":"boolean","description":"For edit: replace every occurrence (default: false = one match). Ignored for read/write."}},"required":["action","path"]}}},
        {"type":"function","function":{"name":"search","description":"Search for a regex pattern within files.","parameters":{"type":"object","properties":{"pattern":{"type":"string","description":"Regex pattern to search"}},"required":["pattern"]}}},
        {"type":"function","function":{"name":"fetch","description":"Fetch a URL over HTTP(S) and return its contents as text. HTML pages are stripped to readable text; JSON and plain-text responses are returned as-is. Use it to read documentation, API responses, a package's README, or a local dev server's output. Large pages are truncated.","parameters":{"type":"object","properties":{"url":{"type":"string","description":"The http:// or https:// URL to fetch"}},"required":["url"]}}},
        {"type":"function","function":{"name":"graph","description":"Read the knowledge graph. With no arguments, returns a compact tree of the whole project: hierarchy, active state, kind, one-line summary and approximate token weight per node. Pass a `symbol` to find where that function/class is referenced. Pass a `filter` to get a flat list of just the matching nodes. Use this to see the project as a whole and decide what to focus on.","parameters":{"type":"object","properties":{"symbol":{"type":"string","description":"Optional: a function/class name to find references for instead of the full overview"},"filter":{"type":"string","description":"Optional: return only matching nodes as a flat list. One of: summarized (has a summary), unsummarized (no summary yet), active, inactive, or a kind (file, function, class, concept, dir, note)."}}}}},
        {"type":"function","function":{"name":"graph_focus","description":"Activate or deactivate a whole part of the knowledge graph (a node and everything under it) to focus context on what matters for the current task.","parameters":{"type":"object","properties":{"selector":{"type":"string","description":"Node label, path prefix (src/backend) or symbol name"},"active":{"type":"string","description":"\"true\" to activate, \"false\" to deactivate"}},"required":["selector"]}}},
        {"type":"function","function":{"name":"bg","description":"Inspect background processes started by the terminal tool (background:true, or a foreground command that outran its timeout). Use it to poll a dev server's logs, check if it's still running, or stop it.","parameters":{"type":"object","properties":{"action":{"type":"string","description":"list (all tasks), logs (new output for a pid), or stop (SIGTERM a pid)","enum":["list","logs","stop"]},"pid":{"type":"integer","description":"Required for logs/stop: the process id returned when the task was started."},"wait_ms":{"type":"integer","description":"For logs: block up to this many ms until a URL appears or the process exits (max 60000). Default 0 = return immediately."}},"required":["action"]}}},
        {"type":"function","function":{"name":"vision","description":"Look at an image file and get a text description back, using the user's Vision-role model. Use this whenever the user references an image (png, jpg, gif, svg, webp, bmp, ico, tiff) or you need to understand a screenshot/diagram/photo. Pass an optional `prompt` to ask something specific about the image.","parameters":{"type":"object","properties":{"path":{"type":"string","description":"Path to the image file (absolute or relative to the workspace)."},"prompt":{"type":"string","description":"Optional question or instruction about the image (default: describe it in detail)."}},"required":["path"]}}}
    ]
    "#.trim()
}

/// Read-only tools advertised in Chat mode. Everything here either can't mutate
/// the workspace/system at all (`vision`, `search`, `graph`, `fetch`,
/// `ask_user`) or is gated to its read action at execution time (`file` — only
/// `action:"read"` is allowed, see [`chat_mode_allows`]). Deliberately excludes
/// `terminal`, `context_node`, `graph_focus`, and `bg`.
pub const CHAT_MODE_TOOLS: &[&str] = &["vision", "file", "search", "graph", "fetch", "ask_user"];

/// Return [`tools_json`] filtered to only the tools whose name is in `allowed`,
/// preserving schema order. Used to hand Chat mode a read-only subset instead
/// of the full toolset.
pub fn tools_json_filtered(allowed: &[&str]) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(tools_json()) {
        Ok(v) => v,
        Err(_) => return "[]".into(),
    };
    let kept: Vec<serde_json::Value> = parsed
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|t| {
                    t.get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())
                        .map(|n| allowed.contains(&n))
                        .unwrap_or(false)
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    serde_json::to_string(&kept).unwrap_or_else(|_| "[]".into())
}

/// Full tool schema advertised to the model this turn: the native tools (mode-
/// filtered exactly as before) plus every discovered MCP tool. In Chat mode
/// only read-only MCP tools are appended, mirroring the native read-only subset.
/// `chat_mode` selects the Chat-mode filtering; `mcp` is `None` when MCP is
/// unavailable, in which case this is equivalent to the old behavior.
pub fn all_tools_json(mcp: Option<&McpManager>, chat_mode: bool) -> String {
    let native = if chat_mode {
        tools_json_filtered(CHAT_MODE_TOOLS)
    } else {
        tools_json().to_string()
    };
    let Some(mcp) = mcp else {
        return native;
    };
    let mut arr: Vec<serde_json::Value> = serde_json::from_str(&native).unwrap_or_default();
    // In Chat mode, only read-only MCP tools are advertised.
    arr.extend(mcp.tools_schema(chat_mode));
    serde_json::to_string(&arr).unwrap_or(native)
}

/// Whether an MCP tool named `name` may execute under `chat_mode`. Non-MCP
/// names are not this function's concern (returns `true` so the native gate
/// decides). In Chat mode, an MCP tool is allowed only when it is read-only.
pub fn mcp_mode_allows(mcp: Option<&McpManager>, name: &str, chat_mode: bool) -> bool {
    if !name.starts_with(crate::backend::mcp::MCP_PREFIX) {
        return true;
    }
    if !chat_mode {
        return true;
    }
    mcp.map(|m| m.is_read_only(name)).unwrap_or(false)
}

/// Whether `name` (with its `arguments`) is permitted to execute in Chat mode.
/// Chat mode is read-only: only the [`CHAT_MODE_TOOLS`] are allowed, and `file`
/// is further restricted to its `read` action (no `write`/`edit`). Legacy
/// `write_file`/`edit_file` names are always mutations, so they're rejected.
pub fn chat_mode_allows(name: &str, arguments: &str) -> bool {
    match normalize_tool_name(name) {
        "vision" | "search" | "graph" | "fetch" | "ask_user" | "read_file" => true,
        "file" => !matches!(
            get_string_field(arguments, "action").as_deref(),
            Some("write") | Some("edit")
        ),
        _ => false,
    }
}

/// Whether a tool call must pause for a generic (non-diff) confirmation card in
/// Review mode. These are side-effecting tools other than file write/edit —
/// running a shell command (`terminal`), killing a background process
/// (`bg` with `action:"stop"`), or mutating the knowledge graph
/// (`context_node`). File write/edit is intentionally NOT here: it has its own
/// diff-based approval flow (see `commands::agent::execute_tool_call`).
/// Read-only actions like `bg` list/logs never need confirmation.
pub fn needs_review_confirmation(name: &str, arguments: &str) -> bool {
    match normalize_tool_name(name) {
        "terminal" | "context_node" => true,
        "bg" => get_string_field(arguments, "action").as_deref() == Some("stop"),
        _ => false,
    }
}

/// A human-readable `(title, detail)` pair describing what a confirmation-gated
/// tool call will do, for the generic confirmation card. `detail` is the
/// concrete thing being acted on (the command, the pid, the graph node).
pub fn confirm_summary(name: &str, arguments: &str) -> (String, String) {
    match normalize_tool_name(name) {
        "terminal" => (
            "Run terminal command".into(),
            get_string_field(arguments, "command").unwrap_or_default(),
        ),
        "bg" => (
            "Stop background process".into(),
            get_string_field(arguments, "pid")
                .map(|p| format!("pid {p}"))
                .unwrap_or_default(),
        ),
        "context_node" => ("Update knowledge graph".into(), {
            let label = get_string_field(arguments, "label").unwrap_or_default();
            let kind = get_string_field(arguments, "kind").unwrap_or_default();
            if kind.is_empty() {
                label
            } else {
                format!("{label} ({kind})")
            }
        }),
        // MCP tools: `mcp__<server>__<tool>` → a readable title + the server.
        other if other.starts_with(crate::backend::mcp::MCP_PREFIX) => {
            let rest = other
                .strip_prefix(crate::backend::mcp::MCP_PREFIX)
                .unwrap_or(other);
            let (server, tool) = rest.split_once("__").unwrap_or(("", rest));
            (format!("Call MCP tool: {tool}"), format!("server: {server}"))
        }
        other => (other.to_string(), String::new()),
    }
}

/// Names + descriptions of every tool the model can actually call, parsed
/// from [`tools_json`] so the `/tools` listing can never drift from the
/// schema we hand to the model. Returns them in schema order.
pub fn tool_summaries() -> Vec<(String, String)> {
    let parsed: serde_json::Value = match serde_json::from_str(tools_json()) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    parsed
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let f = t.get("function")?;
                    let name = f.get("name")?.as_str()?.to_string();
                    let desc = f
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some((name, desc))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn is_file_or_workspace_request(prompt: &str) -> bool {
    let p = prompt.to_lowercase();
    [
        "arquivo",
        "file",
        "html",
        "index.html",
        "editar",
        "edit",
        "crie",
        "create",
        "write",
        "salve",
        "workspace",
    ]
    .iter()
    .any(|needle| p.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> ToolContext {
        let root = PathBuf::from("/tmp");
        ToolContext {
            workspace_root: root.clone(),
            workspace_roots: vec![root],
            model_name: String::new(),
            vision_model: String::new(),
            history_len: 0,
            show_tools: false,
            debug: false,
            graph_json: String::new(),
            mcp: None,
        }
    }

    #[test]
    fn inject_action_passes_through_when_action_present() {
        let args = r#"{"action":"read","path":"a.rs"}"#;
        assert_eq!(inject_action(args, "write"), args);
    }

    #[test]
    fn inject_action_injects_into_object_and_bare_input() {
        // Object with fields but no action: action prepended, fields kept.
        let out = inject_action(r#"{"path":"a.rs"}"#, "read");
        assert_eq!(out, r#"{"action":"read","path":"a.rs"}"#);
        // Empty object and non-JSON both collapse to a bare action object.
        assert_eq!(inject_action("{}", "read"), r#"{"action":"read"}"#);
        assert_eq!(inject_action("garbage", "edit"), r#"{"action":"edit"}"#);
    }

    #[test]
    fn normalize_tool_name_handles_stutter_and_precedence() {
        assert_eq!(normalize_tool_name("read_file"), "read_file");
        assert_eq!(normalize_tool_name("read_fileread_file"), "read_file");
        // "context_node" must win over the "context" substring.
        assert_eq!(normalize_tool_name("context_node"), "context_node");
        assert_eq!(normalize_tool_name("totally_unknown"), "totally_unknown");
    }

    #[test]
    fn get_string_field_parses_clean_and_messy_json() {
        assert_eq!(
            get_string_field(r#"{"path":"a.rs"}"#, "path").as_deref(),
            Some("a.rs")
        );
        // Whitespace + escaped chars.
        assert_eq!(
            get_string_field(r#"{ "p": "a\"b" }"#, "p").as_deref(),
            Some("a\"b")
        );
        // Two concatenated objects (parallel calls): first one wins.
        assert_eq!(
            get_string_field(r#"{"path":"a"}{"path":"b"}"#, "path").as_deref(),
            Some("a")
        );
        // Non-string scalar is coerced.
        assert_eq!(get_string_field(r#"{"n":42}"#, "n").as_deref(), Some("42"));
        assert_eq!(get_string_field(r#"{"path":"a"}"#, "missing"), None);
    }

    #[test]
    fn get_bool_and_int_fields_accept_strings() {
        assert_eq!(get_bool_field(r#"{"b":true}"#, "b"), Some(true));
        assert_eq!(get_bool_field(r#"{"b":"yes"}"#, "b"), Some(true));
        assert_eq!(get_bool_field(r#"{"b":"off"}"#, "b"), Some(false));
        assert_eq!(get_int_field(r#"{"n":42}"#, "n"), Some(42));
        assert_eq!(get_int_field(r#"{"n":"42"}"#, "n"), Some(42));
        assert_eq!(get_int_field(r#"{"n":-7}"#, "n"), Some(-7));
    }

    #[test]
    fn tool_summaries_match_schema_and_dont_drift() {
        let names: Vec<String> = tool_summaries().into_iter().map(|(n, _)| n).collect();
        assert!(!names.is_empty());
        // Every advertised tool is dispatchable (or intentionally intercepted).
        for n in [
            "terminal", "file", "search", "fetch", "graph", "vision", "bg", "ask_user",
        ] {
            assert!(names.contains(&n.to_string()), "schema missing {n}");
        }
    }

    #[test]
    fn chat_mode_tools_are_read_only_subset() {
        let json = tools_json_filtered(CHAT_MODE_TOOLS);
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        let names: Vec<&str> = parsed
            .iter()
            .filter_map(|t| t.get("function")?.get("name")?.as_str())
            .collect();
        // Every advertised chat tool is in the allowlist.
        for n in &names {
            assert!(CHAT_MODE_TOOLS.contains(n), "unexpected chat tool {n}");
        }
        // The read-only staples are present; the mutating ones are not.
        assert!(names.contains(&"vision"));
        assert!(names.contains(&"file"));
        assert!(!names.contains(&"terminal"));
        assert!(!names.contains(&"context_node"));
        assert!(!names.contains(&"graph_focus"));
        assert!(!names.contains(&"bg"));
    }

    #[test]
    fn chat_mode_allows_reads_but_not_writes() {
        assert!(chat_mode_allows("vision", r#"{"path":"a.png"}"#));
        assert!(chat_mode_allows("search", r#"{"pattern":"x"}"#));
        assert!(chat_mode_allows("file", r#"{"action":"read","path":"a.rs"}"#));
        // file write/edit and legacy write names are blocked.
        assert!(!chat_mode_allows("file", r#"{"action":"write","path":"a.rs"}"#));
        assert!(!chat_mode_allows("file", r#"{"action":"edit","path":"a.rs"}"#));
        assert!(!chat_mode_allows("write_file", r#"{"path":"a.rs"}"#));
        // Mutating tools are always blocked in chat mode.
        assert!(!chat_mode_allows("terminal", r#"{"command":"ls"}"#));
        assert!(!chat_mode_allows("bg", r#"{"action":"list"}"#));
        assert!(!chat_mode_allows("context_node", r#"{"label":"x"}"#));
    }

    #[test]
    fn needs_review_confirmation_covers_side_effecting_tools() {
        // Side-effecting non-file tools require a generic confirmation.
        assert!(needs_review_confirmation("terminal", r#"{"command":"ls"}"#));
        assert!(needs_review_confirmation("context_node", r#"{"label":"x"}"#));
        // bg only when stopping a process; list/logs are read-only.
        assert!(needs_review_confirmation("bg", r#"{"action":"stop","pid":42}"#));
        assert!(!needs_review_confirmation("bg", r#"{"action":"list"}"#));
        assert!(!needs_review_confirmation("bg", r#"{"action":"logs","pid":42}"#));
        // file has its own diff-based flow; read-only tools never gate.
        assert!(!needs_review_confirmation("file", r#"{"action":"write"}"#));
        assert!(!needs_review_confirmation("search", r#"{"pattern":"x"}"#));
        assert!(!needs_review_confirmation("fetch", r#"{"url":"http://x"}"#));
    }

    #[test]
    fn confirm_summary_describes_the_action() {
        assert_eq!(
            confirm_summary("terminal", r#"{"command":"npm run build"}"#),
            ("Run terminal command".to_string(), "npm run build".to_string())
        );
        assert_eq!(
            confirm_summary("bg", r#"{"action":"stop","pid":42}"#).1,
            "pid 42"
        );
        assert_eq!(
            confirm_summary("context_node", r#"{"label":"parser","kind":"func"}"#).1,
            "parser (func)"
        );
    }

    #[test]
    fn confirm_summary_formats_mcp_tool_names() {
        let (title, detail) = confirm_summary("mcp__everything__echo", "{}");
        assert_eq!(title, "Call MCP tool: echo");
        assert_eq!(detail, "server: everything");
        // Native tools keep their existing summaries.
        let (title, _) = confirm_summary("terminal", r#"{"command":"ls"}"#);
        assert_eq!(title, "Run terminal command");
    }

    #[test]
    fn run_rejects_unknown_and_intercepted_tools() {
        assert!(run("does_not_exist", "{}", &ctx()).is_err());
        // ask_user must never reach dispatch — it errors loudly if it does.
        assert!(run("ask_user", "{}", &ctx()).is_err());
    }

    #[test]
    fn is_file_or_workspace_request_matches_pt_and_en() {
        assert!(is_file_or_workspace_request("crie um arquivo novo"));
        assert!(is_file_or_workspace_request("edit the workspace"));
        assert!(!is_file_or_workspace_request("qual a capital da França?"));
    }
}
