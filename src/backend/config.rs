//! Tiny global app config: remembers the last opened workspace so the
//! app reopens it on launch. Stored as a single path in
//! `~/.micelio/last_workspace` (distinct from the per-workspace
//! `<workspace>/.micelio/` data dirs).

use std::path::{Path, PathBuf};

/// Current app data dir name (per-workspace and under `$HOME`).
pub const DATA_DIR: &str = ".micelio";
/// Pre-rename data dir name, migrated in place by [`data_dir`].
const LEGACY_DATA_DIR: &str = ".minimal-context";

/// Returns `<root>/.micelio`, migrating a legacy `.minimal-context`
/// directory in place on first access so existing graphs/sessions survive
/// the rename. Best-effort: a failed rename just falls through to the new
/// path (a fresh, empty data dir).
pub fn data_dir(root: &Path) -> PathBuf {
    let current = root.join(DATA_DIR);
    let legacy = root.join(LEGACY_DATA_DIR);
    if !current.exists() && legacy.is_dir() {
        let _ = std::fs::rename(&legacy, &current);
    }
    current
}

/// Returns the app-level data dir at `~/.micelio/`.  Used for global config
/// (last workspace, model prefs, API keys) and as a safe fallback workspace
/// root when no workspace has been picked yet (avoids touching TCC-guarded
/// paths like ~/Documents/ just for bootstrapping).
pub fn app_data_dir() -> PathBuf {
    let home = std::env::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    data_dir(&home)
}

/// Ensures `.micelio/` is listed in `<root>/.gitignore`. Creates the file if
/// it doesn't exist. No-op if the entry is already present. Best-effort.
pub fn ensure_gitignore(root: &Path) {
    let gi = root.join(".gitignore");
    let entry = ".micelio/\n";
    let current = std::fs::read_to_string(&gi).unwrap_or_default();
    if current.lines().any(|l| l.trim() == ".micelio/") {
        return;
    }
    let new_content = if current.is_empty() {
        entry.to_string()
    } else if current.ends_with('\n') {
        format!("{current}{entry}")
    } else {
        format!("{current}\n{entry}")
    };
    let _ = std::fs::write(&gi, new_content);
}

/// Absolute path of the config file named `key` under `~/.micelio/`.
/// `None` only when `$HOME` can't be resolved.
fn cfg_path(key: &str) -> Option<PathBuf> {
    Some(app_data_dir().join(key))
}

/// Reads `key`'s trimmed contents, or `None` when the file is missing/empty.
fn read_trimmed(key: &str) -> Option<String> {
    let raw = std::fs::read_to_string(cfg_path(key)?).ok()?;
    let s = raw.trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Writes `value` to `key`, creating `~/.micelio/` as needed. Best-effort:
/// every config write is a convenience, never load-bearing.
fn write_value(key: &str, value: &str) {
    let Some(p) = cfg_path(key) else { return };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(p, value);
}

/// OpenRouter API key, from `OPENROUTER_API_KEY` or `~/.micelio/openrouter_key`.
/// None/empty = provider disabled (contributes nothing to the catalog).
pub fn openrouter_key() -> Option<String> {
    if let Ok(k) = std::env::var("OPENROUTER_API_KEY") {
        let k = k.trim().to_string();
        if !k.is_empty() {
            return Some(k);
        }
    }
    read_trimmed("openrouter_key")
}

/// Persists the OpenRouter API key (best-effort). Empty clears it.
pub fn save_openrouter_key(key: &str) {
    write_value("openrouter_key", key.trim());
}

/// Last workspace path, if it was saved and still exists as a directory.
pub fn last_workspace() -> Option<PathBuf> {
    let path = PathBuf::from(read_trimmed("last_workspace")?);
    path.is_dir().then_some(path)
}

/// Persists `path` as the workspace to reopen next launch. Best-effort:
/// failures are ignored (the feature is a convenience, not critical).
pub fn save_last_workspace(path: &Path) {
    write_value("last_workspace", &path.to_string_lossy());
}

/// Returns the name of the last model used, or None if never saved.
pub fn last_model() -> Option<String> {
    read_trimmed("last_model")
}

/// Persists the last model name used. Best-effort.
pub fn save_last_model(model_name: &str) {
    write_value("last_model", model_name);
}

/// Returns the name of the last summarize model used, or None if never saved.
pub fn last_summarize_model() -> Option<String> {
    read_trimmed("last_summarize_model")
}

/// Persists the last summarize model name used. Best-effort.
pub fn save_last_summarize_model(model_name: &str) {
    write_value("last_summarize_model", model_name);
}

/// Model assigned to the Vision role, or None if never set. Distinct from the
/// chat/summarize models so each role can target a different model.
pub fn vision_model() -> Option<String> {
    read_trimmed("vision_model")
}

/// Persists the Vision-role model. Best-effort. Empty clears it.
pub fn save_vision_model(model_name: &str) {
    write_value("vision_model", model_name.trim());
}

/// Whether files touched during a chat turn are auto-summarized in the
/// background. Defaults to `true` (on) when never set.
pub fn auto_summarize() -> bool {
    read_trimmed("auto_summarize").is_none_or(|s| s != "false")
}

/// Persists the auto-summarize toggle. Best-effort.
pub fn save_auto_summarize(on: bool) {
    write_value("auto_summarize", if on { "true" } else { "false" });
}

/// Custom system-prompt override set by the user in the inspector modal.
/// `None` = use the built-in default (with live OS/locale injection).
/// Returns the verbatim file contents (untrimmed) when non-empty.
pub fn system_prompt_override() -> Option<String> {
    let raw = std::fs::read_to_string(cfg_path("system_prompt")?).ok()?;
    (!raw.trim().is_empty()).then_some(raw)
}

/// Persists a custom system prompt verbatim. Best-effort.
pub fn save_system_prompt_override(text: &str) {
    write_value("system_prompt", text);
}

/// Clears the override, reverting to the built-in default. Best-effort.
pub fn clear_system_prompt_override() {
    if let Some(p) = cfg_path("system_prompt") {
        let _ = std::fs::remove_file(p);
    }
}

/// Whether to show token usage + cost at the end of assistant messages (when
/// the provider reports it). Defaults to `false` (off) until enabled.
pub fn show_cost() -> bool {
    read_trimmed("show_cost").is_some_and(|s| s == "true")
}

/// Persists the show-cost toggle. Best-effort.
pub fn save_show_cost(on: bool) {
    write_value("show_cost", if on { "true" } else { "false" });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch dir per test, mirroring the convention in `sessions.rs`.
    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mc-cfg-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn data_dir_migrates_legacy_in_place() {
        let root = scratch("legacy");
        let legacy = root.join(LEGACY_DATA_DIR);
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("graph.json"), "{}").unwrap();

        let resolved = data_dir(&root);
        assert_eq!(resolved, root.join(DATA_DIR));
        assert!(resolved.join("graph.json").exists(), "content migrated");
        assert!(!legacy.exists(), "legacy dir consumed by rename");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn data_dir_prefers_existing_current_over_legacy() {
        let root = scratch("both");
        std::fs::create_dir_all(root.join(DATA_DIR)).unwrap();
        std::fs::create_dir_all(root.join(LEGACY_DATA_DIR)).unwrap();

        let resolved = data_dir(&root);
        assert_eq!(resolved, root.join(DATA_DIR));
        assert!(
            root.join(LEGACY_DATA_DIR).exists(),
            "no migration when current exists"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ensure_gitignore_creates_then_is_idempotent() {
        let root = scratch("gi-new");
        ensure_gitignore(&root);
        let gi = root.join(".gitignore");
        assert_eq!(std::fs::read_to_string(&gi).unwrap(), ".micelio/\n");

        // Second call must not duplicate the entry.
        ensure_gitignore(&root);
        let body = std::fs::read_to_string(&gi).unwrap();
        assert_eq!(body.matches(".micelio/").count(), 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ensure_gitignore_appends_with_newline_separator() {
        let root = scratch("gi-append");
        let gi = root.join(".gitignore");
        std::fs::write(&gi, "target/").unwrap(); // no trailing newline
        ensure_gitignore(&root);

        let body = std::fs::read_to_string(&gi).unwrap();
        assert_eq!(body, "target/\n.micelio/\n");

        let _ = std::fs::remove_dir_all(root);
    }
}
