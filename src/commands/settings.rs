use crate::backend::{config, llm};
use crate::AppState;
use serde::Serialize;
use tauri::State;

/// Windows-hide flag so child processes (git) don't pop a terminal window.
#[cfg(windows)]
const NO_WINDOW: u32 = 0x08000000; // CREATE_NO_WINDOW

/// Cross-platform helper that hides the child's console window on Windows.
fn no_window_cmd(prog: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(prog);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(NO_WINDOW);
    }
    cmd
}

#[derive(Serialize)]
pub struct Settings {
    pub model: String,
    pub summarize_model: String,
    pub workspace: String,
    pub provider: String,
    pub auto_summarize: bool,
    pub show_cost: bool,
}

#[derive(Serialize)]
pub struct ModelOption {
    pub name: String,
    pub display: String,
    pub provider: String,
    /// Accepts image input — lets the Vision role filter the list.
    pub vision: bool,
}

#[derive(Serialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
}

/// The tools the model can call, parsed from the live schema so `/tools` can
/// never drift from what's actually registered.
#[tauri::command]
pub async fn list_tools() -> Result<Vec<ToolInfo>, String> {
    Ok(crate::backend::tools::tool_summaries()
        .into_iter()
        .map(|(name, description)| ToolInfo { name, description })
        .collect())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let model = state.chat_model();
    let summarize_model = state.summarize_model();
    let workspace = state
        .workspace_root
        .lock()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let provider = llm::provider_for_model(&model).name().to_string();

    Ok(Settings {
        model,
        summarize_model,
        workspace,
        provider,
        auto_summarize: config::auto_summarize(),
        show_cost: config::show_cost(),
    })
}

#[tauri::command]
pub async fn set_auto_summarize(on: bool) -> Result<(), String> {
    config::save_auto_summarize(on);
    Ok(())
}

#[tauri::command]
pub async fn set_show_cost(on: bool) -> Result<(), String> {
    config::save_show_cost(on);
    Ok(())
}

#[tauri::command]
pub async fn set_model(state: State<'_, AppState>, model: String) -> Result<(), String> {
    config::save_last_model(&model);
    state.set_chat_model(model);
    Ok(())
}

#[tauri::command]
pub async fn set_summarize_model(state: State<'_, AppState>, model: String) -> Result<(), String> {
    config::save_last_summarize_model(&model);
    state.set_summarize_model(model);
    Ok(())
}

/// One model role and its current assignment, for the unified model selector.
#[derive(Serialize)]
pub struct ModelRole {
    /// "chat" | "summarize" | "vision".
    pub role: String,
    /// Assigned model name, empty if the role isn't set yet.
    pub model: String,
    /// Provider label for the assigned model (matches `list_models`), empty
    /// when unassigned.
    pub provider: String,
}

fn role_provider(model: &str) -> String {
    if model.is_empty() {
        String::new()
    } else {
        llm::provider_for_model(model).kind().label().to_string()
    }
}

/// Current model assignment for every role, in display order.
#[tauri::command]
pub async fn get_model_roles(state: State<'_, AppState>) -> Result<Vec<ModelRole>, String> {
    let chat = state.chat_model();
    let summarize = state.summarize_model();
    let vision = state.vision_model();
    Ok(vec![
        ModelRole {
            role: "chat".into(),
            provider: role_provider(&chat),
            model: chat,
        },
        ModelRole {
            role: "summarize".into(),
            provider: role_provider(&summarize),
            model: summarize,
        },
        ModelRole {
            role: "vision".into(),
            provider: role_provider(&vision),
            model: vision,
        },
    ])
}

/// Assign a model to a role. Persists it and updates the live AppState so the
/// next turn uses it. Unknown roles are rejected.
#[tauri::command]
pub async fn set_model_role(
    state: State<'_, AppState>,
    role: String,
    model: String,
) -> Result<(), String> {
    match role.as_str() {
        "chat" => {
            config::save_last_model(&model);
            state.set_chat_model(model);
        }
        "summarize" => {
            config::save_last_summarize_model(&model);
            state.set_summarize_model(model);
        }
        "vision" => {
            config::save_vision_model(&model);
            state.set_vision_model(model);
        }
        other => return Err(format!("unknown model role: {other}")),
    }
    Ok(())
}

#[tauri::command]
pub async fn set_workspace(state: State<'_, AppState>, path: String) -> Result<usize, String> {
    let root = std::path::PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("path does not exist: {path}"));
    }

    config::save_last_workspace(&root);
    config::ensure_gitignore(&root);

    // Prefer the workspace's cached graph (like startup does) so switching back
    // to an already-indexed repo is instant instead of forcing a full re-scan
    // — which on a large repo left the UI stuck on "Indexing workspace…". A
    // fresh repo with no cache still scans; the user can re-scan on demand.
    let graph_path = root.join(".micelio/graph.json");
    let graph = match crate::backend::knowledge::KnowledgeGraph::load(&graph_path) {
        Ok(g) if g.total_count() > 0 => g,
        _ => {
            let mut g = crate::backend::knowledge::KnowledgeGraph::new();
            g.scan_workspace(&root)?;
            g
        }
    };

    let count = graph.total_count();

    // Sessions are per-workspace: switch to the new folder's session store and
    // resume its most recent session (or start a fresh one).
    let store = crate::backend::sessions::SessionStore::open(&root.join(".micelio/sessions.db"))
        .map_err(|e| e.to_string())?;
    let model = state.chat_model();
    let session_id = match store.latest_session_id()? {
        Some(id) => id,
        None => store.create_session("New session", &model)?,
    };
    let resumed: Vec<crate::backend::llm::Message> = store
        .load_history(&session_id)
        .ok()
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default();

    *state.workspace_root.lock().unwrap() = root.clone();
    *state.graph.lock().unwrap() = graph;
    *state.sessions.lock().unwrap() = store;
    *state.current_session.lock().unwrap() = session_id.clone();
    // Clear all per-session history and load only the resumed session.
    let mut histories = state.session_histories.lock().unwrap();
    histories.clear();
    histories.insert(session_id, resumed);

    Ok(count)
}

/// List models from all configured providers. A provider without credentials
/// (e.g. OpenRouter without a key) simply contributes nothing.
#[tauri::command]
pub async fn list_models() -> Result<Vec<ModelOption>, String> {
    let catalog = llm::catalog();
    Ok(catalog
        .into_iter()
        .map(|m| ModelOption {
            display: m.name.trim_end_matches(":latest").to_string(),
            name: m.name,
            provider: m.provider.label().to_string(),
            vision: m.vision,
        })
        .collect())
}

/// Returns the currently saved OpenRouter API key (empty if none).
#[tauri::command]
pub async fn get_openrouter_key() -> Result<String, String> {
    Ok(config::openrouter_key().unwrap_or_default())
}

/// Persists the OpenRouter API key. Pass an empty string to clear it.
#[tauri::command]
pub async fn save_openrouter_key(key: String) -> Result<(), String> {
    config::save_openrouter_key(&key);
    Ok(())
}

#[derive(Serialize)]
pub struct OpenRouterStatus {
    pub ok: bool,
    pub count: usize,
    pub error: String,
}

/// Validate an OpenRouter API key by saving it and testing it against the
/// models endpoint. Returns the count of available models on success, or the
/// error message on failure. The caller can then refresh the model picker.
#[tauri::command]
pub async fn check_openrouter_key(key: String) -> Result<OpenRouterStatus, String> {
    config::save_openrouter_key(&key);

    let provider = llm::provider(llm::ProviderKind::OpenRouter);
    match provider.list_models() {
        Ok(models) => Ok(OpenRouterStatus {
            ok: true,
            count: models.len(),
            error: String::new(),
        }),
        Err(e) => Ok(OpenRouterStatus {
            ok: false,
            count: 0,
            error: e.to_string(),
        }),
    }
}

#[derive(Serialize)]
pub struct GitContext {
    pub branch: String,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
}

/// Get current git branch and file changes in the workspace.
#[tauri::command]
pub async fn get_git_context(state: State<'_, AppState>) -> Result<GitContext, String> {
    let root = state.workspace_root.lock().unwrap();

    // Get branch name
    let branch = no_window_cmd("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&*root)
        .output()
        .ok()
        .and_then(|out| {
            if out.status.success() {
                Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "no git".to_string());

    // Get diff stats (--cached for staged, without for unstaged)
    let diff_output = no_window_cmd("git")
        .args(["diff", "--numstat"])
        .current_dir(&*root)
        .output()
        .ok()
        .and_then(|out| {
            if out.status.success() {
                Some(String::from_utf8_lossy(&out.stdout).to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    // Parse diff output: each line is "added\tmodified\tfile"
    let (mut added, mut modified, mut deleted) = (0, 0, 0);
    for line in diff_output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 2 {
            if let (Ok(add), Ok(rem)) = (parts[0].parse::<usize>(), parts[1].parse::<usize>()) {
                added += add;
                deleted += rem;
            }
        }
        modified += 1;
    }

    Ok(GitContext {
        branch,
        added,
        modified,
        deleted,
    })
}

#[tauri::command]
pub async fn get_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_provider_empty_model() {
        assert_eq!(role_provider(""), "");
    }
}
