// Auto-generated TypeScript bindings from Rust commands
// Run `cargo run --bin generate_bindings` to regenerate

import { invoke } from '@tauri-apps/api/core';

// Type-safe invoke wrapper - same as your current ipc.ts but with auto-generated
// command names to prevent typos and ensure Rust/TS stay in sync
export const commands = {
  // Chat commands
  sendMessage: (args: { content: string }) => invoke<any>('send_message', args),
  startChatStream: (args: { content: string }) => invoke<string>('start_chat_stream', args),
  stopChatStream: () => invoke<void>('stop_chat_stream'),
  answerQuestion: (args: { answer: string }) => invoke<void>('answer_question', args),
  getHistory: () => invoke<any[]>('get_history'),
  clearHistory: () => invoke<void>('clear_history'),
  getContextWindow: () => invoke<any>('get_context_window'),
  getTranscript: () => invoke<any>('get_transcript'),
  getSystemPrompt: () => invoke<any>('get_system_prompt'),
  setSystemPrompt: (args: { text: string }) => invoke<boolean>('set_system_prompt', args),
  resetSystemPrompt: () => invoke<string>('reset_system_prompt'),
  saveAttachment: (args: { dataBase64: string; ext: string }) => invoke<string>('save_attachment', args),
  compactChat: () => invoke<any>('compact_chat'),

  // Graph commands
  getGraph: () => invoke<any[]>('get_graph'),
  scanWorkspace: () => invoke<void>('scan_workspace'),
  cancelWorkspaceScan: () => invoke<void>('cancel_workspace_scan'),
  summarizeNode: (args: { nodeId: number }) => invoke<string>('summarize_node', args),
  summarizeAll: (args: { concurrency?: number }) => invoke<void>('summarize_all', args),
  stopSummarize: () => invoke<void>('stop_summarize'),
  getNodeCode: (args: { nodeId: number }) => invoke<any>('get_node_code', args),

  // Settings commands
  getSettings: () => invoke<any>('get_settings'),
  setModel: (args: { model: string }) => invoke<void>('set_model', args),
  setSummarizeModel: (args: { model: string }) => invoke<void>('set_summarize_model', args),
  getModelRoles: () => invoke<any[]>('get_model_roles'),
  setModelRole: (args: { role: string; model: string }) => invoke<void>('set_model_role', args),
  setWorkspace: (args: { path: string }) => invoke<void>('set_workspace', args),
  listModels: () => invoke<any[]>('list_models'),
  listTools: () => invoke<any[]>('list_tools'),
  getOpenrouterKey: () => invoke<string>('get_openrouter_key'),
  saveOpenrouterKey: (args: { key: string }) => invoke<void>('save_openrouter_key', args),
  checkOpenrouterKey: (args: { key: string }) => invoke<any>('check_openrouter_key', args),
  getGitContext: () => invoke<any>('get_git_context'),
  getVersion: () => invoke<string>('get_version'),
  setAutoSummarize: (args: { on: boolean }) => invoke<void>('set_auto_summarize', args),
  setShowCost: (args: { on: boolean }) => invoke<void>('set_show_cost', args),

  // Sessions commands
  listSessions: () => invoke<any[]>('list_sessions'),
  newSession: () => invoke<string>('new_session'),
  switchSession: (args: { id: string }) => invoke<any[]>('switch_session', args),
  deleteSession: (args: { id: string }) => invoke<void>('delete_session', args),
  getUsageStats: (args: { from: number | null; to: number | null }) => invoke<any>('get_usage_stats', args),
  clearUsage: () => invoke<void>('clear_usage'),
  getUsageLog: (args: { from: number | null; to: number | null }) => invoke<any[]>('get_usage_log', args),

  // Background tasks
  listBgTasks: () => invoke<any[]>('list_bg_tasks'),
  stopBgTask: (args: { id: string }) => invoke<void>('stop_bg_task', args),
  clearBgTasks: () => invoke<void>('clear_bg_tasks'),
  getBgTaskLog: () => invoke<any[]>('get_bg_task_log'),

  // Openers
  listOpeners: () => invoke<any[]>('list_openers'),
  openIn: (args: { path: string; app: string }) => invoke<void>('open_in', args),
} as const;
