use crate::backend::llm::Provider as _;
use crate::backend::{cmd::no_window_cmd, config, llm};
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct Settings {
    pub model: String,
    pub summarize_model: String,
    pub workspace: String,
    pub provider: String,
    pub auto_summarize: bool,
    pub show_cost: bool,
    pub show_model: bool,
}

#[derive(Serialize)]
pub struct ModelOption {
    pub name: String,
    pub display: String,
    /// Display label of the serving provider.
    pub provider: String,
    /// Stable id of the serving provider — two endpoints can share a display
    /// name, so group on this rather than on `provider`.
    pub provider_id: String,
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
pub async fn list_tools(state: State<'_, AppState>) -> Result<Vec<ToolInfo>, String> {
    let mut tools: Vec<ToolInfo> = crate::backend::tools::tool_summaries()
        .into_iter()
        .map(|(name, description)| ToolInfo { name, description })
        .collect();
    // Append discovered MCP tools under their namespaced names.
    tools.extend(state.mcp.list_tools().into_iter().map(|t| ToolInfo {
        name: t.namespaced,
        description: t.description,
    }));
    Ok(tools)
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
    let provider = llm::provider_for_model(&model).label();

    Ok(Settings {
        model,
        summarize_model,
        workspace,
        provider,
        auto_summarize: config::auto_summarize(),
        show_cost: config::show_cost(),
        show_model: config::show_model(),
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
pub async fn set_show_model(on: bool) -> Result<(), String> {
    config::save_show_model(on);
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
        llm::provider_for_model(model).label()
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
            g.scan_workspace(&root, None)?;
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

/// List models from every enabled provider. One that can't be reached (daemon
/// down, bad URL, rejected key) contributes nothing rather than failing the
/// whole catalog.
#[tauri::command]
pub async fn list_models() -> Result<Vec<ModelOption>, String> {
    let catalog = llm::catalog();
    Ok(catalog
        .into_iter()
        .map(|m| ModelOption {
            display: m.name.trim_end_matches(":latest").to_string(),
            name: m.name,
            provider: m.provider_label,
            provider_id: m.provider_id,
            vision: m.vision,
        })
        .collect())
}

// ── OpenAI-compatible endpoints ─────────────────────────────────────────────

/// One configured endpoint as the settings panel sees it. The key is masked —
/// the raw value never leaves the backend once saved.
#[derive(Serialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub base_url: String,
    /// Masked key for display, e.g. "sk-or-•••4f2a". Empty when unset.
    pub key_hint: String,
    pub has_key: bool,
    pub enabled: bool,
    /// "openai" or "openrouter".
    pub flavor: String,
}

/// Endpoint fields coming from the settings form. `api_key` is optional on
/// edit: `None` keeps the stored key, `Some("")` clears it.
#[derive(serde::Deserialize)]
pub struct ProviderInput {
    /// Empty/absent on create — the backend assigns the id.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub flavor: Option<String>,
}

#[derive(Serialize)]
pub struct ProviderStatus {
    pub ok: bool,
    pub count: usize,
    pub error: String,
}

fn flavor_from_str(s: &str) -> config::ProviderFlavor {
    match s {
        "openrouter" => config::ProviderFlavor::Openrouter,
        _ => config::ProviderFlavor::Openai,
    }
}

fn flavor_to_str(f: config::ProviderFlavor) -> &'static str {
    match f {
        config::ProviderFlavor::Openrouter => "openrouter",
        config::ProviderFlavor::Openai => "openai",
    }
}

/// Show enough of a key to recognise it without exposing it. A key too short
/// to mask meaningfully is hidden entirely rather than half-revealed.
fn mask_key(key: &str) -> String {
    let n = key.chars().count();
    if n == 0 {
        return String::new();
    }
    if n <= 12 {
        return "•".repeat(n);
    }
    let head: String = key.chars().take(6).collect();
    let tail: String = key.chars().skip(n - 4).collect();
    format!("{head}•••{tail}")
}

fn to_info(c: &config::ProviderConfig) -> ProviderInfo {
    ProviderInfo {
        id: c.id.clone(),
        name: c.name.clone(),
        base_url: c.base_url.clone(),
        key_hint: mask_key(&c.api_key),
        has_key: !c.api_key.is_empty(),
        enabled: c.enabled,
        flavor: flavor_to_str(c.flavor).to_string(),
    }
}

/// Every configured OpenAI-compatible endpoint, in display order.
#[tauri::command]
pub async fn list_providers() -> Result<Vec<ProviderInfo>, String> {
    Ok(config::providers().iter().map(to_info).collect())
}

/// Create or update an endpoint, then reload the registry so the model
/// catalog reflects it immediately. Returns the saved entry.
#[tauri::command]
pub async fn upsert_provider(input: ProviderInput) -> Result<ProviderInfo, String> {
    let name = input.name.trim();
    let base_url = input.base_url.trim();
    if name.is_empty() {
        return Err("name is required".into());
    }
    if base_url.is_empty() {
        return Err("base URL is required".into());
    }

    let mut list = config::providers();
    let existing = list
        .iter()
        .position(|p| p.id == input.id && !input.id.is_empty());

    let saved = match existing {
        Some(i) => {
            let entry = &mut list[i];
            entry.name = name.to_string();
            entry.base_url = base_url.to_string();
            // None = leave the stored key alone; Some("") = clear it.
            if let Some(k) = &input.api_key {
                entry.api_key = k.trim().to_string();
            }
            if let Some(f) = &input.flavor {
                entry.flavor = flavor_from_str(f);
            }
            entry.clone()
        }
        None => {
            let entry = config::ProviderConfig {
                id: new_provider_id(name, &list),
                name: name.to_string(),
                base_url: base_url.to_string(),
                api_key: input.api_key.unwrap_or_default().trim().to_string(),
                enabled: true,
                flavor: flavor_from_str(input.flavor.as_deref().unwrap_or("openai")),
            };
            list.push(entry.clone());
            entry
        }
    };

    config::save_providers(&list);
    llm::reload_providers();
    Ok(to_info(&saved))
}

/// Slug of `name`, suffixed if needed so ids stay unique (model resolution
/// keys off them).
fn new_provider_id(name: &str, existing: &[config::ProviderConfig]) -> String {
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() {
        "endpoint".to_string()
    } else {
        base
    };
    if !existing.iter().any(|p| p.id == base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|id| !existing.iter().any(|p| &p.id == id))
        .unwrap()
}

/// Remove an endpoint and reload the registry.
#[tauri::command]
pub async fn remove_provider(id: String) -> Result<(), String> {
    let mut list = config::providers();
    list.retain(|p| p.id != id);
    config::save_providers(&list);
    llm::reload_providers();
    Ok(())
}

/// Enable/disable an endpoint without losing its config, then reload.
#[tauri::command]
pub async fn set_provider_enabled(id: String, enabled: bool) -> Result<(), String> {
    let mut list = config::providers();
    if let Some(p) = list.iter_mut().find(|p| p.id == id) {
        p.enabled = enabled;
    }
    config::save_providers(&list);
    llm::reload_providers();
    Ok(())
}

/// Probe an endpoint's `/models` without saving it, so the form can verify a
/// URL/key before committing. Reports the model count or the error.
#[tauri::command]
pub async fn test_provider(input: ProviderInput) -> Result<ProviderStatus, String> {
    // An edit that leaves the key untouched still needs it to authenticate.
    let api_key = match input.api_key {
        Some(k) => k,
        None => config::providers()
            .iter()
            .find(|p| p.id == input.id)
            .map(|p| p.api_key.clone())
            .unwrap_or_default(),
    };

    let probe = config::ProviderConfig {
        id: "probe".to_string(),
        name: input.name.trim().to_string(),
        base_url: input.base_url.trim().to_string(),
        api_key,
        enabled: true,
        flavor: flavor_from_str(input.flavor.as_deref().unwrap_or("openai")),
    };

    let provider = crate::backend::openai_compat::OpenAiCompatProvider::from_config(&probe);
    match provider.list_models() {
        Ok(models) => Ok(ProviderStatus {
            ok: true,
            count: models.len(),
            error: String::new(),
        }),
        Err(e) => Ok(ProviderStatus {
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

    // Diff stats vs HEAD so both staged and unstaged changes are counted.
    let diff_output = no_window_cmd("git")
        .args(["diff", "HEAD", "--numstat"])
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

    // Parse numstat: each line is "added\tdeleted\tfile" ("-\t-" for binary).
    let (mut added, mut modified, mut deleted) = (0usize, 0usize, 0usize);
    for line in diff_output.lines() {
        let mut cols = line.split('\t');
        if let (Some(add), Some(rem)) = (cols.next(), cols.next()) {
            added += add.parse::<usize>().unwrap_or(0);
            deleted += rem.parse::<usize>().unwrap_or(0);
            modified += 1;
        }
    }

    // Untracked files never appear in a diff — count each line as an addition
    // so the badge reflects all uncommitted work, matching the changes panel.
    let untracked_output = no_window_cmd("git")
        .args(["ls-files", "--others", "--exclude-standard"])
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
    for name in untracked_output.lines() {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(root.join(name)) {
            added += content.lines().count();
            modified += 1;
        }
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

    #[test]
    fn mask_key_never_reveals_the_secret() {
        assert_eq!(mask_key(""), "");
        // Long enough to mask: only the first 6 and last 4 survive.
        let masked = mask_key("sk-or-v1-0123456789abcdef4f2a");
        assert_eq!(masked, "sk-or-•••4f2a");
        assert!(!masked.contains("0123456789"), "middle is hidden");
        // Short keys would be mostly exposed by head+tail, so hide them fully.
        assert_eq!(mask_key("sk-12345678"), "•".repeat(11));
    }

    #[test]
    fn new_provider_id_slugifies_and_dedupes() {
        let existing = vec![config::ProviderConfig {
            id: "my-gateway".to_string(),
            name: "My Gateway".to_string(),
            base_url: "http://x/v1".to_string(),
            api_key: String::new(),
            enabled: true,
            flavor: config::ProviderFlavor::Openai,
        }];
        assert_eq!(new_provider_id("Groq", &[]), "groq");
        // Ids key model resolution, so a colliding name must not reuse the id.
        assert_eq!(new_provider_id("My Gateway!", &existing), "my-gateway-2");
        assert_eq!(new_provider_id("///", &[]), "endpoint");
    }
}
