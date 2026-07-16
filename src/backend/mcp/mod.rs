//! MCP (Model Context Protocol) client integration.
//!
//! The [`McpManager`] connects to external MCP servers (stdio child processes
//! and Streamable HTTP endpoints), discovers their tools at runtime, and
//! exposes them to the model as if they were native tools. Discovered tools are
//! advertised under a namespaced name — `mcp__<server>__<tool>` — so they never
//! collide with the built-in toolset and can be routed back to the right server
//! on dispatch.
//!
//! rmcp is async; the rest of the tool pipeline is synchronous (runs on a plain
//! worker thread). The manager owns its own multi-threaded Tokio runtime and
//! every public method is blocking: it drives the async rmcp calls to
//! completion via `block_on`. The runtime also keeps stdio child processes
//! alive for the lifetime of the manager.

pub mod config;
#[cfg(test)]
mod e2e_test;

use std::collections::HashMap;
use std::sync::Mutex;

use rmcp::model::{CallToolRequestParams, ContentBlock};
use rmcp::service::RunningService;
use rmcp::transport::{StreamableHttpClientTransport, TokioChildProcess};
use rmcp::{RoleClient, ServiceExt};

use config::McpServerConfig;

/// The namespacing prefix every discovered MCP tool is advertised under.
pub const MCP_PREFIX: &str = "mcp__";

/// One discovered tool, flattened out of its server for fast lookup and schema
/// generation.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    /// Server name this tool belongs to (the `mcp.json` key).
    pub server: String,
    /// Original tool name as reported by the server.
    pub name: String,
    /// Advertised name: `mcp__<server>__<tool>`.
    pub namespaced: String,
    /// Human-readable description (empty when the server omits one).
    pub description: String,
    /// JSON Schema for the tool's arguments (an object schema).
    pub input_schema: serde_json::Value,
    /// From the server's `readOnlyHint` annotation (default false). Drives the
    /// Chat-mode gate: only read-only MCP tools are allowed there.
    pub read_only: bool,
}

/// Connection status for one configured server, for the settings UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub name: String,
    /// Whether the server is enabled in `mcp.json` (independent of whether the
    /// connection actually succeeded).
    pub enabled: bool,
    pub connected: bool,
    pub tool_count: usize,
    /// Transport kind: "stdio" or "http".
    pub transport: String,
    /// Short, human-readable connection error when the last connect attempt
    /// failed (see [`friendly_error`]).
    pub error: Option<String>,
    /// Full raw error, surfaced on hover for debugging.
    pub error_detail: Option<String>,
}

type Client = RunningService<RoleClient, ()>;
type McpConnectResult = (
    String,
    String,
    Result<(Client, Vec<rmcp::model::Tool>), String>,
);

#[derive(Default)]
struct State {
    /// Live client per connected server.
    clients: HashMap<String, Client>,
    /// All discovered tools across every connected server.
    tools: Vec<McpToolInfo>,
    /// Per-server status (including servers that failed to connect).
    status: Vec<McpServerStatus>,
}

/// Owns the Tokio runtime and every live MCP connection. Stored in the Tauri
/// `AppState` as an `Arc` and cloned into each [`crate::backend::tools::ToolContext`].
pub struct McpManager {
    rt: tokio::runtime::Runtime,
    state: Mutex<State>,
}

impl McpManager {
    /// Build the manager with a dedicated multi-threaded runtime. Does not
    /// connect yet — call [`McpManager::reload`] to read `mcp.json` and connect.
    pub fn new() -> std::io::Result<Self> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?;
        Ok(Self {
            rt,
            state: Mutex::new(State::default()),
        })
    }

    /// (Re)connect: drop all current connections, read `mcp.json`, and connect
    /// every enabled server. Connections run **concurrently** on the runtime, so
    /// one slow/hung server (npx cold start, unreachable URL) never holds up the
    /// others — the total time is the slowest single connect, not the sum.
    /// Best-effort: a server that fails is recorded in the status list.
    pub fn reload(&self) {
        let cfg = config::load();
        let mut clients: HashMap<String, Client> = HashMap::new();
        let mut tools: Vec<McpToolInfo> = Vec::new();
        let mut status: Vec<McpServerStatus> = Vec::new();

        // Fan out every enabled server's connect onto the runtime; disabled
        // entries are recorded directly.
        let mut set: tokio::task::JoinSet<McpConnectResult> = tokio::task::JoinSet::new();
        for (name, server) in cfg.mcp_servers {
            let transport = if server.is_stdio() { "stdio" } else { "http" };
            if !server.enabled {
                status.push(McpServerStatus {
                    name,
                    enabled: false,
                    connected: false,
                    tool_count: 0,
                    transport: transport.to_string(),
                    error: None,
                    error_detail: None,
                });
                continue;
            }
            let transport = transport.to_string();
            set.spawn_on(
                async move { (name, transport, connect_server(server).await) },
                self.rt.handle(),
            );
        }

        // Collect results as they finish.
        let results = self.rt.block_on(async move {
            let mut out = Vec::new();
            while let Some(joined) = set.join_next().await {
                if let Ok(v) = joined {
                    out.push(v);
                }
            }
            out
        });

        for (name, transport, result) in results {
            match result {
                Ok((client, discovered)) => {
                    let count = discovered.len();
                    for t in discovered {
                        tools.push(namespaced_tool(&name, t));
                    }
                    clients.insert(name.clone(), client);
                    status.push(McpServerStatus {
                        name,
                        enabled: true,
                        connected: true,
                        tool_count: count,
                        transport,
                        error: None,
                        error_detail: None,
                    });
                }
                Err(e) => status.push(McpServerStatus {
                    name,
                    enabled: true,
                    connected: false,
                    tool_count: 0,
                    transport,
                    error: Some(friendly_error(&e)),
                    error_detail: Some(e),
                }),
            }
        }

        // Stable ordering so the UI list doesn't jump around by finish order.
        status.sort_by(|a, b| a.name.cmp(&b.name));
        tools.sort_by(|a, b| (&a.server, &a.name).cmp(&(&b.server, &b.name)));

        // Cancel the previous generation of connections after swapping in the
        // new set, so old stdio children are torn down.
        let mut guard = self.state.lock().unwrap();
        let old = std::mem::replace(
            &mut *guard,
            State {
                clients,
                tools,
                status,
            },
        );
        drop(guard);
        for (_, client) in old.clients {
            let _ = self.rt.block_on(client.cancel());
        }
    }

    /// OpenAI-function tool schemas for every discovered tool. When
    /// `read_only_only` is set (Chat mode), only read-only tools are included.
    pub fn tools_schema(&self, read_only_only: bool) -> Vec<serde_json::Value> {
        let guard = self.state.lock().unwrap();
        guard
            .tools
            .iter()
            .filter(|t| !read_only_only || t.read_only)
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.namespaced,
                        "description": t.description,
                        "parameters": t.input_schema,
                    }
                })
            })
            .collect()
    }

    /// Whether a namespaced MCP tool exists and is marked read-only.
    pub fn is_read_only(&self, namespaced: &str) -> bool {
        let guard = self.state.lock().unwrap();
        guard
            .tools
            .iter()
            .find(|t| t.namespaced == namespaced)
            .map(|t| t.read_only)
            .unwrap_or(false)
    }

    /// True when any MCP tool is currently advertised under this exact name.
    pub fn has_tool(&self, namespaced: &str) -> bool {
        let guard = self.state.lock().unwrap();
        guard.tools.iter().any(|t| t.namespaced == namespaced)
    }

    /// Invoke a namespaced MCP tool with raw JSON arguments, returning the
    /// tool's text output (content blocks concatenated).
    pub fn call(&self, namespaced: &str, arguments: &str) -> Result<String, String> {
        let (server, tool) = split_namespaced(namespaced)
            .ok_or_else(|| format!("`{namespaced}` is not a valid MCP tool name"))?;

        // Parse arguments into a JSON object (MCP requires an object or none).
        let args_obj = match serde_json::from_str::<serde_json::Value>(arguments) {
            Ok(serde_json::Value::Object(map)) => Some(map),
            _ => None,
        };

        // Clone the server's peer handle and release the lock *before* the
        // (potentially slow) call, so an in-flight MCP tool never blocks the UI
        // (list/status) or a concurrent reload on the state mutex.
        let peer = {
            let guard = self.state.lock().unwrap();
            guard
                .clients
                .get(server)
                .ok_or_else(|| format!("MCP server `{server}` is not connected"))?
                .peer()
                .clone()
        };

        let mut params = CallToolRequestParams::new(tool.to_string());
        params.arguments = args_obj;

        let result = self
            .rt
            .block_on(peer.call_tool(params))
            .map_err(|e| e.to_string())?;

        Ok(render_result(&result))
    }

    /// Flattened list of every discovered tool (for `/tools` and the UI).
    pub fn list_tools(&self) -> Vec<McpToolInfo> {
        self.state.lock().unwrap().tools.clone()
    }

    /// Per-server connection status (for the settings UI).
    pub fn server_status(&self) -> Vec<McpServerStatus> {
        self.state.lock().unwrap().status.clone()
    }
}

/// Connect to one server and list its tools. A free async fn (not a method) so
/// it can be spawned as an independent task per server during [`McpManager::reload`].
async fn connect_server(
    server: McpServerConfig,
) -> Result<(Client, Vec<rmcp::model::Tool>), String> {
    let client: Client = if server.is_stdio() {
        let command = server.command.clone().unwrap_or_default();
        let mut std_cmd = crate::backend::cmd::no_window_cmd(&command);
        std_cmd.args(&server.args);
        for (k, v) in &server.env {
            std_cmd.env(k, v);
        }
        let cmd = tokio::process::Command::from(std_cmd);
        let transport = TokioChildProcess::new(cmd).map_err(|e| e.to_string())?;
        ().serve(transport).await.map_err(|e| e.to_string())?
    } else if server.is_http() {
        let url = server.url.clone().unwrap_or_default();
        let transport = StreamableHttpClientTransport::from_uri(url);
        ().serve(transport).await.map_err(|e| e.to_string())?
    } else {
        return Err("server has neither `command` nor `url`".to_string());
    };
    let tools = client.list_all_tools().await.map_err(|e| e.to_string())?;
    Ok((client, tools))
}

/// Build the namespaced tool name for a server + tool pair.
fn namespaced_name(server: &str, tool: &str) -> String {
    format!("{MCP_PREFIX}{server}__{tool}")
}

/// Split `mcp__<server>__<tool>` back into `(server, tool)`. The tool name may
/// itself contain `__`, so we split on the first `__` after the prefix only.
fn split_namespaced(namespaced: &str) -> Option<(&str, &str)> {
    let rest = namespaced.strip_prefix(MCP_PREFIX)?;
    let idx = rest.find("__")?;
    let server = &rest[..idx];
    let tool = &rest[idx + 2..];
    if server.is_empty() || tool.is_empty() {
        return None;
    }
    Some((server, tool))
}

/// Convert an rmcp [`rmcp::model::Tool`] into our flattened [`McpToolInfo`].
fn namespaced_tool(server: &str, tool: rmcp::model::Tool) -> McpToolInfo {
    let name = tool.name.to_string();
    let read_only = tool
        .annotations
        .as_ref()
        .and_then(|a| a.read_only_hint)
        .unwrap_or(false);
    let input_schema = serde_json::to_value(&*tool.input_schema)
        .unwrap_or_else(|_| serde_json::json!({ "type": "object" }));
    McpToolInfo {
        namespaced: namespaced_name(server, &name),
        description: tool.description.map(|d| d.to_string()).unwrap_or_default(),
        input_schema,
        read_only,
        server: server.to_string(),
        name,
    }
}

/// Turn a raw rmcp/transport error into a short, human-readable message.
/// The raw errors embed giant `[rmcp::transport::…<reqwest::…>]` type paths and
/// deep wrapper prefixes; we strip those and map the common network failures to
/// a plain sentence. The full raw string is kept separately (for hover).
fn friendly_error(raw: &str) -> String {
    // Drop the `[rmcp::transport::…]` type dump and collapse whitespace.
    let mut s = raw.to_string();
    if let (Some(a), Some(b)) = (s.find('['), s.find(']')) {
        if b > a {
            s.replace_range(a..=b, "");
        }
    }
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let low = s.to_lowercase();

    if low.contains("error sending request for url") || low.contains("connection refused") {
        return "Couldn't reach the server. Check that the URL is a running Streamable HTTP MCP endpoint.".into();
    }
    if low.contains("timed out") || low.contains("timeout") {
        return "The server timed out — it may be slow or unreachable.".into();
    }
    if low.contains("dns") || low.contains("resolve") || low.contains("name or service") {
        return "Couldn't resolve the server host. Check the URL.".into();
    }
    if low.contains("401")
        || low.contains("403")
        || low.contains("unauthorized")
        || low.contains("forbidden")
    {
        return "The server rejected the connection — authentication may be required.".into();
    }
    if low.contains("404") {
        return "Endpoint not found (404). Check the URL path.".into();
    }
    if low.contains("no such file") || low.contains("os error 2") {
        return "Command not found. Check that it's installed and on your PATH.".into();
    }

    // Fallback: cleaned message, capped so the block never blows up.
    let trimmed = s
        .trim_start_matches("Send message error")
        .trim_start_matches("Transport")
        .trim()
        .trim_start_matches("error:")
        .trim();
    let capped: String = trimmed.chars().take(180).collect();
    if capped.is_empty() {
        "Connection failed.".into()
    } else {
        capped
    }
}

/// Flatten a [`rmcp::model::CallToolResult`] into plain text for the model.
fn render_result(result: &rmcp::model::CallToolResult) -> String {
    let mut out = String::new();
    for block in &result.content {
        match block {
            ContentBlock::Text(t) => out.push_str(&t.text),
            ContentBlock::Image(_) => out.push_str("[image content]"),
            ContentBlock::Audio(_) => out.push_str("[audio content]"),
            ContentBlock::Resource(_) => out.push_str("[embedded resource]"),
            ContentBlock::ResourceLink(_) => out.push_str("[resource link]"),
            _ => out.push_str("[unsupported content]"),
        }
        out.push('\n');
    }
    let out = out.trim_end().to_string();
    if result.is_error.unwrap_or(false) {
        format!("tool reported an error: {out}")
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespacing_round_trips() {
        let n = namespaced_name("everything", "echo");
        assert_eq!(n, "mcp__everything__echo");
        assert_eq!(split_namespaced(&n), Some(("everything", "echo")));
    }

    #[test]
    fn split_handles_tool_names_with_double_underscore() {
        // Only the first `__` after the server delimits; the tool keeps the rest.
        assert_eq!(
            split_namespaced("mcp__srv__foo__bar"),
            Some(("srv", "foo__bar"))
        );
    }

    #[test]
    fn split_rejects_non_mcp_and_malformed() {
        assert_eq!(split_namespaced("terminal"), None);
        assert_eq!(split_namespaced("mcp__onlyserver"), None);
        assert_eq!(split_namespaced("mcp____tool"), None);
    }
}
