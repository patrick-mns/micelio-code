import React, { useEffect, useState, type CSSProperties } from 'react';
import { transcriptStyles } from '@/utils/theme-styles';
import { fmtTok } from '@/utils/formatters';
import { X, CaretRight } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import type { Transcript, TranscriptItem } from '@/types';
import JsonBlock from './JsonBlock';

// Role → label + accent. These are the actual roles the model sees, so the
// system prompt and tool definitions show as first-class entries.
const ROLE: Record<string, { label: string; color: string }> = {
  system: { label: 'System prompt', color: '#c97fc9' },
  tools: { label: 'Tools', color: '#5f9fc9' },
  user: { label: 'User', color: theme.accent },
  assistant: { label: 'Assistant', color: theme.text },
  tool: { label: 'Tool result', color: theme.warn },
};

function looksJson(s: string): boolean {
  const t = s.trim();
  return t.startsWith('{') || t.startsWith('[');
}

interface ItemProps {
  item: TranscriptItem;
  defaultOpen: boolean;
}

// One context entry. Large / structural entries (system, tools) start collapsed
// so the transcript opens to a scannable outline rather than a wall of text.
function Item({ item, defaultOpen }: ItemProps) {
  const meta = ROLE[item.role] || { label: item.role, color: theme.dim };
  const [open, setOpen] = useState(defaultOpen);
  const json = looksJson(item.content);
  return (
    <div style={transcriptStyles.item}>
      <button className="tr-head" style={transcriptStyles.head} onClick={() => setOpen((o) => !o)}>
        <CaretRight size={11} weight="bold" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0, color: theme.dim }} />
        <span style={{ ...transcriptStyles.role, color: meta.color }}>{meta.label}</span>
        {item.tool_name && <span style={transcriptStyles.toolName}>{item.tool_name}</span>}
        <span style={transcriptStyles.tok}>{fmtTok(item.tokens)} tok</span>
      </button>
      {open && (
        <>
          {item.content && (
            json
              ? <JsonBlock content={item.content} className="tr-pre" />
              : <pre className="tr-pre" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.content}</pre>
          )}
          {item.tool_calls_json && (
            <JsonBlock content={item.tool_calls_json} className="tr-pre" />
          )}
        </>
      )}
    </div>
  );
}

// In-chat transcript mode: the literal compacted context window the model
// receives this session — system prompt, tool defs, and message history.
export default function TranscriptView() {
  const setTranscriptOpen = useStore((s) => s.setTranscriptOpen);
  const currentSession = useStore((s) => s.currentSession);
  const isLoading = useStore((s) => s.isLoading);
  const messages = useStore((s) => (s.currentSession ? s.messagesBySession[s.currentSession] : undefined));
  const [data, setData] = useState<Transcript | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = () => setTranscriptOpen(false);

  // Re-assemble whenever the active session changes, a turn ends, or the
  // history is edited (e.g. cleared/compacted) — the transcript must mirror
  // exactly what the model would receive right now.
  useEffect(() => {
    setData(null);
    setErr(null);
    ipc.getTranscript().then(setData).catch((e) => setErr(String(e)));
  }, [currentSession, isLoading, messages?.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const model = (data?.model || '').split('/').pop();
  const pct = data && data.total ? Math.round((data.used / data.total) * 100) : 0;

  return (
    <div style={transcriptStyles.root}>
      <div style={transcriptStyles.bar}>
        <div style={transcriptStyles.barLeft}>
          <span style={transcriptStyles.title}>Transcript</span>
          {model && <span style={transcriptStyles.sub}>what {model} receives</span>}
        </div>
        <div style={transcriptStyles.barRight}>
          {data && (
            <span style={transcriptStyles.usage}>{fmtTok(data.used)} / {fmtTok(data.total)} · {pct}%</span>
          )}
          <button className="close-btn" style={transcriptStyles.close} onClick={close} title="Exit transcript (Esc)">
            <X size={15} />
          </button>
        </div>
      </div>

      <div style={transcriptStyles.scroll}>
        <div style={transcriptStyles.col}>
          {err && <div style={transcriptStyles.err}>{err}</div>}
          {!data && !err && <div style={transcriptStyles.loading}>Assembling context…</div>}
          {data?.items.map((item, i) => (
            <Item key={i} item={item} defaultOpen={item.role !== 'system' && item.role !== 'tools'} />
          ))}
        </div>
      </div>
    </div>
  );
}

const COL_W = 720;
