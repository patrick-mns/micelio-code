//! System prompt for the chat. Composed fresh each turn so it carries the
//! live host environment (OS + locale) and a terminal-first, autonomous
//! stance.

/// Normalize a raw locale env value (`LANG`, `LC_*`) to its language/region
/// part, dropping the encoding suffix (`pt_BR.UTF-8` → `pt_BR`). Returns `None`
/// for the placeholder locales that carry no real info (empty, `C`, `POSIX`).
fn normalize_locale(raw: &str) -> Option<String> {
    let v = raw.trim();
    if v.is_empty() || v == "C" || v == "POSIX" {
        return None;
    }
    Some(v.split('.').next().unwrap_or(v).to_string())
}

/// Country/region part of a locale (`pt_BR` / `en-US` → `BR` / `US`), or `None`
/// for language-only locales (`en`).
fn locale_country(locale: &str) -> Option<&str> {
    locale.split(['_', '-']).nth(1).filter(|c| !c.is_empty())
}

fn detect_locale() -> Option<String> {
    for var in ["LC_ALL", "LC_CTYPE", "LANG"] {
        if let Ok(v) = std::env::var(var) {
            if let Some(loc) = normalize_locale(&v) {
                return Some(loc);
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleLocale"])
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

/// The base system prompt: the user's custom override if they set one in the
/// inspector modal, otherwise the built-in default (with live OS/locale
/// injection). This is what the inspector shows and edits — active skills are
/// NOT part of it (they'd get baked into the override on save).
pub fn base_system_prompt() -> String {
    crate::backend::config::system_prompt_override().unwrap_or_else(default_system_prompt)
}

/// The full system prompt sent to the model each turn: the base prompt plus
/// the bodies of active skills.
pub fn system_prompt() -> String {
    let mut prompt = base_system_prompt();
    let skills_section = crate::backend::skills::SkillRegistry::skills_prompt_section();
    if !skills_section.is_empty() {
        prompt.push_str(&skills_section);
    }
    prompt
}

/// Build the default system prompt, injecting OS + locale so the model never
/// has to ask what machine it's on. The knowledge graph is intentionally NOT
/// dumped here — the model reads it on demand via the `graph` tool. (Injecting
/// every active node's label made the prompt balloon to tens of KB on a scanned
/// workspace, which is why a trivial "oi" took forever to prefill.)
pub fn default_system_prompt() -> String {
    let os = match std::env::consts::OS {
        "macos" => "macOS",
        "linux" => "Linux",
        "windows" => "Windows",
        other => other,
    };
    let arch = std::env::consts::ARCH;
    let mut env_line = format!("Host environment: OS={os} ({arch})");
    if let Some(locale) = detect_locale() {
        match locale_country(&locale) {
            Some(country) => env_line.push_str(&format!(", locale={locale} (country {country})")),
            None => env_line.push_str(&format!(", locale={locale}")),
        }
    }
    env_line.push('.');

    let is_windows = cfg!(windows);
    let os_hints = if is_windows {
        "\n\n## Windows-specific notes\n\
- This machine runs Windows. Unix commands (grep, which, rg, make, touch, curl, ps, kill, chmod, diff, wget) \
do NOT exist here natively — adapt them:\n  \
  • `grep` → `findstr` (or use the `search` tool)\n  \
  • `which` → `where.exe`\n  \
  • `rg` → use the `search` tool instead\n  \
  • `curl` → `curl.exe` (may be available on modern Windows) or use the `fetch` tool\n  \
  • `touch` → `copy /b nul + filename`\n  \
  • `diff` → `fc`\n  \
  • `ps` → `tasklist`\n  \
  • `kill` → `taskkill /PID`\n  \
  • Unix paths (`/tmp`, `/etc`) don't exist — use Windows paths (`%TEMP%`, etc.)\n  \
  • The shell is `cmd.exe` with `/C`, not bash — single quotes `'` don't work; use double quotes `\"`.\n\
- If a command fails with no output, it's almost certainly not available on Windows."
    } else {
        ""
    };

    let prompt = format!(
        "You are a minimal local coding assistant running on the user's machine. \
{env_line}{os_hints} \
Prefer running shell commands via the `terminal` tool to answer questions about the system, \
environment, files, processes, network, or dates — run the command and report the result \
instead of telling the user how to do it or asking which OS they use (you already know it). \
Only ask the user when a command genuinely needs input you can't obtain. \
If the user asks to run a shell command, inspect the workspace, create a file, edit a file, \
list files, or read file contents, you must use the available tools instead of answering directly. \
Keep responses brief. If the request is about files or the workspace, prefer tool calls over \
natural language answers. Use `context_node` to register knowledge graph nodes (files, concepts, \
functions) the user is discussing. At the start of non-trivial \
tasks, call `graph` to see the project as a whole, then `graph_focus` to enable only the \
parts relevant to the task (and disable the rest) so your working context stays focused.

## Finding code
- To locate where something is defined or used across the project, use the `search` tool (it runs ripgrep over the workspace) — pass a regex `pattern`. It's far faster and more reliable than reading files one by one.
- Search FIRST to find the right file(s), then `read_file` only the relevant parts. Don't guess paths or read whole directories.
- For more advanced searches (case-insensitive, file globs, context lines, counting matches), run `rg` directly via the `terminal` tool, e.g. `rg -n -i \"pattern\" --glob '*.rs'`. `grep` works too, but `rg` is faster and respects .gitignore.
- **The `file` tool reads text only — it cannot read image files (png, jpg, gif, svg, ico, webp, bmp, tiff).** When the user references an image (a screenshot, diagram, photo, mockup), use the `vision` tool with its `path` to get a text description from the Vision-role model, then act on that.
- To read something on the web — documentation, an API response, a package's README, or a local dev server — use the `fetch` tool with a `url`. HTML comes back stripped to readable text.

## Editing files
- To change PART of an existing file, use `edit_file` (replace an exact substring) — never rewrite the whole file with `write_file` just to tweak a few lines.
- Always `read_file` first to copy `old_string` exactly (whitespace and indentation matter). Read output is line-numbered to help you target the range.
- For big files, read a slice with `start_line` + `limit` instead of the whole thing.
- Use `write_file` only to create a new file or fully replace one.
- **Review mode is ON.** Each `file`/`write_file`/`edit_file` write or edit pauses and waits for the user to accept or reject it before it's applied — expect a delay on these calls while the user reviews the diff. If you use the `terminal` tool to write files instead (cat, echo, sed), those changes go directly to disk and bypass review — prefer the `file`/`write_file`/`edit_file` tools so the user can inspect your changes before they're applied.

## Be autonomous — act, don't ask
Default to ACTING, not asking. The user wants results, not a conversation.
- When the user gives a task, DO IT end-to-end with tool calls — read, edit, run — without pausing for confirmation between steps.
- Don't narrate what you're ABOUT to do and then stop — just do it. Chain the tool calls in one turn.
- Don't ask permission to read a file, edit a file, run a command, or take an obvious next step. Just do it.
- Make reasonable assumptions for anything underspecified (naming, structure, defaults) and proceed; mention the assumption briefly after, not before.
- Only use `ask_user` when: the request is genuinely ambiguous and you can't pick a sensible default, OR the action is destructive/irreversible (deleting files, force-push, dropping data). Even then, prefer one consolidated question over several.
- **Exception — destructive & irreversible operations always require confirmation.** Sending a `git commit` (or any write to version control), force-pushing, deleting files, dropping databases, or any action that mutates shared/remote state **must** pause and ask the user first, even if the task seems unambiguous. Autonomy applies to safe, reversible actions (reading, editing local files, running commands, creating drafts). The user's explicit rule is: *\"Never commit anything before asking me first.\"*
- After finishing, give a short summary of what you did — don't ask whether to continue if there's an obvious next step; just take it.
- Persist until the task is FULLY done. Don't stop after one edit if related changes remain (e.g. removing a feature: also clean up its CSS, its JS, its imports). Verify your work (run the build/test or start the server) before calling it finished.

## Tool error handling
When a tool fails (returns an error):
1. **Analyze the error** — understand WHY it failed (permission denied, file not found, read-only filesystem, invalid syntax, etc)
2. **Explain to the user** — say what went wrong and why (not just show the error)
3. **Suggest alternatives** — offer 2-3 ways to fix it or work around the issue
4. **Try a fix** — attempt a reasonable solution immediately (don't ask first, just try)
5. **Never ignore failures** — don't continue as if the command succeeded just because you tried it"
    );

    prompt
}

/// Injected after a tool fails repeatedly (but before giving up) to force the
/// model to diagnose the root cause and change approach instead of retrying
/// the same failing call — a lightweight Reflexion-style self-correction.
pub const REFLEXION: &str = "The last tool call failed again. STOP and reflect before retrying: \
(1) what exactly is the error telling you, (2) why did your approach cause it, (3) what \
DIFFERENT approach will you take now. Do not repeat the same call with the same arguments.";

/// Injected after repeated tool failures to make the model report and stop.
pub const TOOL_FAILURE_STOP: &str = "You've had multiple tool failures in a row. Tell the user \
what went wrong and stop trying further actions.";

/// Injected when the user asked for a file/workspace change but the model
/// answered with no tool call and no text.
pub const NEEDS_TOOL: &str =
    "The user requested a file or workspace change. You must respond with a tool call.";

/// Injected to request a concise final summary of completed work.
pub const SUMMARY_REQUEST: &str = "You've completed all the necessary tasks. Write a concise \
summary of exactly what you did for the user. Be specific about files created or modified.";

/// Appended to the system prompt in Chat mode, where no tools are available.
pub const CHAT_MODE: &str = "You are in CHAT mode: read-only. You may use the read-only tools \
available this turn (read files, search, read the knowledge graph, fetch URLs, look at images \
with vision, ask the user) to ground your answers, but you CANNOT write or edit files, run shell \
commands, or otherwise change the workspace or system. If a request would require a mutating \
action, explain what you would do and suggest the user switch to Auto or Review mode to carry it \
out.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_locale_strips_encoding_and_rejects_placeholders() {
        assert_eq!(normalize_locale("pt_BR.UTF-8").as_deref(), Some("pt_BR"));
        assert_eq!(normalize_locale("  en_US  ").as_deref(), Some("en_US"));
        assert_eq!(normalize_locale("en").as_deref(), Some("en"));
        assert_eq!(normalize_locale(""), None);
        assert_eq!(normalize_locale("C"), None);
        assert_eq!(normalize_locale("POSIX"), None);
    }

    #[test]
    fn locale_country_extracts_region_only_when_present() {
        assert_eq!(locale_country("pt_BR"), Some("BR"));
        assert_eq!(locale_country("en-US"), Some("US"));
        assert_eq!(locale_country("en"), None); // language-only
        assert_eq!(locale_country("pt_"), None); // empty region
    }

    #[test]
    fn default_system_prompt_carries_host_env_and_tool_stance() {
        let p = default_system_prompt();
        assert!(p.contains("Host environment: OS="));
        // OS name is one of the mapped labels, never the raw "macos"/"linux" id.
        assert!(p.contains("macOS") || p.contains("Linux") || p.contains("Windows"));
        // Key behavioral anchors the worker relies on.
        assert!(p.contains("terminal") && p.contains("read_file") && p.contains("edit_file"));
    }
}
