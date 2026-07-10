//! Review mode: when active, `file` write/edit tool calls block and wait for
//! the user to approve or reject the change (see
//! `commands::agent::execute_tool_call`) before it's written to disk —
//! mirroring how `ask_user` pauses the agent turn. There is no separate
//! staging area: an approved edit is written straight to disk, so it shows up
//! immediately as a normal (unstaged) git change. This module only tracks the
//! review-mode toggle and the workspace's unstaged git diff, which the
//! frontend shows as a revertable "changes" list.

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

pub struct ReviewManager {
    /// How the agent handles a turn (chat / auto / review). In Review mode,
    /// file writes/edits pause for user approval before hitting disk.
    pub mode: AgentMode,
    /// Cached git diff (unstaged). Refreshed on demand.
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

    /// Number of unstaged git changes.
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

/// Run `git diff` (unstaged) for the current workspace and return one
/// `ReviewFileInfo` per changed file. Each entry's `original_content` is
/// what's in the index/HEAD and `proposed_content` is the working-tree
/// version.
pub fn git_diff_files(workspace_root: &Path) -> Result<Vec<ReviewFileInfo>, String> {
    use crate::backend::cmd::no_window_cmd;

    // 1. Get list of changed files (unstaged, excluding untracked)
    let name_output = no_window_cmd("git")
        .args(["diff", "--name-only"])
        .current_dir(workspace_root)
        .output()
        .map_err(|e| format!("git failed: {e}"))?;
    if !name_output.status.success() {
        return Ok(Vec::new()); // not a git repo — silent
    }
    let names: Vec<String> = String::from_utf8_lossy(&name_output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    // 2. For each file, get unified diff and also the original/current content
    let mut files = Vec::new();
    for name in &names {
        // Original content (from index)
        let original = no_window_cmd("git")
            .args(["show", &format!(":{}", name)])
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

/// Revert a single file to the index version (git checkout).
pub fn git_revert_file(workspace_root: &Path, path: &str) -> Result<(), String> {
    use crate::backend::cmd::no_window_cmd;
    let status = no_window_cmd("git")
        .args(["checkout", "--", path])
        .current_dir(workspace_root)
        .status()
        .map_err(|e| format!("git failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("git checkout failed for {path}"))
    }
}

/// Revert all unstaged changes.
pub fn git_revert_all(workspace_root: &Path) -> Result<Vec<String>, String> {
    let files = git_diff_files(workspace_root)?;
    let paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    for p in &paths {
        git_revert_file(workspace_root, p)?;
    }
    Ok(paths)
}
