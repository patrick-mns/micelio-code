mod backend;
mod commands;

use backend::updater::Updater;
use std::collections::HashMap;
use std::env;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub use backend::knowledge::KnowledgeGraph;
use backend::sessions::SessionStore;
use tauri::{Emitter, Manager};

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
    /// The workspace currently loaded in memory, or `None` when the app has no
    /// workspaces yet (fresh install / all deleted) and is showing onboarding.
    pub current_workspace: Mutex<Option<backend::workspace::Workspace>>,
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
    /// Parked ask_user calls keyed by session, so a question in one session
    /// doesn't get answered by another session's reply.
    pub session_pending: Mutex<HashMap<String, std::sync::mpsc::Sender<String>>>,
    /// Parked file edit/write approvals (review mode), keyed by session.
    pub pending_edit: Mutex<HashMap<String, std::sync::mpsc::Sender<bool>>>,
    /// Parked generic tool confirmations (review mode) for side-effecting
    /// non-file tools, keyed by session.
    pub pending_confirm:
        Mutex<HashMap<String, std::sync::mpsc::Sender<backend::review::ConfirmDecision>>>,
    /// Per-session set of tool names the user chose to "always allow" this
    /// session (Review-mode confirmations). In-memory only; cleared on restart.
    pub session_tool_allow: Mutex<HashMap<String, std::collections::HashSet<String>>>,
    /// Review manager: review-mode toggle + uncommitted git changes.
    pub review: Mutex<backend::review::ReviewManager>,
    /// MCP client manager: live connections to external MCP servers and the
    /// tools they expose. Shared into every tool-call context.
    pub mcp: Arc<backend::mcp::McpManager>,
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

    /// The agent mode for this session: its pinned value, or the global default
    /// (used by new/unset sessions) when unset.
    pub fn session_agent_mode(&self, session_id: &str) -> backend::review::AgentMode {
        let pinned = self.sessions.lock().unwrap().session_mode(session_id);
        if pinned.is_empty() {
            self.review.lock().unwrap().mode
        } else {
            backend::review::AgentMode::from_str(&pinned)
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

    // Load the existing workspaces, if any. We no longer auto-create a default
    // "workspace-root" on first launch — a fresh install starts with NO
    // workspace and the UI shows an onboarding screen where the user creates
    // their first one. Returning users reopen the workspace they last visited
    // (matched by its first folder), falling back to the first available.
    let current_workspace: Option<backend::workspace::Workspace> = {
        let all = backend::workspace::list_workspaces();
        let by_last = backend::config::last_workspace().and_then(|last| {
            all.iter()
                .find(|w| w.folders.first() == Some(&last))
                .cloned()
        });
        by_last.or_else(|| all.into_iter().next())
    };

    // Runtime structures fall back to safe empties when there's no workspace.
    // The main UI is gated behind having a workspace, so these placeholders are
    // never actually exercised until the user creates or opens one.
    let data_dir = current_workspace
        .as_ref()
        .map(|w| w.dir())
        .unwrap_or_else(|| backend::config::app_data_dir().join("_no_workspace"));
    let _ = std::fs::create_dir_all(&data_dir);

    // O workspace_root em memória (onde as tools buscam hoje) será o primeiro folder do workspace,
    // ou a pasta de dados de fallback caso não haja workspace/folders ainda.
    let workspace_root = current_workspace
        .as_ref()
        .and_then(|w| w.folders.first().cloned())
        .unwrap_or_else(|| data_dir.clone());

    let model = backend::config::last_model().unwrap_or_else(|| "claude-sonnet-4-6".to_string());

    let summarize_model =
        backend::config::last_summarize_model().unwrap_or_else(|| "claude-haiku-4-6".to_string());

    // Vision is optional — empty string means "not assigned" until the user
    // picks a model for it.
    let vision_model = backend::config::vision_model().unwrap_or_default();

    // graph.json e sessions.db agora residem no diretório do workspace!
    // Load the saved graph, or start empty. We deliberately DON'T scan here:
    // scanning a large folder would block startup and the window would never
    // appear. When the graph is empty, the frontend kicks off a background scan
    // (with progress + cancel + overlay) right after it loads the workspace.
    let graph_path = data_dir.join("graph.json");
    let graph = backend::knowledge::KnowledgeGraph::load(&graph_path).unwrap_or_default();

    if let Some(first_folder) = current_workspace.as_ref().and_then(|w| w.folders.first()) {
        backend::config::ensure_gitignore(first_folder);
    }

    let sessions = SessionStore::open(&data_dir.join("sessions.db")).expect("open session store");
    let current_session = match sessions.latest_session_id() {
        Ok(Some(id)) => id,
        _ => "".to_string(), // Allow absolutely no sessions on brand new workspace
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

    // MCP manager: owns its own runtime and the live server connections.
    // Building the manager is cheap (no connections yet); the actual connect
    // happens off the main thread in `setup` so a slow/hung server never blocks
    // app startup.
    let mcp = Arc::new(backend::mcp::McpManager::new().expect("failed to build MCP runtime"));
    let mcp_for_setup = mcp.clone();

    // Folders of the workspace open at startup — granted to the asset protocol
    // in `setup` so their skill icons and image previews load in the webview.
    let initial_asset_dirs: Vec<std::path::PathBuf> = current_workspace
        .as_ref()
        .map(|w| w.folders.clone())
        .unwrap_or_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            backend::tools::bg::set_app_handle(app.handle().clone());

            // Open the startup workspace's folders to the asset protocol (empty
            // static scope in tauri.conf; the workspace is only known at runtime).
            let asset_scope = app.asset_protocol_scope();
            for dir in &initial_asset_dirs {
                let _ = asset_scope.allow_directory(dir, true);
            }

            // Connect to configured MCP servers off the main thread. Emits
            // `mcp_status` when done so the UI can refresh its server list.
            {
                let mcp = mcp_for_setup.clone();
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    mcp.reload();
                    let _ = handle.emit("mcp_status", mcp.server_status());
                });
            }

            // Start the skills filesystem watcher (debounce thread). It will
            // wait until `watch_workspace` is called to begin watching.
            backend::skill_watcher::init(app.handle().clone());

            // Remove native window decorations on Windows/Linux so the app can
            // draw its own title-bar buttons (minimize/maximize/close) inside the
            // custom header, matching the macOS traffic-light experience.
            if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
                if let Some(window) = app.get_webview_window("main") {
                    let _: Result<(), _> = window.set_decorations(false);
                }
            }

            Ok(())
        })
        .manage(AppState {
            graph: Mutex::new(graph),
            workspace_root: Mutex::new(workspace_root),
            current_workspace: Mutex::new(current_workspace),
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
            session_pending: Mutex::new(HashMap::new()),
            pending_edit: Mutex::new(HashMap::new()),
            pending_confirm: Mutex::new(HashMap::new()),
            session_tool_allow: Mutex::new(HashMap::new()),
            review: Mutex::new(backend::review::ReviewManager::new()),
            mcp,
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
            commands::graph::set_node_locked,
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
            commands::settings::list_providers,
            commands::settings::upsert_provider,
            commands::settings::remove_provider,
            commands::settings::set_provider_enabled,
            commands::settings::test_provider,
            commands::settings::get_git_context,
            commands::settings::get_version,
            commands::settings::set_auto_summarize,
            commands::settings::set_show_cost,
            commands::settings::set_show_model,
            commands::settings::set_sandbox_enabled,
            commands::settings::set_sandbox_network,
            commands::workspace::get_current_workspace,
            commands::workspace::list_all_workspaces,
            commands::workspace::set_active_root,
            commands::workspace::search_workspace_files,
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
            commands::mcp::mcp_list_servers,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_get_config,
            commands::mcp::mcp_save_config,
            commands::mcp::mcp_reload,
            commands::mcp::mcp_authorize,
            commands::review::get_review_status,
            commands::review::set_agent_mode,
            commands::review::get_agent_mode,
            commands::review::get_session_mode,
            commands::review::set_session_mode,
            commands::review::git_revert_review_file,
            commands::review::git_revert_all_review,
            commands::review::answer_edit_review,
            commands::review::answer_tool_confirm,
            commands::openers::list_openers,
            commands::openers::open_in,
            commands::openers::open_url,
            commands::updater::check_for_updates,
            commands::updater::get_update_status,
            commands::updater::get_app_version,
            commands::updater::start_update_download,
            commands::updater::install_and_restart,
            commands::skills::load_skills,
            commands::skills::list_skills,
            commands::skills::toggle_skill,
            commands::skills::set_skill_enabled,
            commands::skills::get_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error running Tauri app");
}
