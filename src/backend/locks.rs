//! Locked files: paths the user marked as off-limits, which the agent must
//! never see. The lock list is the enforcement point, checked by the tools that
//! can surface file content (see `tools::ToolContext::ensure_unlocked`) and by
//! the graph serialization that feeds the model's context.
//!
//! Stored per workspace in `<root>/.micelio/locked.json` as workspace-relative
//! paths, so it survives a graph re-scan (the graph is derived data; the lock
//! list is user intent).

use crate::backend::config;
use std::collections::BTreeSet;
use std::path::Path;

const LOCKS_FILE: &str = "locked.json";

fn locks_path(root: &Path) -> std::path::PathBuf {
    config::data_dir(root).join(LOCKS_FILE)
}

/// Normalize a path to the key format: workspace-relative, forward slashes.
/// An absolute path outside the workspace is returned as-is, which simply never
/// matches a stored key.
pub fn normalize(root: &Path, path: &str) -> String {
    let p = Path::new(path);
    let rel = p.strip_prefix(root).unwrap_or(p);
    rel.to_string_lossy().replace('\\', "/")
}

/// Every locked path for this workspace.
pub fn locked_paths(root: &Path) -> BTreeSet<String> {
    let Ok(raw) = std::fs::read_to_string(locks_path(root)) else {
        return BTreeSet::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Whether `path` is locked, directly or because it sits under a locked
/// directory. Locking a directory covers everything beneath it.
pub fn is_locked(root: &Path, path: &str) -> bool {
    let key = normalize(root, path);
    let locked = locked_paths(root);
    locked.iter().any(|l| covers(l, &key))
}

/// Whether the locked entry `locked` covers `key` — an exact hit, or `key`
/// living under `locked` as a directory.
fn covers(locked: &str, key: &str) -> bool {
    if locked == key {
        return true;
    }
    // Match on a path boundary so "src/a" never covers "src/ab.rs".
    key.strip_prefix(locked)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// Filter that keeps only unlocked paths, reading the lock list once. Prefer
/// this to [`is_locked`] in a loop.
pub fn locked_filter(root: &Path) -> LockedFilter {
    LockedFilter {
        root: root.to_path_buf(),
        locked: locked_paths(root),
    }
}

pub struct LockedFilter {
    root: std::path::PathBuf,
    locked: BTreeSet<String>,
}

impl LockedFilter {
    pub fn is_locked(&self, path: &str) -> bool {
        let key = normalize(&self.root, path);
        self.locked.iter().any(|l| covers(l, &key))
    }

    pub fn is_empty(&self) -> bool {
        self.locked.is_empty()
    }

    pub fn paths(&self) -> &BTreeSet<String> {
        &self.locked
    }
}

/// Lock or unlock `path`. Persisting is load-bearing here (unlike most config
/// writes): a lock that silently fails to save would be a false promise, so
/// this reports the error.
pub fn set_locked(root: &Path, path: &str, locked: bool) -> Result<(), String> {
    let key = normalize(root, path);
    if key.is_empty() {
        return Err("cannot lock an empty path".into());
    }
    let mut set = locked_paths(root);
    if locked {
        set.insert(key);
    } else {
        set.remove(&key);
    }

    let file = locks_path(root);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("failed to create {parent:?}: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&set).map_err(|e| e.to_string())?;
    std::fs::write(&file, json).map_err(|e| format!("failed to write {file:?}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("micelio-locks-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lock_roundtrips_and_survives_reread() {
        let root = scratch("roundtrip");
        assert!(!is_locked(&root, "src/secret.rs"));

        set_locked(&root, "src/secret.rs", true).unwrap();
        assert!(is_locked(&root, "src/secret.rs"));
        // Re-read from disk, not memory — the list is the durable record.
        assert!(locked_paths(&root).contains("src/secret.rs"));

        set_locked(&root, "src/secret.rs", false).unwrap();
        assert!(!is_locked(&root, "src/secret.rs"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_path_matches_relative_key() {
        let root = scratch("abs");
        set_locked(&root, "src/secret.rs", true).unwrap();
        // Tools resolve to absolute paths before checking.
        let abs = root.join("src/secret.rs");
        assert!(is_locked(&root, &abs.to_string_lossy()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn locked_directory_covers_children_only_on_a_boundary() {
        let root = scratch("dir");
        set_locked(&root, "src/private", true).unwrap();

        assert!(is_locked(&root, "src/private"), "the directory itself");
        assert!(is_locked(&root, "src/private/key.rs"), "a child");
        assert!(
            is_locked(&root, "src/private/deep/nested.rs"),
            "a deep child"
        );
        // A sibling sharing the prefix must not be swept up.
        assert!(!is_locked(&root, "src/private_notes.rs"));
        assert!(!is_locked(&root, "src/privateer.rs"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn locking_a_symbol_node_path_locks_the_file() {
        let root = scratch("symbol");
        // Symbol nodes attach to the file they live in, so locking that file
        // must hide them too.
        set_locked(&root, "src/secret.rs", true).unwrap();
        assert!(is_locked(&root, "src/secret.rs"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
