mod backend;
mod commands;

use backend::updater::Updater;
use std::collections::HashMap;
use std::env;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub use backend::knowledge::KnowledgeGraph;
use backend::sessions::SessionStore;

/// The model assigned to each role. Grouped behind a single lock because the
/// three are cohesive and every access is a short read-clone or write — none
/// holds one role's lock while touching another, so a shared mutex adds no
/// deadlock risk (unlike the session/graph state, which has nested-lock sites).
#[derive(Clone, Default)]
pub struct ModelRoles {
    /// Primary chat model.
    pub chat: String,
    /// Cheaper model used for node/graph summaries.
    pub summarize: String,
    /// Vision role (image input). Empty = not assigned yet.
    pub vision: String,
}

pub struct AppState {
    pub graph: Mutex<KnowledgeGraph>,
    pub workspace_root: Mutex<std::path::PathBuf>,
    pub current_workspace: Mutex<backend::workspace::Workspace>,
    /// Per-role model assignments (chat / summarize / vision).
    pub models: Mutex<ModelRoles>,
    pub sessions: Mutex<SessionStore>,
    pub current_session: Mutex<String>,
    pub summarize_cancel: Arc<AtomicBool>,
    pub scan_cancel: Arc<AtomicBool>,
    /// Per-session in-memory LLM history (replaces the old global ChatHistory state).
    pub session_histories: Mutex<HashMap<String, Vec<backend::llm::Message>>>,
    /// Per-session cancel flags so stopping one stream doesn't affect others.
    pub session_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Parked ask_user call: (session_id, reply channel).
    pub session_pending: Mutex<Option<(String, std::sync::mpsc::Sender<String>)>>,
    /// Parked file edit/write approval (review mode): (session_id, reply channel).
    pub pending_edit: Mutex<Option<(String, std::sync::mpsc::Sender<bool>)>>,
    /// Review manager: review-mode toggle + unstaged git changes.
    pub review: Mutex<backend::review::ReviewManager>,
}

impl AppState {
    /// Current chat model (cloned; lock released immediately).
    pub fn chat_model(&self) -> String {
        self.models.lock().unwrap().chat.clone()
    }
    /// Current summarize-role model.
    pub fn summarize_model(&self) -> String {
        self.models.lock().unwrap().summarize.clone()
    }
    /// Current vision-role model (empty when unassigned).
    pub fn vision_model(&self) -> String {
        self.models.lock().unwrap().vision.clone()
    }
    pub fn set_chat_model(&self, m: String) {
        self.models.lock().unwrap().chat = m;
    }
    pub fn set_summarize_model(&self, m: String) {
        self.models.lock().unwrap().summarize = m;
    }
    pub fn set_vision_model(&self, m: String) {
        self.models.lock().unwrap().vision = m;
    }

    /// Resolve the model for a role on a specific session: the per-session pin
    /// if set, otherwise the global default for that role. The two locks are
    /// taken sequentially (the sessions guard is dropped before `*_model()`
    /// locks `models`) to avoid the nested-locking deadlock flagged in BACKLOG.
    pub fn session_chat_model(&self, session_id: &str) -> String {
        let pinned = self
            .sessions
            .lock()
            .unwrap()
            .session_model(session_id, "chat");
        if pinned.is_empty() {
            self.chat_model()
        } else {
            pinned
        }
    }
    pub fn session_summarize_model(&self, session_id: &str) -> String {
        let pinned = self
            .sessions
            .lock()
            .unwrap()
            .session_model(session_id, "summarize");
        if pinned.is_empty() {
            self.summarize_model()
        } else {
            pinned
        }
    }
    pub fn session_vision_model(&self, session_id: &str) -> String {
        let pinned = self
            .sessions
            .lock()
            .unwrap()
            .session_model(session_id, "vision");
        if pinned.is_empty() {
            self.vision_model()
        } else {
            pinned
        }
    }
}

fn ensure_cli_path() {
    let extra = ["/opt/homebrew/bin", "/usr/local/bin"];
    let current = env::var("PATH").unwrap_or_default();
    let missing: Vec<&str> = extra
        .iter()
        .copied()
        .filter(|p| !current.split(':').any(|c| c == *p))
        .collect();
    if !missing.is_empty() {
        let merged = if current.is_empty() {
            missing.join(":")
        } else {
            format!("{}:{}", missing.join(":"), current)
        };
        unsafe { env::set_var("PATH", merged) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_cli_path();

    let legacy_root = backend::config::last_workspace().unwrap_or_else(|| {
        // Use the app's own data directory under ~/.micelio/workspace-root/ as a
        // safe fallback when no workspace was ever picked.  This avoids touching
        // ~/Documents/ (or another TCC-guarded path) on every launch, which would
        // otherwise trigger repeated macOS permission prompts.
        let fallback = backend::config::app_data_dir().join("workspace-root");
        let _ = std::fs::create_dir_all(&fallback);
        fallback
    });

    let workspace = backend::workspace::bootstrap_default_workspace(&legacy_root);
    
    // O workspace_root em memória (onde as tools buscam hoje) será o primeiro folder do workspace,
    // ou a pasta do próprio workspace caso não tenha folders ainda.
    let workspace_root = workspace.folders.first().cloned().unwrap_or_else(|| workspace.dir());

    let model = backend::config::last_model().unwrap_or_else(|| "claude-sonnet-4-6".to_string());

    let summarize_model =
        backend::config::last_summarize_model().unwrap_or_else(|| "claude-haiku-4-6".to_string());

    // Vision is optional — empty string means "not assigned" until the user
    // picks a model for it.
    let vision_model = backend::config::vision_model().unwrap_or_default();

    // graph.json e sessions.db agora residem no diretório do workspace!
    let graph_path = workspace.dir().join("graph.json");
    let mut graph = backend::knowledge::KnowledgeGraph::load(&graph_path).unwrap_or_default();
    // If graph is empty (new workspace or no scan yet), scan all folders now
    if graph.total_count() == 0 {
        let multi = workspace.folders.len() > 1;
        for folder in &workspace.folders {
            let prefix = if multi { folder.file_name().map(|n| n.to_string_lossy().to_string()) } else { None };
            if let Err(e) = graph.scan_workspace(folder, prefix) {
                eprintln!("scan error on startup for {folder:?}: {e}");
            }
        }
        let _ = graph.save(&graph_path);
    }

    if let Some(first_folder) = workspace.folders.first() {
        backend::config::ensure_gitignore(first_folder);
    }

    let sessions = SessionStore::open(&workspace.dir().join("sessions.db"))
        .expect("open session store");
    let current_session = match sessions.latest_session_id() {
        Ok(Some(id)) => id,
        _ => sessions
            .create_session("New session", &model)
            .unwrap_or_default(),
    };
    let resumed_history: Vec<backend::llm::Message> = sessions
        .load_history(&current_session)
        .ok()
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default();

    let mut initial_histories = HashMap::new();
    if !current_session.is_empty() {
        initial_histories.insert(current_session.clone(), resumed_history);
    }

    let updater = Arc::new(Updater::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            backend::tools::bg::set_app_handle(app.handle().clone());
            Ok(())
        })
        .manage(AppState {
            graph: Mutex::new(graph),
            workspace_root: Mutex::new(workspace_root),
            current_workspace: Mutex::new(workspace.clone()),
            models: Mutex::new(ModelRoles {
                chat: model,
                summarize: summarize_model,
                vision: vision_model,
            }),
            sessions: Mutex::new(sessions),
            current_session: Mutex::new(current_session),
            summarize_cancel: Arc::new(AtomicBool::new(false)),
            scan_cancel: Arc::new(AtomicBool::new(false)),
            session_histories: Mutex::new(initial_histories),
            session_cancels: Mutex::new(HashMap::new()),
            session_pending: Mutex::new(None),
            pending_edit: Mutex::new(None),
            review: Mutex::new(backend::review::ReviewManager::new()),
        })
        .manage(updater)
        .invoke_handler(tauri::generate_handler![
            commands::chat::send_message,
            commands::chat::start_chat_stream,
            commands::chat::stop_chat_stream,
            commands::chat::answer_question,
            commands::chat::get_history,
            commands::chat::clear_history,
            commands::chat::get_context_window,
            commands::chat::get_transcript,
            commands::chat::get_system_prompt,
            commands::chat::set_system_prompt,
            commands::chat::reset_system_prompt,
            commands::chat::save_attachment,
            commands::chat::compact_chat,
            commands::graph::get_graph,
            commands::graph::scan_workspace,
            commands::graph::cancel_workspace_scan,
            commands::graph::summarize_node,
            commands::graph::summarize_all,
            commands::graph::stop_summarize,
            commands::graph::get_node_code,
            commands::settings::get_settings,
            commands::settings::set_model,
            commands::settings::set_summarize_model,
            commands::settings::get_model_roles,
            commands::settings::set_model_role,
            commands::settings::set_workspace,
            commands::settings::list_models,
            commands::settings::list_tools,
            commands::settings::get_openrouter_key,
            commands::settings::save_openrouter_key,
            commands::settings::check_openrouter_key,
            commands::settings::get_git_context,
            commands::settings::get_version,
            commands::settings::set_auto_summarize,
            commands::settings::set_show_cost,
            commands::workspace::get_current_workspace,
            commands::workspace::list_all_workspaces,
            commands::workspace::set_active_root,
            commands::workspace::list_all_workspaces_with_sessions,
            commands::workspace::create_workspace,
            commands::workspace::switch_workspace,
            commands::workspace::add_folder_to_workspace,
            commands::workspace::remove_folder_from_workspace,
            commands::workspace::rename_workspace,
            commands::workspace::delete_workspace,
            commands::sessions::list_sessions,
            commands::sessions::new_session,
            commands::sessions::switch_session,
            commands::sessions::delete_session,
            commands::sessions::get_usage_stats,
            commands::sessions::clear_usage,
            commands::sessions::get_usage_log,
            commands::sessions::get_usage_raw,
            commands::sessions::get_session_models,
            commands::sessions::set_session_model,
            commands::bg::list_bg_tasks,
            commands::bg::stop_bg_task,
            commands::bg::clear_bg_tasks,
            commands::bg::get_bg_task_log,
            commands::review::get_review_status,
            commands::review::toggle_review_mode,
            commands::review::get_review_mode,
            commands::review::git_revert_review_file,
            commands::review::git_revert_all_review,
            commands::review::answer_edit_review,
            commands::openers::list_openers,
            commands::openers::open_in,
            commands::openers::open_url,
            commands::updater::check_for_updates,
            commands::updater::get_update_status,
            commands::updater::get_app_version,
            commands::updater::start_update_download,
            commands::updater::install_and_restart,
        ])
        .run(tauri::generate_context!())
        .expect("error running Tauri app");
}
