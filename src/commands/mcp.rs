//! Tauri commands backing the MCP settings panel: list connected servers and
//! their tools, read/write the raw `mcp.json`, and reconnect. All editing goes
//! through the raw config (the settings panel is a JSON editor), so there are no
//! per-field mutation commands — saving validates, persists, and reconnects in
//! one round-trip, returning the fresh server status.

use tauri::State;

use crate::backend::mcp::{config, McpServerStatus, McpToolInfo};
use crate::AppState;

/// Connection status for every configured server.
#[tauri::command]
pub fn mcp_list_servers(state: State<AppState>) -> Vec<McpServerStatus> {
    state.mcp.server_status()
}

/// Every tool discovered across all connected servers.
#[tauri::command]
pub fn mcp_list_tools(state: State<AppState>) -> Vec<McpToolInfo> {
    state.mcp.list_tools()
}

/// Raw `mcp.json` text for the editor (a template when the file is absent).
#[tauri::command]
pub fn mcp_get_config() -> String {
    config::load_raw()
}

/// Validate + persist edited `mcp.json`, then reconnect. Returns the fresh
/// server status, or an error string when the JSON is invalid (nothing is
/// written in that case).
#[tauri::command]
pub fn mcp_save_config(
    state: State<AppState>,
    raw: String,
) -> Result<Vec<McpServerStatus>, String> {
    config::save_raw(&raw)?;
    state.mcp.reload();
    Ok(state.mcp.server_status())
}

/// Force a reconnect of all servers without editing the config.
#[tauri::command]
pub fn mcp_reload(state: State<AppState>) -> Vec<McpServerStatus> {
    state.mcp.reload();
    state.mcp.server_status()
}
