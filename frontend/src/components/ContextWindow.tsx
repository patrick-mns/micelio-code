import React, { useEffect, useRef, useState } from 'react';
import { CodeSimple } from '@phosphor-icons/react';
import { fmtTokens } from '@/utils/formatters';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import type { ContextWindow as ContextWindowInfo } from '@/types';
import { contextWindowStyles as styles } from '@/utils/theme-styles';

interface Flash {
  ok: boolean;
  text: string;
}

// Stable colors per segment label, so the bar + legend stay consistent.
const SEG_COLORS: Record<string, string> = {
  Messages: theme.accent,
  Tools: '#5f9fc9',
  'System prompt': '#c97fc9',
  'Free space': theme.border,
};

function segColor(label: string): string {
  return SEG_COLORS[label] ?? theme.dim;
}

// Small status-bar indicator that shows context-window usage, with a popover
// breakdown of what's consuming the budget (messages, tools, system prompt).
export default function ContextWindow() {
  const { messagesBySession, currentSession, sessions, isLoading, chatModel, summarizeModel, setTranscriptOpen } = useStore();
  const sessionId = currentSession ?? sessions.find((s) => s.active)?.id ?? '';
  const messages = messagesBySession[sessionId] ?? [];
  // Model that performs the compaction (the "Summarize" model), provider prefix
  // stripped for a tidy label.
  const aiName = (summarizeModel || '').split('/').pop() || 'AI';
  const [info, setInfo] = useState<ContextWindowInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null); // feedback after compacting
  const ref = useRef<HTMLDivElement | null>(null);

  // Refresh when the conversation changes, the model switches, or a turn ends.
  useEffect(() => {
    ipc.getContextWindow().then(setInfo).catch(console.error);
  }, [messages.length, isLoading, chatModel]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Compact the conversation: summarize older turns into one note to free
  // context tokens. Single backend call, so the button runs an indeterminate
  // animation while it works, then refreshes the usage bar. We hold the running
  // state for at least one full orbit cycle so a fast compaction still shows
  // the animation instead of flickering.
  const MIN_ANIM_MS = 2000; // one cmp-orbit cycle
  const handleCompact = async () => {
    if (compacting) return;
    setCompacting(true);
    setFlash(null);
    const startedAt = Date.now();
    let result: Flash | null = null;
    try {
      const res = await ipc.compactChat(); // { freed, before, after }
      const next = await ipc.getContextWindow().catch(() => null);
      if (next) setInfo(next);
      const freed = res?.freed || 0;
      result = { ok: true, text: freed > 0 ? `Freed ${fmtTokens(freed)} tokens` : 'Already compact' };
    } catch (e) {
      result = { ok: false, text: String(e) };
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_ANIM_MS) {
        await new Promise((r) => setTimeout(r, MIN_ANIM_MS - elapsed));
      }
      setCompacting(false);
      setFlash(result);
      setTimeout(() => setFlash(null), 4000);
    }
  };

  if (!info || !info.total) return null;

  const pct = Math.round((info.used / info.total) * 100);
  const used = info.segments.filter((s) => s.label !== 'Free space');

  // Circular progress ring: a track circle + an arc whose length tracks pct.
  // Color warns as the window fills: green → amber (>70%) → red (>90%).
  const R = 6.5;
  const C = 2 * Math.PI * R;
  const arc = (Math.min(pct, 100) / 100) * C;
  const ringColor = pct >= 90 ? theme.error : pct >= 70 ? theme.warn : theme.accent;

  return (
    <div ref={ref} style={styles.root}>
      <button className="ctx-trigger" style={styles.trigger} onClick={() => setOpen((o) => !o)} title="Context window usage">
        <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
          <circle cx="8" cy="8" r={R} fill="none" stroke={theme.border} strokeWidth="2.5" />
          <circle
            cx="8" cy="8" r={R} fill="none"
            stroke={ringColor} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={`${arc} ${C}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
        <span style={styles.pct}>{pct}%</span>
      </button>

      {open && (
        <div style={styles.popover}>
          <div style={styles.popHead}>
            <span style={styles.popTitle}>Context window</span>
            <span style={styles.popTotal}>
              {fmtTokens(info.used)} / {fmtTokens(info.total)} ({pct}%)
            </span>
          </div>

          {/* Stacked usage bar. */}
          <div style={styles.stackBar}>
            {info.segments.map((s, i) => {
              const w = (s.tokens / info.total) * 100;
              if (w <= 0) return null;
              return (
                <span
                  key={i}
                  style={{ width: `${w}%`, background: segColor(s.label), height: '100%' }}
                />
              );
            })}
          </div>

          {/* Legend rows for the consuming categories. */}
          <div style={styles.legend}>
            {used.map((s, i) => (
              <div key={i} style={styles.legendRow}>
                <span style={{ ...styles.dot, background: segColor(s.label) }} />
                <span style={styles.legendLabel}>{s.label}</span>
                <span style={styles.legendTokens}>{fmtTokens(s.tokens)}</span>
                <span style={styles.legendPct}>
                  {((s.tokens / info.total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
            <div style={styles.legendRow}>
              <span style={{ ...styles.dot, background: theme.border }} />
              <span style={{ ...styles.legendLabel, color: theme.dim }}>Free space</span>
              <span style={styles.legendTokens}>
                {fmtTokens(info.total - info.used)}
              </span>
              <span style={styles.legendPct}>
                {(((info.total - info.used) / info.total) * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Compact button — four rounded squares (in the same colors as the
              context segments). At rest they sit in a tidy 2×2; while running
              they glide around and cycle colors, like the treemap re-packing. */}
          <button
            className={compacting ? 'cmp-btn cmp-btn--running' : 'cmp-btn'}
            style={styles.summarizeBtn}
            onClick={handleCompact}
            disabled={compacting}
            title="Summarize older messages to free context space"
          >
            <span className="cmp-squares" aria-hidden="true">
              <span className="cmp-sq" />
              <span className="cmp-sq" />
              <span className="cmp-sq" />
              <span className="cmp-sq" />
            </span>
            <span style={styles.cmpText}>
              <span>{compacting ? 'Compacting…' : 'Compact conversation'}</span>
              <span style={styles.cmpBy}>by {aiName}</span>
            </span>
          </button>
          {flash && (
            <div style={{ ...styles.flash, color: flash.ok ? theme.success : theme.error }}>
              {flash.text}
            </div>
          )}

          {/* Inspect the literal context the model receives, inline in chat. */}
          <button
            className="btn btn-md btn-outline"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => { setTranscriptOpen(true); setOpen(false); }}
            title="View the exact compacted context sent to the model"
          >
            <CodeSimple size={15} />
            <span>View transcript</span>
          </button>
        </div>
      )}
    </div>
  );
}
