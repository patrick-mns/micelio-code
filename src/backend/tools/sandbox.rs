//! OS-level sandbox for agent terminal commands.
//!
//! Wraps the shell invocation the `terminal` tool spawns so the command runs
//! with write access restricted to the workspace (plus temp and per-user cache
//! dirs) and, optionally, no network. Read access stays broad on purpose —
//! dev tools read toolchains, caches and libraries from all over the disk, and
//! the isolation that matters for an agent is *mutation*, not reads.
//!
//! Backends: Seatbelt (`/usr/bin/sandbox-exec`) on macOS, bubblewrap (`bwrap`)
//! on Linux. Windows has no backend — [`status`] reports it as unavailable and
//! the terminal tool runs commands unwrapped, exactly as before.

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

use crate::backend::cmd::no_window_cmd;

/// Whether a sandbox backend exists on this machine, resolved once.
#[derive(Debug, Clone)]
pub enum Status {
    /// Backend label shown in settings ("Seatbelt", "bubblewrap").
    Available(&'static str),
    /// Why no backend is usable (missing binary, unsupported OS).
    Unavailable(String),
}

impl Status {
    pub fn is_available(&self) -> bool {
        matches!(self, Status::Available(_))
    }
}

/// Detect the platform backend. Cached: the answer can't change while the
/// app is running (installing bwrap mid-session is not a case worth polling).
pub fn status() -> &'static Status {
    static STATUS: OnceLock<Status> = OnceLock::new();
    STATUS.get_or_init(detect)
}

fn detect() -> Status {
    #[cfg(target_os = "macos")]
    {
        if std::path::Path::new("/usr/bin/sandbox-exec").exists() {
            Status::Available("Seatbelt")
        } else {
            Status::Unavailable("sandbox-exec not found".into())
        }
    }
    #[cfg(target_os = "linux")]
    {
        let found = std::env::var_os("PATH").is_some_and(|paths| {
            std::env::split_paths(&paths).any(|dir| dir.join("bwrap").exists())
        });
        if found {
            Status::Available("bubblewrap")
        } else {
            Status::Unavailable("bubblewrap not installed (e.g. `apt install bubblewrap`)".into())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Status::Unavailable("not supported on this platform".into())
    }
}

/// What the sandboxed command may touch.
pub struct Spec {
    /// Directories the command may write to (workspace roots). Temp and
    /// per-user cache dirs are appended automatically.
    pub writable_roots: Vec<PathBuf>,
    pub allow_network: bool,
}

/// The writable set every sandboxed command gets besides the workspace:
/// temp plus the per-user caches that everyday tools (npm, pip, cargo's
/// target-dir siblings, XDG users) break without. Caches are a deliberate
/// trade-off: poisoning one is far less damaging than the write-anywhere
/// default, and blocking them makes even `npm install` fail.
fn implicit_writable() -> Vec<PathBuf> {
    let mut dirs = vec![std::env::temp_dir()];
    #[cfg(target_os = "macos")]
    if let Some(cache) = darwin_user_cache_dir() {
        dirs.push(cache);
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".npm"));
        dirs.push(home.join(".cache"));
        #[cfg(target_os = "macos")]
        dirs.push(home.join("Library/Caches"));
    }
    dirs.retain(|d| d.exists());
    dirs
}

/// The per-user cache root (`/var/folders/.../C/`), sibling of the temp dir.
/// `getconf DARWIN_USER_CACHE_DIR` is authoritative; resolved once.
#[cfg(target_os = "macos")]
fn darwin_user_cache_dir() -> Option<PathBuf> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let out = Command::new("/usr/bin/getconf")
            .arg("DARWIN_USER_CACHE_DIR")
            .output()
            .ok()?;
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!path.is_empty()).then(|| PathBuf::from(path))
    })
    .clone()
}

/// Build the command that runs `<shell> <shell_arg> <command>` inside the
/// sandbox. Returns `None` when no backend is available — the caller falls
/// back to the plain unsandboxed spawn.
pub fn wrap(shell: &str, shell_arg: &str, command: &str, spec: &Spec) -> Option<Command> {
    if !status().is_available() {
        return None;
    }
    let mut roots: Vec<PathBuf> = spec.writable_roots.clone();
    roots.extend(implicit_writable());
    // Canonicalize so symlinked roots (e.g. /tmp -> /private/tmp on macOS)
    // match the paths the kernel actually sees at enforcement time.
    let roots: Vec<PathBuf> = roots
        .into_iter()
        .filter_map(|r| r.canonicalize().ok())
        .collect();

    #[cfg(target_os = "macos")]
    {
        Some(seatbelt_cmd(
            shell,
            shell_arg,
            command,
            &roots,
            spec.allow_network,
        ))
    }
    #[cfg(target_os = "linux")]
    {
        Some(bwrap_cmd(
            shell,
            shell_arg,
            command,
            &roots,
            spec.allow_network,
        ))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (shell, shell_arg, command, roots);
        None
    }
}

/// Generate the SBPL profile. Writable roots are passed as `-D WRITABLE_n`
/// parameters rather than spliced into the profile, so paths never need
/// escaping. Deny-by-default; read access broad; writes only in the roots.
#[cfg(any(target_os = "macos", test))]
fn seatbelt_profile(root_count: usize, allow_network: bool) -> String {
    let mut p = String::from(
        "(version 1)\n\
(deny default)\n\
; broad read access — dev tools read toolchains and caches everywhere\n\
(allow file-read*)\n\
; child processes inherit the sandbox\n\
(allow process-exec)\n\
(allow process-fork)\n\
(allow signal (target same-sandbox))\n\
; basic runtime needs\n\
(allow sysctl-read)\n\
(allow mach-lookup)\n\
(allow ipc-posix-shm)\n\
; /dev plumbing: null sink, ptys, fd re-opens\n\
(allow file-write-data (require-all (path \"/dev/null\") (vnode-type CHARACTER-DEVICE)))\n\
(allow file-ioctl file-read-data file-write-data (regex #\"^/dev/ttys[0-9]*$\"))\n\
(allow file-write* (subpath \"/dev/fd\"))\n",
    );
    for i in 0..root_count {
        p.push_str(&format!(
            "(allow file-write* (subpath (param \"WRITABLE_{i}\")))\n"
        ));
    }
    if allow_network {
        p.push_str("(allow network*)\n(allow system-socket)\n");
    }
    p
}

#[cfg(target_os = "macos")]
fn seatbelt_cmd(
    shell: &str,
    shell_arg: &str,
    command: &str,
    roots: &[PathBuf],
    allow_network: bool,
) -> Command {
    let mut cmd = no_window_cmd("/usr/bin/sandbox-exec");
    cmd.arg("-p")
        .arg(seatbelt_profile(roots.len(), allow_network));
    for (i, root) in roots.iter().enumerate() {
        cmd.arg("-D")
            .arg(format!("WRITABLE_{i}={}", root.display()));
    }
    cmd.arg(shell).arg(shell_arg).arg(command);
    cmd
}

/// bubblewrap: mount the whole filesystem read-only, then bind the writable
/// roots read-write on top. `--dev` and `--proc` give the command fresh
/// device/proc trees; `--die-with-parent` ties its life to the app's spawn
/// (the detached setsid child, not the app itself).
#[cfg(target_os = "linux")]
fn bwrap_cmd(
    shell: &str,
    shell_arg: &str,
    command: &str,
    roots: &[PathBuf],
    allow_network: bool,
) -> Command {
    let mut cmd = no_window_cmd("bwrap");
    cmd.args(["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"]);
    for root in roots {
        cmd.arg("--bind").arg(root).arg(root);
    }
    if !allow_network {
        cmd.arg("--unshare-net");
    }
    cmd.arg("--die-with-parent");
    cmd.arg(shell).arg(shell_arg).arg(command);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_has_deny_default_and_parameterized_roots() {
        let p = seatbelt_profile(2, false);
        assert!(p.starts_with("(version 1)\n(deny default)"));
        assert!(p.contains("(param \"WRITABLE_0\")"));
        assert!(p.contains("(param \"WRITABLE_1\")"));
        assert!(!p.contains("WRITABLE_2"));
        // Network off means no allow rule at all — deny default covers it.
        assert!(!p.contains("network"));
        let p = seatbelt_profile(1, true);
        assert!(p.contains("(allow network*)"));
    }

    #[test]
    fn implicit_writable_only_returns_existing_dirs() {
        for d in implicit_writable() {
            assert!(d.exists(), "{} should exist", d.display());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn wrap_builds_a_sandbox_exec_invocation() {
        let ws = std::env::temp_dir();
        let spec = Spec {
            writable_roots: vec![ws],
            allow_network: true,
        };
        let cmd = wrap("sh", "-lc", "echo hi", &spec).expect("macOS has Seatbelt");
        assert_eq!(cmd.get_program(), "/usr/bin/sandbox-exec");
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(args.iter().any(|a| a.starts_with("WRITABLE_0=")));
        assert_eq!(args.last().map(String::as_str), Some("echo hi"));
    }

    /// End-to-end: a sandboxed command can write inside a writable root but
    /// not outside it. Runs the real sandbox-exec, so macOS-only.
    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_blocks_writes_outside_roots() {
        let ws = std::env::temp_dir().join(format!("msb-test-{}", std::process::id()));
        std::fs::create_dir_all(&ws).unwrap();
        // Writable root is ONLY the workspace — bypass `wrap` so the implicit
        // temp-dir root doesn't shadow the outside-write probe below.
        let ws_canon = ws.canonicalize().unwrap();
        let outside = std::env::var("HOME").unwrap() + "/.msb-escape-probe";
        let script =
            format!("echo ok > inside.txt && cat inside.txt && touch {outside} 2>/dev/null; true");
        let mut cmd = seatbelt_cmd("sh", "-c", &script, std::slice::from_ref(&ws_canon), false);
        let out = cmd.current_dir(&ws).output().expect("sandbox-exec runs");
        assert!(
            String::from_utf8_lossy(&out.stdout).contains("ok"),
            "write inside the root must work: {:?}",
            out
        );
        assert!(
            !std::path::Path::new(&outside).exists(),
            "write outside the roots must be blocked"
        );
        let _ = std::fs::remove_dir_all(&ws);
    }
}
