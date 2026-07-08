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
}

impl ToolContext {
    pub fn resolve_path(&self, arg: &str) -> PathBuf {
        let path = std::path::Path::new(arg);
        if path.is_absolute() {
            return path.to_path_buf();
        }
        
        // Find existing match in any workspace root
        for root in &self.workspace_roots {
            let full = root.join(path);
            if full.exists() {
                return full;
            }
        }
        
        // Fallback to first workspace_root if none exist
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
pub fn normalize_tool_name<'a>(name: &'a str) -> &'a str {
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
