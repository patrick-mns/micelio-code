//! End-to-end smoke test against a real MCP server (`@modelcontextprotocol/
//! server-everything` over stdio). Ignored by default because it spawns a
//! child process and needs `npx` on PATH + network for the first fetch.
//!
//! Run explicitly with (serial — the tests share the process-global `HOME`):
//!   cargo test --lib mcp::e2e_test -- --ignored --nocapture --test-threads=1

use super::config::{McpConfigFile, McpServerConfig};
use super::McpManager;
use std::collections::BTreeMap;

/// Point the manager's config loader at a temp `mcp.json` by overriding HOME.
/// Returns a guard that restores the previous HOME on drop.
struct HomeGuard(Option<String>);
impl Drop for HomeGuard {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

#[test]
#[ignore = "spawns a real MCP server via npx; run with --ignored"]
fn connects_lists_and_calls_a_real_server() {
    // Sandbox HOME so we write a throwaway ~/.micelio/mcp.json.
    let tmp = std::env::temp_dir().join(format!("micelio-mcp-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", &tmp) };
    let _guard = HomeGuard(prev);

    // Write a config with one stdio server.
    let mut servers = BTreeMap::new();
    servers.insert(
        "everything".to_string(),
        McpServerConfig {
            command: Some("npx".into()),
            args: vec![
                "-y".into(),
                "@modelcontextprotocol/server-everything".into(),
            ],
            env: BTreeMap::new(),
            url: None,
            auth: None,
            enabled: true,
        },
    );
    super::config::save(&McpConfigFile {
        mcp_servers: servers,
    })
    .unwrap();

    let mgr = McpManager::new().unwrap();
    mgr.reload();

    let status = mgr.server_status();
    println!("status: {status:?}");
    let ev = status
        .iter()
        .find(|s| s.name == "everything")
        .expect("server listed");
    assert!(ev.connected, "server failed to connect: {:?}", ev.error);
    assert!(ev.tool_count > 0, "no tools discovered");

    // The "everything" server exposes an `echo` tool.
    let tools = mgr.list_tools();
    println!(
        "tools: {:?}",
        tools.iter().map(|t| &t.namespaced).collect::<Vec<_>>()
    );
    let echo = tools
        .iter()
        .find(|t| t.name == "echo")
        .expect("echo tool present");

    let out = mgr
        .call(&echo.namespaced, r#"{"message":"hi from micelio"}"#)
        .expect("call succeeded");
    println!("echo result: {out}");
    assert!(
        out.contains("hi from micelio"),
        "unexpected echo output: {out}"
    );
}

/// Exercises the Streamable HTTP transport. Requires a running server, e.g.:
///   npx -y @modelcontextprotocol/server-everything streamableHttp
/// which listens on http://localhost:3001/mcp.
#[test]
#[ignore = "needs a Streamable HTTP MCP server on :3001; run with --ignored"]
fn connects_over_http() {
    let tmp = std::env::temp_dir().join(format!("micelio-mcp-http-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", &tmp) };
    let _guard = HomeGuard(prev);

    let mut servers = BTreeMap::new();
    servers.insert(
        "http-everything".to_string(),
        McpServerConfig {
            command: None,
            args: vec![],
            env: BTreeMap::new(),
            url: Some("http://localhost:3001/mcp".into()),
            auth: None,
            enabled: true,
        },
    );
    super::config::save(&McpConfigFile {
        mcp_servers: servers,
    })
    .unwrap();

    let mgr = McpManager::new().unwrap();
    mgr.reload();

    let status = mgr.server_status();
    println!("http status: {status:?}");
    let ev = status
        .iter()
        .find(|s| s.name == "http-everything")
        .expect("server listed");
    assert!(
        ev.connected,
        "HTTP server failed to connect: {:?}",
        ev.error
    );
    assert!(ev.tool_count > 0, "no tools discovered over HTTP");

    let tools = mgr.list_tools();
    let echo = tools
        .iter()
        .find(|t| t.name == "echo")
        .expect("echo tool present");
    let out = mgr
        .call(&echo.namespaced, r#"{"message":"hi over http"}"#)
        .expect("http call succeeded");
    println!("http echo result: {out}");
    assert!(
        out.contains("hi over http"),
        "unexpected echo output: {out}"
    );
}

/// Smoke test for the HTTPS path against a real public Streamable HTTP server
/// (DeepWiki). Guards that the reqwest client has a TLS backend — plain-HTTP
/// tests wouldn't catch a missing-TLS regression. Needs network.
#[test]
#[ignore = "hits the public DeepWiki MCP over HTTPS; run with --ignored"]
fn connects_over_https_deepwiki() {
    let tmp = std::env::temp_dir().join(format!("micelio-mcp-https-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let prev = std::env::var("HOME").ok();
    unsafe { std::env::set_var("HOME", &tmp) };
    let _guard = HomeGuard(prev);

    let mut servers = BTreeMap::new();
    servers.insert(
        "deepwiki".to_string(),
        McpServerConfig {
            command: None,
            args: vec![],
            env: BTreeMap::new(),
            url: Some("https://mcp.deepwiki.com/mcp".into()),
            auth: None,
            enabled: true,
        },
    );
    super::config::save(&McpConfigFile {
        mcp_servers: servers,
    })
    .unwrap();

    let mgr = McpManager::new().unwrap();
    mgr.reload();

    let status = mgr.server_status();
    println!("https status: {status:?}");
    let ev = status
        .iter()
        .find(|s| s.name == "deepwiki")
        .expect("server listed");
    assert!(
        ev.connected,
        "HTTPS server failed to connect: {:?}",
        ev.error
    );
    assert!(ev.tool_count > 0, "no tools discovered over HTTPS");
    println!(
        "deepwiki tools: {:?}",
        mgr.list_tools().iter().map(|t| &t.name).collect::<Vec<_>>()
    );
}
