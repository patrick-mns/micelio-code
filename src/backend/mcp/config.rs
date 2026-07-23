//! On-disk configuration for MCP servers.
//!
//! Stored at `~/.micelio/mcp.json` using the same `mcpServers` shape as Claude
//! Desktop, so existing configs paste over cleanly. A server entry is a stdio
//! server when it has a `command`, or an HTTP (Streamable HTTP) server when it
//! has a `url`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// OAuth configuration for HTTP servers.
///
/// By default the client registers itself with the authorization server
/// (Dynamic Client Registration, RFC 7591). Some servers reject DCR and only
/// accept pre-registered clients — set `client_id` (and `client_secret` when the
/// server issues one) to skip registration and use those credentials directly.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OAuthConfig {
    /// OAuth scope(s) required by the server (space-separated). Auto-detected
    /// from the server's metadata when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Pre-registered OAuth client id. When set, dynamic registration is skipped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// Client secret for a confidential pre-registered client (optional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
}

/// A single MCP server definition. Presence of `command` selects the stdio
/// transport; presence of `url` selects Streamable HTTP. `enabled` defaults to
/// true so a freshly pasted config connects without extra flags.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpServerConfig {
    /// stdio: executable to spawn (e.g. `npx`, `uvx`, an absolute path).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// stdio: arguments passed to `command`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// stdio: extra environment variables for the child process.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// HTTP: Streamable HTTP endpoint URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// OAuth configuration for HTTP servers (optional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<OAuthConfig>,
    /// Whether Micélio should connect to this server. Defaults to true.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

impl McpServerConfig {
    /// True when this entry describes a stdio (child-process) server.
    pub fn is_stdio(&self) -> bool {
        self.command
            .as_deref()
            .map(|c| !c.is_empty())
            .unwrap_or(false)
    }

    /// True when this entry describes an HTTP (Streamable HTTP) server.
    pub fn is_http(&self) -> bool {
        !self.is_stdio() && self.url.as_deref().map(|u| !u.is_empty()).unwrap_or(false)
    }
}

/// Root of `mcp.json`. Keyed by a user-chosen server name (used to namespace
/// the server's tools as `mcp__<name>__<tool>`). `BTreeMap` keeps a stable,
/// human-friendly ordering on rewrite.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfigFile {
    #[serde(default, rename = "mcpServers")]
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
}

/// Absolute path to `~/.micelio/mcp.json`.
pub fn config_path() -> PathBuf {
    crate::backend::config::app_data_dir().join("mcp.json")
}

/// Read `mcp.json`, returning an empty config when the file is missing or
/// malformed (best-effort: a broken file never crashes the app).
pub fn load() -> McpConfigFile {
    let path = config_path();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return McpConfigFile::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Persist a structured config to `mcp.json`. Only used by tests now that the
/// settings panel edits the raw JSON directly (see [`save_raw`]).
#[cfg(test)]
pub fn save(cfg: &McpConfigFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    write_raw(&json)
}

/// Raw text of `mcp.json` for the in-settings editor. Returns a minimal
/// template when the file doesn't exist yet, so the editor is never blank.
pub fn load_raw() -> String {
    std::fs::read_to_string(config_path())
        .unwrap_or_else(|_| "{\n  \"mcpServers\": {}\n}\n".to_string())
}

/// Validate that `raw` parses as a config, then write it verbatim (preserving
/// the user's formatting). Rejects invalid JSON with a readable error so the
/// editor can show it instead of persisting a broken file.
pub fn save_raw(raw: &str) -> Result<(), String> {
    serde_json::from_str::<McpConfigFile>(raw).map_err(|e| format!("invalid mcp.json: {e}"))?;
    write_raw(raw)
}

/// Write `contents` to `mcp.json`, creating `~/.micelio/` if needed.
fn write_raw(contents: &str) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}
