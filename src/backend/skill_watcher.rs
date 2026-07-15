//! Filesystem watcher for skills — auto-reloads when `SKILL.md` is
//! created, modified or removed. Uses `notify` (FSEvents on macOS,
//! inotify on Linux, ReadDirectoryChanges on Windows).
//!
//! Debounce of 300ms: if multiple events arrive (e.g. editor save +
//! rename), it waits 300ms of silence before reloading. After reload
//! emits `skills_changed` to the frontend.

use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::backend::skills::SkillRegistry;
use crate::AppState;

// ── Constants ────────────────────────────────────────────────────────────────

/// How long to wait without new events before reloading.
const DEBOUNCE_MS: u64 = 300;

/// Skill directories (relative to workspace root).
const SKILL_DIRS: &[&str] = &[
    ".micelio/skills",
    ".claude/skills",
    ".agents/skills",
    ".github/skills",
];

// ── Global state ──────────────────────────────────────────────────────────────
// `watcher_cell` holds the active watcher so it doesn't get dropped.
// `event_tx` is the single channel sender — all watchers send to it,
// and the debounce thread listens on the receiver.

static WATCHER_CELL: OnceLock<Mutex<Option<RecommendedWatcher>>> = OnceLock::new();
static EVENT_TX: OnceLock<Mutex<std::sync::mpsc::Sender<()>>> = OnceLock::new();

fn watcher_cell() -> &'static Mutex<Option<RecommendedWatcher>> {
    WATCHER_CELL.get_or_init(|| Mutex::new(None))
}

fn event_tx() -> &'static Mutex<std::sync::mpsc::Sender<()>> {
    EVENT_TX.get_or_init(|| {
        let (tx, _rx) = std::sync::mpsc::channel();
        Mutex::new(tx)
    })
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Initialize the watcher: create the single channel and spawn the debounce
/// thread. Must be called once in `.setup()`.
pub fn init(app_handle: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();

    // Replace the placeholder sender created by `get_or_init`
    *event_tx().lock().unwrap() = tx;

    // Spawn the debounce thread (owns the receiver)
    std::thread::spawn(move || {
        let mut pending = false;
        let mut last_event = std::time::Instant::now();

        loop {
            match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                Ok(()) => {
                    last_event = std::time::Instant::now();
                    pending = true;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if pending && last_event.elapsed() >= Duration::from_millis(DEBOUNCE_MS) {
                        pending = false;
                        // Reload skills from the current workspace
                        let root = {
                            let st = app_handle.state::<AppState>();
                            let guard = st.workspace_root.lock().unwrap();
                            guard.clone()
                        };
                        SkillRegistry::load(&root);
                        // Notify the frontend
                        let _ = app_handle.emit("skills_changed", ());
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    // Channel closed — no more senders. Sleep and retry.
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        }
    });
}

/// Start watching skill directories in the given workspace.
/// Drops the previous watcher and creates a new one.
pub fn watch_workspace(workspace_root: &Path) {
    // Grab a clone of the global sender
    let tx = event_tx().lock().unwrap().clone();

    let mut watcher = match RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                // Any Create/Modify/Remove event inside a skill directory
                // triggers a reload. The debounce avoids redundant reloads
                // when multiple events fire (e.g. editor save + rename).
                let relevant = matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                );
                if relevant {
                    let _ = tx.send(());
                }
            }
        },
        Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[skill_watcher] failed to create watcher: {e}");
            return;
        }
    };

    // Register each skill directory that exists
    for dir_rel in SKILL_DIRS {
        let dir = workspace_root.join(dir_rel);
        // Ensure the directory exists so the watcher can register it.
        // An empty directory is fine — it will catch Create events when
        // a skill is added later.
        let _ = std::fs::create_dir_all(&dir);
        if let Err(e) = watcher.watch(&dir, RecursiveMode::Recursive) {
            eprintln!("[skill_watcher] failed to watch {dir:?}: {e}");
        }
    }

    eprintln!(
        "[skill_watcher] watching {} skill directories",
        SKILL_DIRS.len()
    );

    // Store the watcher to keep it alive (replaces the previous one)
    let mut cell = watcher_cell().lock().unwrap();
    *cell = Some(watcher);
}
