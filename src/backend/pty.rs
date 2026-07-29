//! Interactive shell sessions behind the UI's Terminal dock tabs.
//!
//! Distinct from `tools::terminal`, which runs one command for the model and
//! hands back its output: here a shell stays alive and the user types into it.
//!
//! The session lives in this registry rather than in the React component
//! because a dock only renders its *showing* tab — switching tabs unmounts the
//! terminal, and a shell that died on every tab switch would be useless. Each
//! session therefore also keeps its own scrollback, so a remount replays what
//! the user missed instead of coming back to an empty screen.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::Emitter;

/// How much raw output a session keeps for replay. Bytes, not lines, since
/// what's kept is the untouched byte stream — escape sequences and all — and
/// letting a chatty build hold megabytes per tab isn't worth it.
const SCROLLBACK_LIMIT: usize = 256 * 1024;

/// Read size. Also the ceiling on how much one read can add before the pump
/// gets a chance to ship it.
const READ_CHUNK: usize = 8 * 1024;

/// Output is shipped on a timer instead of per read: a command like `yes`
/// produces reads far faster than the UI can paint, and one event per read
/// would drown the webview. At ~60fps the user can't tell the difference.
const FLUSH_INTERVAL: Duration = Duration::from_millis(16);

/// What the reader thread fills and the pump drains. `scrollback` is the whole
/// (capped) history for replay; `pending` is only what hasn't been emitted yet.
#[derive(Default)]
struct Output {
    scrollback: Vec<u8>,
    pending: Vec<u8>,
}

impl Output {
    fn push(&mut self, chunk: &[u8]) {
        self.pending.extend_from_slice(chunk);
        self.scrollback.extend_from_slice(chunk);
        // Trim from the front once over budget. This can cut an escape
        // sequence in half, but only in history old enough to have scrolled
        // far out of view — the alternative is parsing the stream here, which
        // is the terminal emulator's job, not the transport's.
        if self.scrollback.len() > SCROLLBACK_LIMIT {
            let excess = self.scrollback.len() - SCROLLBACK_LIMIT;
            self.scrollback.drain(..excess);
        }
    }
}

struct Session {
    /// The write half of the pty. Held here (not in the reader thread) because
    /// keystrokes arrive on the Tauri command thread.
    ///
    /// Behind its own lock so a write can outlive the registry lock: writing to
    /// a pty whose child has stopped reading blocks until the buffer drains,
    /// and holding the registry through that would freeze *every* terminal —
    /// and every attach — on one stuck shell.
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Kept alive for `resize`: dropping the master closes the pty.
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    out: Arc<Mutex<Output>>,
    /// Cleared once the shell is gone, so a closed session still replays its
    /// last words instead of the tab going blank the moment the shell exits.
    alive: Arc<AtomicBool>,
}

fn registry() -> &'static Mutex<HashMap<String, Session>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The user's own login shell, so the terminal has the PATH and aliases they
/// set up. `-l` matters most on macOS: a GUI-launched app inherits a bare
/// environment, and without it the shell wouldn't find tools installed by
/// Homebrew, nvm, or asdf.
fn shell_command(cwd: Option<PathBuf>) -> CommandBuilder {
    #[cfg(windows)]
    let mut cmd = {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string());
        CommandBuilder::new(shell)
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut c = CommandBuilder::new(shell);
        c.arg("-l");
        c
    };

    if let Some(dir) = cwd.filter(|d| d.is_dir()) {
        cmd.cwd(dir);
    }
    // What the frontend actually renders: xterm.js speaks xterm-256color, and
    // announcing anything else makes programs fall back to a poorer palette.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd
}

/// Start a shell for `id`, or return the existing one's scrollback.
///
/// Reopening is the normal path, not an error: the component remounts on every
/// tab switch and calls this each time. The base64 it returns is the replay —
/// empty for a session that's just been created.
pub fn open(
    app: tauri::AppHandle,
    id: String,
    cwd: Option<PathBuf>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    if let Some(existing) = attach(&id) {
        // Size follows the pane that's showing it, which may have been resized
        // while this tab was in the background.
        let _ = resize(&id, cols, rows);
        return Ok(existing);
    }

    let pty = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open a pty: {e}"))?;

    let mut child = pty
        .slave
        .spawn_command(shell_command(cwd))
        .map_err(|e| format!("failed to start the shell: {e}"))?;
    // The slave is the child's end. Holding it open here would keep the pty
    // from ever reporting EOF, so the reader would block forever after exit.
    drop(pty.slave);

    let reader = pty
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to read from the pty: {e}"))?;
    let writer = pty
        .master
        .take_writer()
        .map_err(|e| format!("failed to write to the pty: {e}"))?;

    let out = Arc::new(Mutex::new(Output::default()));
    let alive = Arc::new(AtomicBool::new(true));
    let killer = child.clone_killer();

    registry().lock().unwrap().insert(
        id.clone(),
        Session {
            writer: Arc::new(Mutex::new(writer)),
            master: pty.master,
            killer,
            out: Arc::clone(&out),
            alive: Arc::clone(&alive),
        },
    );

    // Reader: blocks on the pty and buffers. It never emits — a blocking read
    // can't also keep to a flush schedule, so shipping is the pump's job.
    let reading = Arc::new(AtomicBool::new(true));
    {
        let out = Arc::clone(&out);
        let reading = Arc::clone(&reading);
        let mut reader = reader;
        std::thread::spawn(move || {
            let mut buf = [0u8; READ_CHUNK];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => out.lock().unwrap().push(&buf[..n]),
                }
            }
            reading.store(false, Ordering::SeqCst);
        });
    }

    // Pump: ships buffered output on a timer and owns the child, so the
    // process is reaped where its exit is noticed.
    std::thread::spawn(move || {
        loop {
            let done = !reading.load(Ordering::SeqCst);
            let chunk = std::mem::take(&mut out.lock().unwrap().pending);
            if !chunk.is_empty() {
                let _ = app.emit(
                    "pty_output",
                    serde_json::json!({
                        "id": id,
                        "data": base64::engine::general_purpose::STANDARD.encode(&chunk),
                    }),
                );
            }
            // Only after a drain that found the reader already finished — so
            // the last chunk is always shipped before the exit notice.
            if done {
                break;
            }
            std::thread::sleep(FLUSH_INTERVAL);
        }

        let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
        alive.store(false, Ordering::SeqCst);
        let _ = app.emit("pty_exit", serde_json::json!({ "id": id, "code": code }));
    });

    Ok(String::new())
}

pub fn write_input(id: &str, data: &str) -> Result<(), String> {
    // Take a handle to the writer and let the registry go before writing — see
    // the field's note on why the write must not happen under that lock.
    let writer = {
        let reg = registry().lock().unwrap();
        Arc::clone(&reg.get(id).ok_or("no such terminal")?.writer)
    };
    let mut writer = writer.lock().unwrap();
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|e| format!("failed to send input: {e}"))
}

/// Tell the shell how big its window is, so full-screen programs (vim, less,
/// htop) lay out to the pane rather than to whatever size it started at.
pub fn resize(id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let reg = registry().lock().unwrap();
    let session = reg.get(id).ok_or("no such terminal")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to resize: {e}"))
}

/// Everything the session has produced, base64-encoded. `None` when there's no
/// such session — which is how `open` tells a remount from a first mount.
///
/// Draining `pending` under the same lock is what keeps a reattaching view from
/// seeing those bytes twice: the frontend starts listening *before* it asks to
/// attach, so anything still queued here is about to be replayed as part of the
/// scrollback. After this returns, every event is strictly newer than the
/// replay, with no gap in between.
fn attach(id: &str) -> Option<String> {
    let reg = registry().lock().unwrap();
    let mut out = reg.get(id)?.out.lock().unwrap();
    out.pending.clear();
    Some(base64::engine::general_purpose::STANDARD.encode(&out.scrollback))
}

/// Whether the shell is still running. A session outlives its shell so the
/// last output stays readable; the tab uses this to say so.
pub fn is_alive(id: &str) -> bool {
    registry()
        .lock()
        .unwrap()
        .get(id)
        .is_some_and(|s| s.alive.load(Ordering::SeqCst))
}

/// Kill the shell and forget the session. Called when the *tab* closes, not
/// when the component unmounts — unmounting is just a tab switch.
pub fn close(id: &str) {
    if let Some(mut session) = registry().lock().unwrap().remove(id) {
        let _ = session.killer.kill();
    }
}

/// Kill every shell — for app shutdown, so closing the window doesn't leave
/// orphaned logins behind.
pub fn close_all() {
    for (_, mut session) in registry().lock().unwrap().drain() {
        let _ = session.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrollback_is_capped_and_drops_the_oldest_bytes() {
        let mut out = Output::default();
        out.push(&vec![b'a'; SCROLLBACK_LIMIT]);
        out.push(b"tail");

        assert_eq!(out.scrollback.len(), SCROLLBACK_LIMIT);
        assert!(out.scrollback.ends_with(b"tail"), "newest output survives");
        // Pending is the emit queue, not history — the cap doesn't touch it.
        assert_eq!(out.pending.len(), SCROLLBACK_LIMIT + 4);
    }

    #[test]
    fn pending_holds_only_what_has_not_been_shipped() {
        let mut out = Output::default();
        out.push(b"first");
        let shipped = std::mem::take(&mut out.pending);
        out.push(b"second");

        assert_eq!(shipped, b"first");
        assert_eq!(out.pending, b"second");
        assert_eq!(out.scrollback, b"firstsecond", "history keeps both");
    }
}
