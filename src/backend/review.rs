//! Review mode: when active, `file` write/edit tool calls block and wait for
//! the user to approve or reject the change (see
//! `commands::agent::execute_tool_call`) before it's written to disk —
//! mirroring how `ask_user` pauses the agent turn. There is no separate
//! staging area: an approved edit is written straight to disk, so it shows up
//! immediately as a normal git change. This module only tracks the review-mode
//! toggle and the workspace's uncommitted git diff (staged, unstaged, and
//! untracked, all vs HEAD), which the frontend shows as a revertable "changes"
//! list.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// How the agent handles a turn. Selected by the user in the composer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    /// Conversation only — tools are not offered to the model, so it can't
    /// read or modify the workspace. Just answers questions.
    Chat,
    /// Fully autonomous — tool calls (including file writes/edits) execute
    /// immediately without pausing for approval.
    Auto,
    /// Like Auto, but file write/edit calls pause and wait for the user to
    /// approve or reject the diff before it hits disk.
    Review,
}

impl AgentMode {
    /// Parse the wire string the frontend sends. Unknown values fall back to
    /// the safe default (Review).
    pub fn from_str(s: &str) -> Self {
        match s {
            "chat" => AgentMode::Chat,
            "auto" => AgentMode::Auto,
            _ => AgentMode::Review,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            AgentMode::Chat => "chat",
            AgentMode::Auto => "auto",
            AgentMode::Review => "review",
        }
    }
}

/// The user's answer to a generic tool-confirmation card (Review mode). Unlike
/// the file-edit approval (a plain accept/reject), a confirmation can also be
/// "always allow this tool for the rest of the session".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmDecision {
    /// Don't run the tool call.
    Reject,
    /// Run it this once; ask again next time.
    Once,
    /// Run it and stop asking for this tool for the rest of the session.
    Always,
}

impl ConfirmDecision {
    /// Parse the wire string the frontend sends. Unknown values fall back to
    /// the safe default (Reject).
    pub fn from_str(s: &str) -> Self {
        match s {
            "always" => ConfirmDecision::Always,
            "once" => ConfirmDecision::Once,
            _ => ConfirmDecision::Reject,
        }
    }
}

pub struct ReviewManager {
    /// How the agent handles a turn (chat / auto / review). In Review mode,
    /// file writes/edits pause for user approval before hitting disk.
    pub mode: AgentMode,
    /// Cached git diff (uncommitted changes vs HEAD). Refreshed on demand.
    git_diff_cache: Option<Vec<ReviewFileInfo>>,
}

impl ReviewManager {
    pub fn new() -> Self {
        Self {
            mode: AgentMode::Review,
            git_diff_cache: None,
        }
    }

    /// Refresh the cached git diff list.
    pub fn refresh_git_diff(&mut self, workspace_root: &Path) {
        self.git_diff_cache = git_diff_files(workspace_root).ok();
    }

    /// Get the cached git diff list (call `refresh_git_diff` first).
    pub fn git_changes(&self) -> Vec<ReviewFileInfo> {
        self.git_diff_cache.clone().unwrap_or_default()
    }

    /// Number of uncommitted git changes.
    pub fn pending_count(&self) -> usize {
        self.git_diff_cache.as_ref().map(|f| f.len()).unwrap_or(0)
    }
}

// ── Lightweight serializable payloads for the frontend ───────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewFileInfo {
    pub path: String,
    pub original_content: String,
    pub proposed_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceChanges {
    /// Unstaged git changes.
    pub git_files: Vec<ReviewFileInfo>,
}

// ── Git diff helpers ──────────────────────────────────────────────────────

/// Run `git diff HEAD` for the current workspace and return one
/// `ReviewFileInfo` per changed file. Covers staged and unstaged changes alike:
/// each entry's `original_content` is the committed (HEAD) version and
/// `proposed_content` is the working-tree version.
pub fn git_diff_files(workspace_root: &Path) -> Result<Vec<ReviewFileInfo>, String> {
    use crate::backend::cmd::no_window_cmd;

    // 1. Get list of changed files vs HEAD (staged + unstaged, no untracked).
    //    `--relative` scopes the diff to `workspace_root` — the selected folder —
    //    excluding changes elsewhere in the repo and emitting folder-relative
    //    paths. Without it, `git diff` reports the whole repository even when run
    //    from a subfolder, so the panel would show changes outside the folder.
    //    On failure (not a git repo, or no commits yet) treat the tracked set
    //    as empty and still surface untracked files in step 3.
    let name_output = no_window_cmd("git")
        .args(["diff", "HEAD", "--name-only", "--relative"])
        .current_dir(workspace_root)
        .output()
        .map_err(|e| format!("git failed: {e}"))?;
    let names: Vec<String> = if name_output.status.success() {
        String::from_utf8_lossy(&name_output.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    } else {
        Vec::new()
    };

    // 2. For each file, get unified diff and also the original/current content
    let mut files = Vec::new();
    for name in &names {
        // Original content (from HEAD). `name` is folder-relative (see
        // `--relative` above), so prefix `./` to resolve it against the cwd
        // rather than the repo root.
        let original = no_window_cmd("git")
            .args(["show", &format!("HEAD:./{}", name)])
            .current_dir(workspace_root)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        // Proposed content = current file on disk (may not exist if deleted)
        let proposed = std::fs::read_to_string(workspace_root.join(name)).unwrap_or_default();

        files.push(ReviewFileInfo {
            path: name.clone(),
            original_content: original,
            proposed_content: proposed,
        });
    }

    // 3. Also include untracked files (they appear as "new file" in review)
    let untracked_output = no_window_cmd("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(workspace_root)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    for name in untracked_output.lines() {
        let name = name.trim();
        if name.is_empty() || files.iter().any(|f| f.path == name) {
            continue;
        }
        let proposed = std::fs::read_to_string(workspace_root.join(name)).unwrap_or_default();
        files.push(ReviewFileInfo {
            path: name.to_string(),
            original_content: String::new(),
            proposed_content: proposed,
        });
    }

    Ok(files)
}

/// Revert a single file to the state the panel treats as "unchanged" (HEAD).
///
/// For a tracked file this restores the committed version, discarding staged
/// and unstaged edits together. A file that isn't in HEAD is a new file
/// (untracked or staged-add), so reverting it means removing it: `git rm -f`
/// clears it from the index and worktree, with a plain delete as the fallback
/// for a purely untracked file that git won't touch.
pub fn git_revert_file(workspace_root: &Path, path: &str) -> Result<(), String> {
    use crate::backend::cmd::no_window_cmd;

    // Tracked change vs HEAD → restore the committed version.
    let restored = no_window_cmd("git")
        .args(["checkout", "HEAD", "--", path])
        .current_dir(workspace_root)
        .status()
        .map_err(|e| format!("git failed: {e}"))?;
    if restored.success() {
        return Ok(());
    }

    // Not in HEAD → new file. Remove it from the index + worktree if git knows
    // it (staged-add); this is a no-op error for a purely untracked file.
    let removed = no_window_cmd("git")
        .args(["rm", "-f", "--", path])
        .current_dir(workspace_root)
        .status()
        .map_err(|e| format!("git failed: {e}"))?;
    if removed.success() {
        return Ok(());
    }

    // Purely untracked → just delete it from disk.
    match std::fs::remove_file(workspace_root.join(path)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("failed to remove {path}: {e}")),
    }
}

/// Revert all changed files shown in the panel to their HEAD version.
pub fn git_revert_all(workspace_root: &Path) -> Result<Vec<String>, String> {
    let files = git_diff_files(workspace_root)?;
    let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    for p in &paths {
        git_revert_file(workspace_root, p)?;
    }
    Ok(paths)
}
