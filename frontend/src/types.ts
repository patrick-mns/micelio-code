// Domain types mirroring the Rust backend's serialized structs (src/commands/*.rs,
// src/backend/llm.rs). Kept in sync by hand — see each struct's source file.
// Convention: Rust u64/usize/f64/i64 → number; Option<T> without skip → `T | null`;
// Option<T> with skip_serializing_if → optional `field?`.

// ── Chat (src/commands/chat.rs, src/backend/llm.rs) ──────────────────────────
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  prompt_cost?: number;
  completion_cost?: number;
  raw?: string;
}

export interface ChatMessage {
  role: string;
  content: string;
  duration?: number;
  usage?: Usage;
}

export interface TurnResult {
  thinking: string;
  tools: string[];
  content: string;
}

export interface CompactResult {
  freed: number;
  before: number;
  after: number;
}

export interface ContextSegment {
  label: string;
  tokens: number;
}

export interface ContextWindow {
  used: number;
  total: number;
  segments: ContextSegment[];
}

export interface SystemPromptInfo {
  text: string;
  is_custom: boolean;
  default_text: string;
  /** Active skills section appended at send time (read-only in the inspector) */
  skills_text: string;
}

export interface TranscriptItem {
  role: string;
  content: string;
  tool_calls_json: string | null;
  tool_name: string | null;
  tokens: number;
}

export interface Transcript {
  model: string;
  used: number;
  total: number;
  items: TranscriptItem[];
}

// ── Sessions & usage (src/commands/sessions.rs) ──────────────────────────────
export interface ModelStat {
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  turns: number;
}

export interface UsageStats {
  total_cost: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_turns: number;
  by_model: ModelStat[];
}

export interface UsageLogEntry {
  id: number;
  ts: number;
  session_id: string;
  session_title: string;
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  duration_ms: number;
  prompt_cost: number | null;
  completion_cost: number | null;
}

// Heavy request/response payloads, loaded lazily per ledger row (get_usage_raw).
export interface UsageRaw {
  request: string;
  response: string;
  request_raw: string;
  response_raw: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  message_count: number;
  active: boolean;
}

/** Per-session model pins — empty string means "use global default". */
export interface SessionModels {
  chat: string;
  summarize: string;
  vision: string;
}

// ── Settings & models (src/commands/settings.rs) ─────────────────────────────
export interface Settings {
  model: string;
  summarize_model: string;
  workspace: string;
  provider: string;
  auto_summarize: boolean;
  show_cost: boolean;
}

export interface ModelOption {
  name: string;
  display: string;
  provider: string;
  vision: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
}

// ── MCP (Model Context Protocol) ────────────────────────────────────────
export interface McpServerStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  transport: string; // "stdio" | "http"
  error: string | null; // short, human-readable
  errorDetail: string | null; // full raw error (shown on hover)
}

export interface McpToolInfo {
  server: string;
  name: string;
  namespaced: string;
  description: string;
  readOnly: boolean;
}

export interface McpServerConfig {
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  enabled?: boolean;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface ModelRole {
  role: string; // "chat" | "summarize" | "vision"
  model: string;
  provider: string;
}

export interface GitContext {
  branch: string;
  added: number;
  modified: number;
  deleted: number;
}

export interface OpenRouterStatus {
  ok: boolean;
  count: number;
  error: string;
}

// ── Graph (src/commands/graph.rs) ────────────────────────────────────────────
export interface TreemapNode {
  id: number;
  name: string;
  kind: string;
  value: number;
  tokens: number;
  active: boolean;
  summary: string;
  path: string | null;
  children: TreemapNode[];
}

export interface NodeCode {
  code: string;
  language: string;
  start_line: number;
  path: string | null;
  truncated: boolean;
  summary_stale: boolean;
}

// ── Background tasks & openers (src/commands/bg.rs, openers.rs) ───────────────
export interface BgTaskInfo {
  pid: number;
  command: string;
  status: string;
  uptime_secs: number;
}

export interface Opener {
  id: string;
  name: string;
  kind: string; // "editor" | "terminal" | "finder"
}

// ── Agent status shown in the sidebar dot ────────────────────────────────────
export type AgentStatus = 'idle' | 'running' | 'awaiting_input' | 'error' | 'complete';

// ── Event payloads (src/commands/agent.rs, graph.rs emit calls) ──────────────
export interface StreamDelta {
  session_id: string;
  delta: string;
}

export interface StreamTool {
  session_id: string;
  summary: string;
}

export interface StreamDone {
  session_id: string;
}

export interface StreamError {
  session_id: string;
  error: string;
}

export interface StreamUsage {
  session_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
}

export interface AskUser {
  session_id: string;
  args: string;
}

// Emitted when review mode pauses a file write/edit for user approval (see
// commands::agent::execute_tool_call). Answered via `answerEditReview`.
export interface EditReviewRequest {
  session_id: string;
  path: string;
  original_content: string;
  proposed_content: string;
}

// Emitted when review mode pauses a side-effecting non-file tool (terminal,
// bg-stop, context_node) for user confirmation (see
// commands::agent::execute_tool_call). Answered via `answerToolConfirm`.
export interface ToolConfirmRequest {
  session_id: string;
  tool: string;
  title: string;
  detail: string;
}

export interface SessionTitle {
  session_id: string;
  title: string;
}

export interface SummarizeProgress {
  done: number;
  total: number;
  failed: number;
}

// node_summarized is emitted as a tuple: [nodeId, summary].
export type NodeSummarized = [number, string];

export interface BgTaskExited {
  pid: number;
  command: string;
  code: number | null;
}

// ── Skills ───────────────────────────────────────────────────────────────────
export interface SkillSummary {
  name: string;
  display_name: string;
  description: string;
  enabled: boolean;
  icon_path?: string | null;
  /** Origin directory: "micelio" | "claude" | "agents" | "github" (.<source>/skills) */
  source: string;
}

export interface SkillDetail {
  meta: {
    name: string;
    description: string;
    display_name: string;
    license: string;
    default_enabled: boolean;
    metadata: Record<string, string>;
  };
  body: string;
  path: string;
  enabled: boolean;
  source: string;
}
