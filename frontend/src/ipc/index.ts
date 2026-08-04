import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  AskUser, BgTaskExited, BgTaskInfo, ChatMessage, CompactResult, ContextWindow, DirEntry,
  EditReviewRequest, FileContent, FileHit, GitContext, LoopStatus, LoopStatusEvent, McpServerStatus, McpToolInfo,
  ModelOption, ModelRole, NodeCode, NodeSummarized, Opener,
  ProviderInfo, ProviderInput, ProviderStatus, PtyExit, PtyOutput,
  SessionInfo, SessionModels, SessionTitle,
  Settings, SkillDetail, SkillSummary, StreamDelta, StreamDone,
  StreamError, StreamTool, StreamUsage, SummarizeProgress, SystemPromptInfo,
  ToolConfirmRequest, ToolInfo, Transcript, TreemapNode, UsageLogEntry, UsageRaw, UsageStats,
} from '@/types';

// Typed listener helper: `listen` hands the callback the full event; every
// consumer here only wants the payload, so unwrap it and return the unlisten fn.
const on = <T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> =>
  listen<T>(event, (e) => cb(e.payload));

export const ipc = {
  sendMessage: (content: string) => invoke<ChatMessage>('send_message', { content }),
  startChatStream: (content: string) => invoke<string>('start_chat_stream', { content }),
  listTools: () => invoke<ToolInfo[]>('list_tools'),

  // MCP servers
  mcpListServers: () => invoke<McpServerStatus[]>('mcp_list_servers'),
  mcpListTools: () => invoke<McpToolInfo[]>('mcp_list_tools'),
  mcpGetConfig: () => invoke<string>('mcp_get_config'),
  mcpSaveConfig: (raw: string) => invoke<McpServerStatus[]>('mcp_save_config', { raw }),
  mcpReload: () => invoke<McpServerStatus[]>('mcp_reload'),
  /** Run the interactive OAuth flow for an HTTP server; resolves when done + reconnected. */
  mcpAuthorize: (serverName: string) =>
    invoke<McpServerStatus[]>('mcp_authorize', { serverName }),
  /** Fires with the authorization URL when an OAuth flow starts (fallback if browser didn't open). */
  onMcpOauthUrl: (cb: (p: { server_name: string; auth_url: string }) => void) =>
    on<{ server_name: string; auth_url: string }>('mcp_oauth_url', cb),
  stopChatStream: (sessionId?: string) => invoke<void>('stop_chat_stream', { sessionId }),

  // Self-pacing background loop for a session (/loop): after each turn the
  // model calls the `schedule_wakeup` tool to keep it going, or it stops on
  // its own. `prompt` overrides the default "continue from history" kickoff.
  startLoop: (sessionId?: string, prompt?: string, forever?: boolean) =>
    invoke<void>('start_loop', { sessionId, prompt, forever }),
  stopLoop: (sessionId?: string) => invoke<void>('stop_loop', { sessionId }),
  getLoopStatus: (sessionId?: string) => invoke<LoopStatus>('get_loop_status', { sessionId }),
  onLoopStatus: (cb: (p: LoopStatusEvent) => void) => on<LoopStatusEvent>('loop_status', cb),
  answerQuestion: (answer: string, sessionId?: string) => invoke<void>('answer_question', { answer, sessionId }),
  getHistory: (sessionId?: string) => invoke<ChatMessage[]>('get_history', { sessionId }),
  clearHistory: (sessionId?: string) => invoke<void>('clear_history', { sessionId }),
  getContextWindow: () => invoke<ContextWindow>('get_context_window'),
  getTranscript: () => invoke<Transcript>('get_transcript'),
  getSystemPrompt: () => invoke<SystemPromptInfo>('get_system_prompt'),
  setSystemPrompt: (text: string) => invoke<boolean>('set_system_prompt', { text }),
  resetSystemPrompt: () => invoke<string>('reset_system_prompt'),
  saveAttachment: (dataBase64: string, ext: string) => invoke<string>('save_attachment', { dataBase64, ext }),
  compactChat: () => invoke<CompactResult>('compact_chat'),

  getGraph: () => invoke<TreemapNode[]>('get_graph'),
  /** Lock/unlock the file a node maps to. Returns the path actually locked. */
  setNodeLocked: (nodeId: number, locked: boolean) =>
    invoke<string>('set_node_locked', { nodeId, locked }),
  scanWorkspace: () => invoke<void>('scan_workspace'),
  cancelWorkspaceScan: () => invoke<void>('cancel_workspace_scan'),
  summarizeNode: (nodeId: number) => invoke<string>('summarize_node', { nodeId }),
  // concurrency optional — omit (or pass undefined) to use the backend default.
  summarizeAll: (concurrency?: number) => invoke<void>('summarize_all', { concurrency }),
  stopSummarize: () => invoke<void>('stop_summarize'),
  getNodeCode: (nodeId: number) => invoke<NodeCode>('get_node_code', { nodeId }),

  getSettings: () => invoke<Settings>('get_settings'),
  setModel: (model: string) => invoke<void>('set_model', { model }),
  setSummarizeModel: (model: string) => invoke<void>('set_summarize_model', { model }),
  getModelRoles: () => invoke<ModelRole[]>('get_model_roles'),
  setModelRole: (role: string, model: string) => invoke<void>('set_model_role', { role, model }),
  setAutoSummarize: (on: boolean) => invoke<void>('set_auto_summarize', { on }),
  setShowCost: (on: boolean) => invoke<void>('set_show_cost', { on }),
  setShowModel: (on: boolean) => invoke<void>('set_show_model', { on }),
  setSandboxEnabled: (on: boolean) => invoke<void>('set_sandbox_enabled', { on }),
  setSandboxNetwork: (on: boolean) => invoke<void>('set_sandbox_network', { on }),
  setWorkspace: (path: string) => invoke<void>('set_workspace', { path }),
  listModels: () => invoke<ModelOption[]>('list_models'),
  listProviders: () => invoke<ProviderInfo[]>('list_providers'),
  upsertProvider: (input: ProviderInput) => invoke<ProviderInfo>('upsert_provider', { input }),
  removeProvider: (id: string) => invoke<void>('remove_provider', { id }),
  setProviderEnabled: (id: string, enabled: boolean) =>
    invoke<void>('set_provider_enabled', { id, enabled }),
  testProvider: (input: ProviderInput) => invoke<ProviderStatus>('test_provider', { input }),
  getGitContext: () => invoke<GitContext>('get_git_context'),
  getVersion: () => invoke<string>('get_version'),

  getUsageStats: (from: number | null, to: number | null) =>
    invoke<UsageStats>('get_usage_stats', { from: from ?? null, to: to ?? null }),
  clearUsage: () => invoke<void>('clear_usage'),
  getUsageLog: (from: number | null, to: number | null) =>
    invoke<UsageLogEntry[]>('get_usage_log', { from: from ?? null, to: to ?? null }),
  getUsageRaw: (id: number) => invoke<UsageRaw>('get_usage_raw', { id }),
  listSessions: () => invoke<SessionInfo[]>('list_sessions'),
  newSession: () => invoke<string>('new_session'),
  switchSession: (id: string) => invoke<ChatMessage[]>('switch_session', { id }),
  deleteSession: (id: string) => invoke<void>('delete_session', { id }),
  getSessionModels: (sessionId: string) => invoke<SessionModels>('get_session_models', { sessionId }),
  setSessionModel: (sessionId: string, role: string, model: string) =>
    invoke<void>('set_session_model', { sessionId, role, model }),

  /** The session's dock strip as it was last left, or '' if it never had one.
   * Opaque JSON both ways — the layout is the frontend's shape, the backend
   * just keeps it next to the conversation. */
  getSessionDock: (sessionId: string) => invoke<string>('get_session_dock', { sessionId }),
  setSessionDock: (sessionId: string, dockJson: string) =>
    invoke<void>('set_session_dock', { sessionId, dockJson }),

  // Workspace root management (switch active folder in multi-root workspace)
  setWorkspaceRoot: (path: string) => invoke<void>('set_active_root', { path }),

  // Fuzzy file search under the active folder — backs the @-mention palette.
  searchWorkspaceFiles: (query: string, limit?: number) =>
    invoke<FileHit[]>('search_workspace_files', { query, limit }),

  /** Read one workspace file for the viewer dock. Accepts a workspace-relative
   * path (what the palette and tool output cite) or an absolute one; the
   * backend refuses anything resolving outside the workspace. `root` is the
   * folder the path was cited against — it settles which folder wins when a
   * multi-folder workspace repeats the same relative path. */
  readWorkspaceFile: (path: string, root?: string | null) =>
    invoke<FileContent>('read_workspace_file', { path, root: root ?? null }),

  /** One directory's immediate children for the Files tree. Omit `path` for the
   * root. Lists everything on disk except `.git` — unlike the fuzzy search,
   * which is scoped by `.gitignore`. */
  listWorkspaceDir: (path?: string | null, root?: string | null) =>
    invoke<DirEntry[]>('list_workspace_dir', { path: path ?? null, root: root ?? null }),

  // Native folder picker → returns the chosen path (or null if cancelled).
  pickFolder: (defaultPath?: string) =>
    open({ directory: true, multiple: false, defaultPath }) as Promise<string | null>,

  onStreamContent: (cb: (p: StreamDelta) => void) => on<StreamDelta>('stream_content', cb),
  onStreamThinking: (cb: (p: StreamDelta) => void) => on<StreamDelta>('stream_thinking', cb),
  onStreamTool: (cb: (p: StreamTool) => void) => on<StreamTool>('stream_tool', cb),
  onStreamDone: (cb: (p: StreamDone) => void) => on<StreamDone>('stream_done', cb),
  onStreamUsage: (cb: (p: StreamUsage) => void) => on<StreamUsage>('stream_usage', cb),
  onStreamError: (cb: (p: StreamError) => void) => on<StreamError>('stream_error', cb),
  onAskUser: (cb: (p: AskUser) => void) => on<AskUser>('ask_user', cb),
  onMcpStatus: (cb: (p: McpServerStatus[]) => void) => on<McpServerStatus[]>('mcp_status', cb),
  answerEditReview: (accepted: boolean, sessionId?: string) => invoke<void>('answer_edit_review', { accepted, sessionId }),
  getAgentMode: () => invoke<string>('get_agent_mode'),
  setAgentMode: (mode: string) => invoke<string>('set_agent_mode', { mode }),
  getSessionMode: (sessionId: string) => invoke<string>('get_session_mode', { sessionId }),
  setSessionMode: (sessionId: string, mode: string) =>
    invoke<string>('set_session_mode', { sessionId, mode }),
  onReviewRequest: (cb: (p: EditReviewRequest) => void) => on<EditReviewRequest>('review_request', cb),
  // decision: 'reject' | 'once' | 'always'
  answerToolConfirm: (decision: string, sessionId?: string) => invoke<void>('answer_tool_confirm', { decision, sessionId }),
  onConfirmRequest: (cb: (p: ToolConfirmRequest) => void) => on<ToolConfirmRequest>('confirm_request', cb),

  onGraphUpdated: (cb: (p: null) => void) => on<null>('graph_updated', cb),
  onNodeSummarized: (cb: (p: NodeSummarized) => void) => on<NodeSummarized>('node_summarized', cb),
  onSummarizeProgress: (cb: (p: SummarizeProgress) => void) => on<SummarizeProgress>('summarize_progress', cb),
  onSummarizeDone: (cb: (p: SummarizeProgress) => void) => on<SummarizeProgress>('summarize_done', cb),
  onSessionTitle: (cb: (p: SessionTitle) => void) => on<SessionTitle>('session_title', cb),
  onSessionCreated: (cb: (p: { session_id: string }) => void) => on<{ session_id: string }>('session_created', cb),
  onSessionSwitched: (cb: (p: { session_id: string }) => void) => on<{ session_id: string }>('session_switched', cb),

  listOpeners: () => invoke<Opener[]>('list_openers'),
  openIn: (app: string) => invoke<void>('open_in', { app }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  checkForUpdates: () => invoke<any>('check_for_updates'),
  getUpdateStatus: () => invoke<any>('get_update_status'),
  getAppVersion: () => invoke<string>('get_app_version'),
  startUpdateDownload: () => invoke<void>('start_update_download'),
  installAndRestart: () => invoke<void>('install_and_restart'),
  listBgTasks: () => invoke<BgTaskInfo[]>('list_bg_tasks'),
  stopBgTask: (pid: number) => invoke<void>('stop_bg_task', { pid }),
  clearBgTasks: () => invoke<void>('clear_bg_tasks'),
  getBgTaskLog: (pid: number) => invoke<string>('get_bg_task_log', { pid }),
  onBgTaskExited: (cb: (p: BgTaskExited) => void) => on<BgTaskExited>('bg_task_exited', cb),
  onUpdateStatus: (cb: (p: any) => void) => on<any>('update_status', cb),

  // Terminal — one pty session per dock tab, keyed by the tab's own id.
  /** Attach to the session for `id`, starting a shell if there isn't one.
   * Resolves to its scrollback (base64), which is empty for a fresh shell and
   * is the replay when a tab comes back after being switched away from.
   * `cwd` omitted means the selected workspace folder. */
  ptyOpen: (id: string, cols: number, rows: number, cwd?: string | null) =>
    invoke<string>('pty_open', { id, cols, rows, cwd: cwd ?? null }),
  ptyWrite: (id: string, data: string) => invoke<void>('pty_write', { id, data }),
  ptyResize: (id: string, cols: number, rows: number) =>
    invoke<void>('pty_resize', { id, cols, rows }),
  /** Kills the shell. Bound to closing the tab — not to unmounting, which is
   * what a tab switch does. */
  ptyClose: (id: string) => invoke<void>('pty_close', { id }),
  ptyIsAlive: (id: string) => invoke<boolean>('pty_is_alive', { id }),
  onPtyOutput: (cb: (p: PtyOutput) => void) => on<PtyOutput>('pty_output', cb),
  onPtyExit: (cb: (p: PtyExit) => void) => on<PtyExit>('pty_exit', cb),

  // Skills
  onSkillsChanged: (cb: () => void) => on<void>('skills_changed', cb),
  loadSkills: (workspaceRoot: string) => invoke<void>('load_skills', { workspaceRoot }),
  listSkills: () => invoke<SkillSummary[]>('list_skills'),
  toggleSkill: (name: string) => invoke<boolean>('toggle_skill', { name }),
  setSkillEnabled: (name: string, enabled: boolean) =>
    invoke<boolean>('set_skill_enabled', { name, enabled }),
  getSkill: (name: string) => invoke<SkillDetail>('get_skill', { name }),
};
