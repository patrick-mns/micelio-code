//! OAuth 2.1 authentication for HTTP MCP servers.
//!
//! Flow for a server that needs authorization (e.g. `https://mcp.figma.com/mcp`):
//! 1. [`connect_authorized`] is tried first — if we already have a token on disk
//!    it restores it and builds an authorized transport (no user interaction).
//! 2. When there's no usable token, the connect is reported as "needs auth" and
//!    the settings UI shows an **Authorize** button.
//! 3. Clicking it runs [`run_authorization_flow`]: we spin up a loopback callback
//!    server, open the system browser at the authorization URL, wait for the
//!    redirect, exchange the code for a token, and persist it.
//! 4. The next connect uses the stored token.
//!
//! Tokens are persisted per server at `~/.micelio/mcp_oauth/<server>.json`
//! (`{ client_id, token_response }`) so they survive restarts and can be
//! refreshed automatically by the SDK.

use std::path::PathBuf;

use rmcp::transport::auth::{OAuthClientConfig, OAuthState, OAuthTokenResponse};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{AuthClient, AuthorizationManager, StreamableHttpClientTransport};
use rmcp::ServiceExt;
use serde::{Deserialize, Serialize};

use super::Client;

/// A distinctive prefix so the manager can tell "the user still has to authorize"
/// apart from an ordinary transport failure and surface an Authorize button.
pub const NEEDS_AUTH_PREFIX: &str = "OAUTH_REQUIRED:";

/// Persisted OAuth credentials for one server.
#[derive(Serialize, Deserialize)]
struct StoredToken {
    client_id: String,
    token_response: OAuthTokenResponse,
}

/// `~/.micelio/mcp_oauth/`.
fn oauth_dir() -> PathBuf {
    crate::backend::config::app_data_dir().join("mcp_oauth")
}

/// Path to a server's persisted token. The server name is sanitized so it can
/// never escape the directory.
fn token_path(server_name: &str) -> PathBuf {
    let safe: String = server_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    oauth_dir().join(format!("{safe}.json"))
}

fn load_token(server_name: &str) -> Option<StoredToken> {
    let raw = std::fs::read_to_string(token_path(server_name)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_token(server_name: &str, token: &StoredToken) -> Result<(), String> {
    let dir = oauth_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(token).map_err(|e| e.to_string())?;
    std::fs::write(token_path(server_name), json).map_err(|e| e.to_string())
}

/// Delete a server's stored token (used when the user signs out / re-authorizes).
pub fn clear_token(server_name: &str) {
    let _ = std::fs::remove_file(token_path(server_name));
}

/// True when a persisted token exists for this server.
pub fn has_token(server_name: &str) -> bool {
    token_path(server_name).exists()
}

/// Build an authorized transport from a stored token and connect. Restores the
/// token into a fresh [`OAuthState`], which re-discovers metadata so the SDK can
/// refresh the access token on demand. Returns the running MCP client on success.
///
/// Errors are prefixed with [`NEEDS_AUTH_PREFIX`] when the token is missing or no
/// longer usable, so the caller knows to prompt for (re)authorization rather than
/// treat it as a hard failure.
pub async fn connect_authorized(
    server_name: &str,
    server_url: &str,
) -> Result<(Client, Vec<rmcp::model::Tool>), String> {
    let Some(stored) = load_token(server_name) else {
        return Err(format!("{NEEDS_AUTH_PREFIX} no stored credentials"));
    };

    let mut oauth_state = OAuthState::new(server_url, None)
        .await
        .map_err(|e| format!("{NEEDS_AUTH_PREFIX} {e}"))?;
    oauth_state
        .set_credentials(&stored.client_id, stored.token_response)
        .await
        .map_err(|e| format!("{NEEDS_AUTH_PREFIX} {e}"))?;

    let manager = oauth_state
        .into_authorization_manager()
        .ok_or_else(|| format!("{NEEDS_AUTH_PREFIX} failed to build authorization manager"))?;

    let auth_client = AuthClient::new(reqwest::Client::default(), manager);
    let transport = StreamableHttpClientTransport::with_client(
        auth_client,
        StreamableHttpClientTransportConfig::with_uri(server_url.to_string()),
    );

    let client: Client = ().serve(transport).await.map_err(auth_or_hard_error)?;
    let tools = client.list_all_tools().await.map_err(auth_or_hard_error)?;
    Ok((client, tools))
}

/// Classify a connect/list failure that occurred *with* a stored token. Auth-ish
/// failures (revoked/expired token the SDK couldn't refresh) are prefixed with
/// [`NEEDS_AUTH_PREFIX`] so the UI offers re-authorization; anything else (a
/// network blip) stays a plain error.
fn auth_or_hard_error<E: std::fmt::Display>(e: E) -> String {
    let msg = e.to_string();
    let low = msg.to_lowercase();
    if low.contains("auth")
        || low.contains("401")
        || low.contains("403")
        || low.contains("unauthorized")
        || low.contains("forbidden")
        || low.contains("token")
    {
        format!("{NEEDS_AUTH_PREFIX} {msg}")
    } else {
        msg
    }
}

/// Run the full interactive authorization flow for a server: open the browser,
/// receive the OAuth callback on a loopback server, exchange the code, and
/// persist the resulting token. Blocks until the user finishes (or the wait
/// times out). Does **not** connect — the caller reconnects afterwards so the
/// stored token is picked up by [`connect_authorized`].
pub async fn run_authorization_flow(
    server_name: &str,
    server_url: &str,
    scopes: &[String],
    client_id: Option<&str>,
    client_secret: Option<&str>,
    on_auth_url: impl FnOnce(&str),
) -> Result<(), String> {
    // Bind the loopback callback listener first so we know the port before we
    // register the redirect URI with the authorization server.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("failed to bind callback listener: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    // Two paths to a configured OAuth client:
    //  - pre-registered: caller supplied a client_id, so skip registration
    //  - dynamic: register with the authorization server (RFC 7591)
    let (auth_url, session) = match client_id {
        Some(id) => {
            preregistered_session(server_url, scopes, &redirect_uri, id, client_secret).await?
        }
        None => dynamic_session(server_url, scopes, &redirect_uri).await?,
    };

    // Let the caller open the browser / surface the URL.
    on_auth_url(&auth_url);
    open_in_browser(&auth_url);

    // Wait for the browser redirect (5-minute cap so a cancelled login frees up).
    let (code, csrf) = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        wait_for_callback(listener),
    )
    .await
    .map_err(|_| "authorization timed out — no callback received".to_string())??;

    let stored = session.finish(&code, &csrf).await?;
    save_token(server_name, &stored)
}

/// An in-progress authorization, ready to exchange the callback code for a token.
enum Session {
    /// Driven by the high-level state machine (dynamic client registration).
    Dynamic(Box<OAuthState>),
    /// Driven directly by the manager (pre-registered client credentials).
    Preregistered {
        manager: Box<AuthorizationManager>,
        client_id: String,
    },
}

impl Session {
    /// Exchange the authorization code for a token and return it for persisting.
    async fn finish(self, code: &str, csrf: &str) -> Result<StoredToken, String> {
        match self {
            Session::Dynamic(mut state) => {
                state
                    .handle_callback(code, csrf)
                    .await
                    .map_err(|e| format!("failed to exchange authorization code: {e}"))?;
                let (client_id, token_response) = state
                    .get_credentials()
                    .await
                    .map_err(|e| format!("failed to read credentials: {e}"))?;
                let token_response =
                    token_response.ok_or_else(|| "authorization returned no token".to_string())?;
                Ok(StoredToken {
                    client_id,
                    token_response,
                })
            }
            Session::Preregistered { manager, client_id } => {
                let token_response = manager
                    .exchange_code_for_token(code, csrf)
                    .await
                    .map_err(|e| format!("failed to exchange authorization code: {e}"))?;
                Ok(StoredToken {
                    client_id,
                    token_response,
                })
            }
        }
    }
}

/// Start authorization by registering this client with the server (RFC 7591).
async fn dynamic_session(
    server_url: &str,
    scopes: &[String],
    redirect_uri: &str,
) -> Result<(String, Session), String> {
    let mut oauth_state = OAuthState::new(server_url, None)
        .await
        .map_err(|e| format!("failed to initialize OAuth: {e}"))?;

    let scope_refs: Vec<&str> = scopes.iter().map(|s| s.as_str()).collect();
    oauth_state
        .start_authorization(&scope_refs, redirect_uri, Some("Micélio"))
        .await
        .map_err(|e| registration_error(&e.to_string()))?;

    let auth_url = oauth_state
        .get_authorization_url()
        .await
        .map_err(|e| format!("failed to get authorization URL: {e}"))?;

    Ok((auth_url, Session::Dynamic(Box::new(oauth_state))))
}

/// Start authorization with a pre-registered client, skipping registration.
async fn preregistered_session(
    server_url: &str,
    scopes: &[String],
    redirect_uri: &str,
    client_id: &str,
    client_secret: Option<&str>,
) -> Result<(String, Session), String> {
    let mut manager = AuthorizationManager::new(server_url)
        .await
        .map_err(|e| format!("failed to initialize OAuth: {e}"))?;

    let metadata = manager
        .discover_metadata()
        .await
        .map_err(|e| format!("failed to discover authorization metadata: {e}"))?;
    manager.set_metadata(metadata);

    let mut config = OAuthClientConfig::new(client_id, redirect_uri).with_scopes(scopes.to_vec());
    if let Some(secret) = client_secret {
        config = config.with_client_secret(secret);
    }
    manager
        .configure_client(config)
        .map_err(|e| format!("failed to configure OAuth client: {e}"))?;

    let scope_refs: Vec<&str> = scopes.iter().map(|s| s.as_str()).collect();
    let auth_url = manager
        .get_authorization_url(&scope_refs)
        .await
        .map_err(|e| format!("failed to get authorization URL: {e}"))?;

    Ok((
        auth_url,
        Session::Preregistered {
            manager: Box::new(manager),
            client_id: client_id.to_string(),
        },
    ))
}

/// Turn a dynamic-registration failure into something the user can act on.
/// A 401/403 here means the server doesn't hand out client credentials to
/// arbitrary clients (some vendors allowlist approved MCP clients instead).
fn registration_error(raw: &str) -> String {
    let low = raw.to_lowercase();
    if low.contains("registration") && (low.contains("403") || low.contains("401")) {
        return format!(
            "This server refused dynamic client registration ({raw}). \
             It likely only accepts pre-registered or allowlisted clients — \
             set `auth.client_id` (and `auth.client_secret` if issued) in mcp.json, \
             or check the provider's docs for how to get access."
        );
    }
    format!("failed to start authorization: {raw}")
}

/// Await a single HTTP request on the loopback listener and pull `code` and
/// `state` out of the query string. Replies with a small confirmation page so
/// the user knows they can close the tab.
async fn wait_for_callback(listener: tokio::net::TcpListener) -> Result<(String, String), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("callback accept failed: {e}"))?;

        // Read the request head — enough to see the request line with the query.
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        let head = String::from_utf8_lossy(&buf[..n]);

        // Request line: `GET /callback?code=...&state=... HTTP/1.1`.
        let target = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("");

        // Favicon/other probes: keep waiting for the real callback.
        if !target.starts_with("/callback") {
            let _ = respond(&mut stream, "Waiting for authorization…").await;
            continue;
        }

        let (code, state) = parse_callback_query(target);

        let body = if code.is_some() {
            "Authorization complete. You can close this tab and return to Micélio."
        } else {
            "Authorization failed or was denied. You can close this tab."
        };
        let _ = respond(&mut stream, body).await;
        let _ = stream.shutdown().await;

        return match (code, state) {
            (Some(c), Some(s)) => Ok((c, s)),
            _ => Err("callback missing `code`/`state` parameters".to_string()),
        };
    }
}

/// Extract `code` and `state` from a `/callback?...` request target.
fn parse_callback_query(target: &str) -> (Option<String>, Option<String>) {
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            let val = url_decode(v);
            match k {
                "code" => code = Some(val),
                "state" => state = Some(val),
                _ => {}
            }
        }
    }
    (code, state)
}

/// Minimal percent-decoding for callback query values (`%XX` and `+`).
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

async fn respond(stream: &mut tokio::net::TcpStream, body: &str) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Micélio</title></head>\
         <body style=\"font-family:system-ui;padding:3rem;text-align:center\">\
         <h2>{body}</h2></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes()).await
}

/// Open a URL in the user's default browser (best-effort).
fn open_in_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(windows)]
    let _ = crate::backend::cmd::no_window_cmd("cmd.exe")
        .args(["/C", "start", "", url])
        .spawn();
}
