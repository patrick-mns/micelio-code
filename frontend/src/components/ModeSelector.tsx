import React, { useEffect, useRef, useState } from 'react';
import { ChatCircle, Lightning, ShieldCheck, Check, CaretUpDown, type Icon } from '@phosphor-icons/react';
import { modeSelectorStyles as styles } from '@/utils/theme-styles';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import type { AgentMode } from '@/store/uiSlice';

const isAgentMode = (v: unknown): v is AgentMode =>
  v === 'chat' || v === 'auto' || v === 'review';

interface ModeMeta {
  label: string;
  desc: string;
  Icon: Icon;
  color: string;
}

// The three agent modes surfaced in the composer. Kept in sync with the
// backend `AgentMode` enum (chat / auto / review).
const MODE_META: Record<AgentMode, ModeMeta> = {
  chat:   { label: 'Chat',   desc: 'Conversation only — no file or workspace changes.', Icon: ChatCircle,  color: '#3b82f6' },
  auto:   { label: 'Auto',   desc: 'Runs tools immediately, no approval prompts.',      Icon: Lightning,   color: '#eab308' },
  review: { label: 'Review', desc: 'Pauses file edits so you approve each diff.',        Icon: ShieldCheck, color: '#14b8a6' },
};

const ORDER: AgentMode[] = ['chat', 'auto', 'review'];

// Composer entry point that lets the user pick how the agent handles a turn.
// The mode is per-session (each chat remembers its own); new chats inherit the
// global default. Sits to the left of the other composer actions.
export default function ModeSelector() {
  const {
    agentMode, setAgentMode,
    currentSession, sessionModes, setSessionModeLocal,
    isLoading,
  } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Load the effective mode for the current session (pinned or global default).
  useEffect(() => {
    if (!currentSession || sessionModes[currentSession]) return;
    ipc.getSessionMode(currentSession)
      .then((m) => { if (isAgentMode(m)) setSessionModeLocal(currentSession, m); })
      .catch(console.error);
  }, [currentSession, sessionModes, setSessionModeLocal]);

  // Effective mode shown: the session's pin, else the global default.
  const mode: AgentMode = (currentSession && sessionModes[currentSession]) || agentMode;

  const pick = (next: AgentMode) => {
    setOpen(false);
    if (currentSession) {
      setSessionModeLocal(currentSession, next);
      ipc.setSessionMode(currentSession, next).catch(console.error);
    }
    // Keep the global default in sync so newly created chats inherit this choice.
    setAgentMode(next);
  };

  const current = MODE_META[mode];
  const CurrentIcon = current.Icon;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost"
        style={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        disabled={isLoading}
        title={isLoading ? 'Wait for the current turn to finish' : 'Agent mode'}
      >
        <CurrentIcon size={15} color={current.color} weight="fill" />
        <span style={styles.triggerLabel}>{current.label}</span>
        <CaretUpDown size={12} color={theme.dim} />
      </button>

      {open && (
        <div style={styles.panel}>
          {ORDER.map((m) => {
            const meta = MODE_META[m];
            const Icon = meta.Icon;
            const active = m === mode;
            return (
              <button
                key={m}
                className={active ? 'role-item is-active' : 'role-item'}
                style={styles.item}
                onClick={() => pick(m)}
              >
                <Icon size={16} color={meta.color} weight="fill" style={styles.itemIcon} />
                <span style={styles.itemBody}>
                  <span style={styles.itemLabelRow}>
                    <span style={styles.itemLabel}>{meta.label}</span>
                    {active && <Check size={13} color={theme.accent} />}
                  </span>
                  <span style={styles.itemDesc}>{meta.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
