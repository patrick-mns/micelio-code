import type { ChatMessage } from '@/types';

// ── Frontend message view types ───────────────────────────────────────────────
// A user message can carry an image attachment (client-only, not persisted by
// the backend's ChatMessage), so the rendered view extends the domain type.
export interface Attachment {
  name: string;
  preview?: string;
  // Set once the image is saved to disk; referenced in the prompt to the model.
  path?: string;
}

export interface ChatMessageView extends ChatMessage {
  attachment?: Attachment;
}

// The note Chat.send appends to the prompt when an image is attached. The
// backend persists it verbatim, so on history reload we strip it from the shown
// text and rebuild a lightweight attachment tag from the saved path. (The
// data-URL preview is client-only and not recoverable from history, so a
// reloaded message shows the filename tag without the thumbnail.)
const ATTACH_NOTE = /\n*\[The user attached an image at (.+?)\. Use the vision tool with this path to view it before answering\.\]\s*$/;

export function hydrateAttachments(messages: ChatMessageView[]): ChatMessageView[] {
  return messages.map((m) => {
    if (m.role !== 'user' || m.attachment) return m;
    const match = m.content.match(ATTACH_NOTE);
    if (!match) return m;
    const path = match[1];
    return {
      ...m,
      content: m.content.replace(ATTACH_NOTE, ''),
      attachment: { name: path.split('/').pop() || 'image', path },
    };
  });
}

// One row produced by Chat's render pass — a discriminated union the list walks.
export type RenderedItem =
  | { type: 'tools'; tools: string[]; key: string }
  | { type: 'thinking'; msg: ChatMessageView; key: string }
  | { type: 'canceled'; key: string }
  | { type: 'msg'; msg: ChatMessageView; key: string };

// ── Formatting helpers ────────────────────────────────────────────────────────
export { fmtUsd, fmtTok, fmtDuration, fmtElapsed } from '@/utils/formatters';

// ── Slash commands ────────────────────────────────────────────────────────────
// The actions a slash command can trigger — supplied by Chat at run time.
export interface CommandContext {
  clear: () => void;
  tools: () => void | Promise<void>;
  workspace: () => void | Promise<void>;
  scan: () => void | Promise<void>;
  summarize: (concurrency?: number) => void | Promise<void>;
}

export interface SlashCommand {
  cmd: string;
  desc: string;
  run: (ctx: CommandContext) => void | Promise<void>;
}

export const COMMANDS: SlashCommand[] = [
  { cmd: '/tools', desc: 'List the tools the agent can use', run: (ctx) => ctx.tools() },
  { cmd: '/clear', desc: 'Clear the conversation', run: (ctx) => ctx.clear() },
  { cmd: '/workspace', desc: 'Switch workspace folder', run: (ctx) => ctx.workspace() },
  { cmd: '/scan', desc: 'Rescan workspace into the graph', run: (ctx) => ctx.scan() },
  { cmd: '/summarize', desc: 'Summarize stale & unsummarized nodes (e.g. /summarize 8)', run: (ctx) => ctx.summarize() },
];

export const COL_W = 760;
