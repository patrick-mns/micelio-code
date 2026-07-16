use super::{ToolContext, ToolResult};
use crate::backend::cmd::no_window_cmd;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::time::{Duration, Instant};

/// Foreground commands that don't finish within this are assumed to be
/// long-running servers; instead of blocking (or erroring) we leave them
/// running and hand back the PID + log, exactly like an explicit background.
const FOREGROUND_TIMEOUT: Duration = Duration::from_secs(30);

pub fn run(arguments: &str, context: &ToolContext) -> Result<ToolResult, String> {
    let command = super::get_string_field(arguments, "command")
        .ok_or_else(|| "tool call missing `command`".to_string())?;
    let background = super::get_bool_field(arguments, "background").unwrap_or(false);

    // Sandbox the command unless the setting is off, no backend exists, or
    // this call was approved to run unsandboxed (`sandbox:false` is gated by a
    // user confirmation in the agent loop before it ever reaches here).
    let sandboxed = crate::backend::config::sandbox_enabled()
        && super::sandbox::status().is_available()
        && super::get_bool_field(arguments, "sandbox") != Some(false);

    // Both paths spawn the same way: detached, writing stdout+stderr to a
    // per-task log file. The only difference is how long we wait before
    // returning. A unique log file (named by PID) means concurrent servers and
    // later re-reads via the `bg` tool never clobber each other.
    let (mut child, log_path) = spawn_detached(&command, context, sandboxed)?;
    let pid = child.id();

    if background {
        let early = read_early_log(&log_path, Duration::from_millis(2500));
        let ws = context.workspace_root.to_string_lossy().into_owned();
        super::bg::register(&command, log_path.clone(), ws, child);
        return Ok(background_result(pid, &log_path, &early, false));
    }

    // Foreground: poll for completion up to the timeout. Output goes to a file
    // (not a pipe), so there's no buffer-deadlock risk while we wait.
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = std::fs::read_to_string(&log_path).unwrap_or_default();
                let _ = std::fs::remove_file(&log_path); // short-lived: don't litter
                return format_output(status.code().unwrap_or(-1), &output, &command, sandboxed);
            }
            Ok(None) => {
                if start.elapsed() >= FOREGROUND_TIMEOUT {
                    // Long-running (dev server, watcher): leave it running,
                    // register it, and report it as backgrounded — no retry, no
                    // second process.
                    let early = tail_log(&log_path);
                    let ws = context.workspace_root.to_string_lossy().into_owned();
                    super::bg::register(&command, log_path.clone(), ws, child);
                    return Ok(background_result(pid, &log_path, &early, true));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("failed to wait on command: {e}")),
        }
    }
}

/// Spawn a fully detached process whose stdout+stderr go to a unique per-task
/// log file under `.micelio/bg/`. Returns the child and its log path.
/// With `sandboxed`, the shell runs wrapped in the OS sandbox (write access
/// limited to the workspace roots + temp/caches; network per the setting).
fn spawn_detached(
    command: &str,
    context: &ToolContext,
    sandboxed: bool,
) -> Result<(Child, PathBuf), String> {
    let dir = context.workspace_root.join(".micelio/bg");
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create log dir: {e}"))?;
    // Unique name (nanos since epoch) — concurrent servers never share a log.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let log_path = dir.join(format!("{stamp}.log"));

    let log = std::fs::File::create(&log_path).map_err(|e| format!("failed to create log: {e}"))?;
    let log_err = log
        .try_clone()
        .map_err(|e| format!("failed to clone log handle: {e}"))?;

    let shell = if cfg!(windows) { "cmd.exe" } else { "sh" };
    let shell_arg = if cfg!(windows) { "/C" } else { "-lc" };

    // The sandboxed and plain paths build the same `<shell> <arg> <command>`
    // invocation; the wrapper only prefixes the sandbox runtime around it.
    let sandbox_cmd = if sandboxed {
        super::sandbox::wrap(
            shell,
            shell_arg,
            command,
            &super::sandbox::Spec {
                writable_roots: context.workspace_roots.clone(),
                allow_network: crate::backend::config::sandbox_network(),
            },
        )
    } else {
        None
    };
    let mut cmd = sandbox_cmd.unwrap_or_else(|| {
        let mut c = no_window_cmd(shell);
        c.arg(shell_arg).arg(command);
        c
    });
    cmd.current_dir(&context.workspace_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // After fork, before exec: detach so the child can't stall the app.
        // setsid() gives it its own session; closing inherited FDs > 2 stops it
        // from holding open a copy of the app's HTTP socket to the LLM — which
        // would keep the worker's next streamed read from ever seeing EOF.
        unsafe {
            cmd.pre_exec(|| {
                detach_child();
                Ok(())
            });
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn command: {e}"))?;
    Ok((child, log_path))
}

/// The message returned when a process is left running in the background —
/// either explicitly (`background: true`) or because a foreground command
/// outran the timeout (`auto = true`).
fn background_result(pid: u32, log_path: &std::path::Path, early: &str, auto: bool) -> ToolResult {
    let lead = if auto {
        format!(
            "command still running after {}s — kept running in the background \
(pid {pid}), no need to re-run",
            FOREGROUND_TIMEOUT.as_secs()
        )
    } else {
        format!("started in background (pid {pid})")
    };
    let mut content = format!(
        "{lead}\nlogs: {}\n\
get more output with the `bg` tool: {{\"action\":\"logs\",\"pid\":{pid},\"wait_ms\":5000}} \
(wait_ms lets it block until the URL appears or it exits). \
Stop it with {{\"action\":\"stop\",\"pid\":{pid}}}.",
        log_path.display()
    );
    if !early.trim().is_empty() {
        content.push_str("\n\n--- early output ---\n");
        content.push_str(early.trim());
    }
    ToolResult { content }
}

/// Polls the log for up to `budget`, returning early once a `http(s)://` URL
/// shows up (dev server is ready) so fast starters return quickly.
fn read_early_log(log_path: &std::path::Path, budget: Duration) -> String {
    let start = Instant::now();
    let mut last = String::new();
    while start.elapsed() < budget {
        std::thread::sleep(Duration::from_millis(150));
        if let Ok(text) = std::fs::read_to_string(log_path) {
            last = text;
            if last.contains("http://") || last.contains("https://") {
                break;
            }
        }
    }
    cap_tail(&last)
}

/// Read the current log without waiting (used after a foreground timeout, when
/// the log is already populated).
fn tail_log(log_path: &std::path::Path) -> String {
    let text = std::fs::read_to_string(log_path).unwrap_or_default();
    cap_tail(&text)
}

/// Cap to the last ~20 lines so a chatty boot doesn't flood the result.
fn cap_tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > 20 {
        lines[lines.len() - 20..].join("\n")
    } else {
        text.to_string()
    }
}

/// Runs in the forked child before exec. Only calls async-signal-safe libc
/// functions (setsid, close). Detaches the session and closes any inherited
/// file descriptors above stderr so the process can't keep the app's
/// sockets/pipes open.
#[cfg(unix)]
fn detach_child() {
    extern "C" {
        fn setsid() -> i32;
        fn close(fd: i32) -> i32;
    }
    unsafe {
        setsid();
        // Close FDs 3..1024 (stdin/out/err 0..2 point at /dev/null and the log).
        for fd in 3..1024 {
            close(fd);
        }
    }
}

fn format_output(
    exit_code: i32,
    output: &str,
    command: &str,
    sandboxed: bool,
) -> Result<ToolResult, String> {
    let trimmed = output.trim();
    if exit_code != 0 {
        let is_windows = cfg!(windows);
        let mut msg = if trimmed.is_empty() {
            // On Windows, cmd.exe often produces no output when a command is
            // not found, unlike bash which writes "command not found" to stderr.
            // Include the exact command in the hint so the model can self-correct.
            let cmd_name = command.split_whitespace().next().unwrap_or(command);
            let hint = if is_windows {
                format!(
                    "command `{cmd_name}` exited with code {exit_code} and produced no output. \
This probably means the program is not available on Windows. \
Common Unix commands that don't exist natively on Windows: grep→findstr, \
which→where.exe, rg (ripgrep may not be installed), make, diff, touch, curl, wget, ps, kill, chmod. \
Try using the `search` tool instead of grep/rg, or adapt the command to Windows equivalents."
                )
            } else {
                format!(
                    "command `{cmd_name}` exited with code {exit_code} and produced no output. \
This may mean the command was not found or couldn't execute."
                )
            };
            hint
        } else {
            let first = trimmed.lines().next().unwrap_or("unknown error");
            if first.len() > 150 {
                format!("{}...", &first[..150])
            } else {
                first.to_string()
            }
        };
        // A denial reads as "Operation not permitted" — tell the model how to
        // escalate instead of letting it retry the same blocked command.
        if sandboxed && trimmed.contains("Operation not permitted") {
            msg.push_str(
                "\nnote: this command ran inside the sandbox (writes limited to the \
workspace). If it legitimately needs broader access, retry with \
{\"sandbox\": false} — the user will be asked to approve.",
            );
        }
        Err(msg)
    } else {
        let marker = if sandboxed { "sandboxed: true\n" } else { "" };
        Ok(ToolResult {
            content: format!("output:\n{output}\nexit_code: {exit_code}\n{marker}"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(root: PathBuf) -> ToolContext {
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

    /// End-to-end through the tool entry point: on a machine with a sandbox
    /// backend the result carries the marker, writes inside the workspace
    /// succeed, and writes outside it are denied with the escalation hint.
    #[cfg(target_os = "macos")]
    #[test]
    fn run_sandboxes_by_default_and_hints_on_denial() {
        let ws = std::env::temp_dir().join(format!("term-sbx-{}", std::process::id()));
        std::fs::create_dir_all(&ws).unwrap();
        let context = ctx(ws.clone());

        let ok = run(r#"{"command":"echo hello > f.txt && cat f.txt"}"#, &context)
            .expect("write inside the workspace succeeds");
        assert!(ok.content.contains("hello"));
        assert!(ok.content.contains("sandboxed: true"), "{}", ok.content);

        let outside = std::env::temp_dir().join(format!("term-sbx-escape-{}", std::process::id()));
        // temp_dir is an implicit writable root, so probe somewhere it isn't:
        // $HOME (never a writable root in tests).
        let probe = format!(
            r#"{{"command":"touch $HOME/.term-sbx-escape-{} "}}"#,
            std::process::id()
        );
        let err = run(&probe, &context).expect_err("write outside the roots is denied");
        assert!(err.contains("sandbox"), "hint missing: {err}");

        // Opting out is honored by the tool itself (the approval gate lives in
        // the agent loop, which is exercised separately).
        let plain = run(r#"{"command":"echo plain","sandbox":false}"#, &context)
            .expect("unsandboxed run succeeds");
        assert!(!plain.content.contains("sandboxed: true"));

        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_file(outside);
    }
}
