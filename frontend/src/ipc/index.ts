import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  AskUser, BgTaskExited, BgTaskInfo, ChatMessage, CompactResult, ContextWindow,
  GitContext, ModelOption, ModelRole, NodeCode, NodeSummarized, Opener,
  OpenRouterStatus, SessionInfo, SessionModels, SessionTitle, Settings, StreamDelta, StreamDone,
  StreamError, StreamTool, StreamUsage, SummarizeProgress, SystemPromptInfo,
  ToolInfo, Transcript, TreemapNode, UsageLogEntry, UsageRaw, UsageStats,
} from '@/types';

// Typed listener helper: `listen` hands the callback the full event; every
// consumer here only wants the payload, so unwrap it and return the unlisten fn.
const on = <T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> =>
  listen<T>(event, (e) => cb(e.payload));

export const ipc = {
  sendMessage: (content: string) => invoke<ChatMessage>('send_message', { content }),
  startChatStream: (content: string) => invoke<string>('start_chat_stream', { content }),
  listTools: () => invoke<ToolInfo[]>('list_tools'),
  stopChatStream: () => invoke<void>('stop_chat_stream'),
  answerQuestion: (answer: string) => invoke<void>('answer_question', { answer }),
  getHistory: () => invoke<ChatMessage[]>('get_history'),
  clearHistory: () => invoke<void>('clear_history'),
  getContextWindow: () => invoke<ContextWindow>('get_context_window'),
  getTranscript: () => invoke<Transcript>('get_transcript'),
  getSystemPrompt: () => invoke<SystemPromptInfo>('get_system_prompt'),
  setSystemPrompt: (text: string) => invoke<boolean>('set_system_prompt', { text }),
  resetSystemPrompt: () => invoke<string>('reset_system_prompt'),
  saveAttachment: (dataBase64: string, ext: string) => invoke<string>('save_attachment', { dataBase64, ext }),
  compactChat: () => invoke<CompactResult>('compact_chat'),

  getGraph: () => invoke<TreemapNode[]>('get_graph'),
  scanWorkspace: () => invoke<void>('scan_workspace'),
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
  setWorkspace: (path: string) => invoke<void>('set_workspace', { path }),
  listModels: () => invoke<ModelOption[]>('list_models'),
  getOpenrouterKey: () => invoke<string>('get_openrouter_key'),
  saveOpenrouterKey: (key: string) => invoke<void>('save_openrouter_key', { key }),
  checkOpenrouterKey: (key: string) => invoke<OpenRouterStatus>('check_openrouter_key', { key }),
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

  onGraphUpdated: (cb: (p: null) => void) => on<null>('graph_updated', cb),
  onNodeSummarized: (cb: (p: NodeSummarized) => void) => on<NodeSummarized>('node_summarized', cb),
  onSummarizeProgress: (cb: (p: SummarizeProgress) => void) => on<SummarizeProgress>('summarize_progress', cb),
  onSummarizeDone: (cb: (p: SummarizeProgress) => void) => on<SummarizeProgress>('summarize_done', cb),
  onSessionTitle: (cb: (p: SessionTitle) => void) => on<SessionTitle>('session_title', cb),

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
};
