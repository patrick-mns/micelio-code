use super::{ToolContext, ToolResult};
use std::time::Duration;

/// Hard cap on returned text so a large page can't blow the context window.
const MAX_OUTPUT_CHARS: usize = 20_000;
/// Overall request timeout.
const TIMEOUT: Duration = Duration::from_secs(20);

pub fn run(arguments: &str, _context: &ToolContext) -> Result<ToolResult, String> {
    let url = super::get_string_field(arguments, "url")
        .ok_or_else(|| "tool call missing `url`".to_string())?;
    let url = url.trim();

    // Only http(s). Blocks file://, data:, etc.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("fetch only supports http/https URLs, got `{url}`"));
    }

    let resp = ureq::get(url)
        .timeout(TIMEOUT)
        .set(
            "User-Agent",
            "MicelioCode/1.0 (+https://github.com/patrick-mns/micelio-code)",
        )
        .call();

    let resp = match resp {
        Ok(r) => r,
        // A non-2xx status is not a hard error: surface it (with a body
        // snippet) so the model can reason about a 404/500 instead of giving up.
        Err(ureq::Error::Status(code, r)) => {
            let snippet: String = r
                .into_string()
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect();
            return Ok(ToolResult {
                content: format!("HTTP {code} for {url}\n\n{}", snippet.trim()),
            });
        }
        Err(e) => return Err(format!("fetch failed for {url}: {e}")),
    };

    let status = resp.status();
    let content_type = resp
        .header("content-type")
        .unwrap_or("")
        .to_ascii_lowercase();

    let body = resp
        .into_string()
        .map_err(|e| format!("failed to read body from {url}: {e}"))?;

    // Convert HTML to readable text; pass other types (JSON, plain text) through.
    let text = if content_type.contains("html") || looks_like_html(&body) {
        html_to_text(&body)
    } else {
        body
    };
    let text = text.trim();

    let total = text.chars().count();
    let content = if total > MAX_OUTPUT_CHARS {
        let shown: String = text.chars().take(MAX_OUTPUT_CHARS).collect();
        format!("[{status}] {url}\n\n{shown}\n\n… (truncated; {total} chars total)")
    } else {
        format!("[{status}] {url}\n\n{text}")
    };

    Ok(ToolResult { content })
}

fn looks_like_html(body: &str) -> bool {
    let head = body.trim_start();
    let lower = head[..head.len().min(512)].to_ascii_lowercase();
    lower.starts_with("<!doctype html") || lower.starts_with("<html") || lower.contains("<body")
}

/// Strip HTML to plain text without pulling in a parser crate: drop
/// `<script>`/`<style>` blocks wholesale, remove the remaining tags, decode a
/// handful of common entities, and collapse runs of whitespace.
fn html_to_text(html: &str) -> String {
    // ASCII-only lowercasing preserves byte offsets, so indices stay valid.
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    while i < html.len() {
        if bytes[i] == b'<' {
            if let Some(rest) = skip_block(&lower, i, "script") {
                i = rest;
                out.push(' ');
                continue;
            }
            if let Some(rest) = skip_block(&lower, i, "style") {
                i = rest;
                out.push(' ');
                continue;
            }
            // Plain tag: skip up to and including '>'.
            match html[i..].find('>') {
                Some(end) => {
                    i += end + 1;
                    out.push(' ');
                }
                None => break, // malformed/truncated tag — stop here
            }
            continue;
        }
        let ch = html[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    decode_entities(&collapse_ws(&out))
}

/// If a `<tag…>…</tag>` block starts at `i`, return the byte index just past
/// its closing tag. Otherwise `None`.
fn skip_block(lower: &str, i: usize, tag: &str) -> Option<usize> {
    let open = format!("<{tag}");
    if !lower[i..].starts_with(&open) {
        return None;
    }
    let close = format!("</{tag}>");
    match lower[i..].find(&close) {
        Some(end) => Some(i + end + close.len()),
        None => Some(lower.len()), // unterminated block: drop the rest
    }
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_space = false;
    let mut last_newline = false;
    for ch in s.chars() {
        if ch == '\n' {
            if !last_newline {
                out.push('\n');
            }
            last_newline = true;
            last_space = true;
        } else if ch.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
        } else {
            out.push(ch);
            last_space = false;
            last_newline = false;
        }
    }
    out.trim().to_string()
}

fn decode_entities(s: &str) -> String {
    // Decode `&amp;` last so we don't double-decode (e.g. `&amp;lt;`).
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_to_text_strips_tags_scripts_and_entities() {
        let html = r#"<!doctype html><html><head>
            <style>.a{color:red}</style>
            <script>var x = 1 < 2;</script>
            </head><body><h1>Hi &amp; bye</h1><p>a &lt;b&gt;</p></body></html>"#;
        let text = html_to_text(html);
        assert!(text.contains("Hi & bye"), "got: {text}");
        assert!(text.contains("a <b>"), "got: {text}");
        // script/style contents must be gone
        assert!(!text.contains("color:red"), "got: {text}");
        assert!(!text.contains("var x"), "got: {text}");
    }

    #[test]
    fn looks_like_html_detects_markup() {
        assert!(looks_like_html("<!DOCTYPE html><html>"));
        assert!(looks_like_html("  <html lang=\"en\">"));
        assert!(!looks_like_html("{\"json\":true}"));
    }

    #[test]
    fn rejects_non_http_schemes() {
        let root = std::path::PathBuf::from("/tmp");
        let ctx = ToolContext {
            workspace_root: root.clone(),
            workspace_roots: vec![root],
            model_name: String::new(),
            vision_model: String::new(),
            history_len: 0,
            show_tools: false,
            debug: false,
            graph_json: String::new(),
            mcp: None,
        };
        assert!(run(r#"{"url":"file:///etc/passwd"}"#, &ctx).is_err());
        assert!(run(r#"{"url":"ftp://example.com"}"#, &ctx).is_err());
        assert!(run("{}", &ctx).is_err()); // missing url
    }
}
