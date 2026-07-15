import React, { useEffect, useState, type CSSProperties } from 'react';
import { bgTasksChipStyles } from '@/utils/theme-styles';
import { Stack, Stop, X, CaretRight } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { theme } from '@/theme';
import type { BgTaskInfo } from '@/types';

interface BgTasksChipProps {
  running: number;
  active: boolean;
  onClick: () => void;
}

// Header button — always visible — that toggles the background-tasks panel.
export default function BgTasksChip({ running, active, onClick }: BgTasksChipProps) {
  return (
    <button
      className="btn btn-ghost"
      style={{ ...bgTasksChipStyles.chip, color: active || running > 0 ? theme.text : theme.dim }}
      title={running > 0 ? `${running} background task${running === 1 ? '' : 's'} running` : 'Background tasks'}
      onClick={onClick}
    >
      <Stack size={16} />
      {running > 0 && (
        <span style={bgTasksChipStyles.badge}>
          <span className="bg-bars" aria-hidden="true"><i /><i /><i /></span>
          {running}
        </span>
      )}
    </button>
  );
}

// Inline log viewer for one task. Fetches the full log on open and, while the
// task is still running, polls it every 1.5s so the output stays live.
interface TaskLogProps {
  pid: number;
  running: boolean;
}

function TaskLog({ pid, running }: TaskLogProps) {
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const pull = () => ipc.getBgTaskLog(pid)
      .then((text) => { if (alive) { setLog(text); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    pull();
    const timer = running ? setInterval(pull, 1500) : null;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [pid, running]);

  return (
    <pre className="raw-pre" style={bgTasksChipStyles.log}>
      {loading ? 'Loading…' : (log || '(no output yet)')}
    </pre>
  );
}

// One task row with an expandable log section.
interface TaskCardProps {
  t: BgTaskInfo;
  running: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStop: (pid: number) => void;
}

function TaskCard({ t, running, expanded, onToggle, onStop }: TaskCardProps) {
  const fmtUptime = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
  const exitLabel = (status: string) => {
    const code = status.split(':')[1];
    return code === '0' ? 'completed' : `exited · code ${code}`;
  };
  const folder = t.workspace_path.split('/').pop() || t.workspace_path.split('\\').pop() || '';
  return (
    <div style={{ ...bgTasksChipStyles.card, opacity: running ? 1 : 0.8 }}>
      <div style={bgTasksChipStyles.cardTop}>
        <button className="icon-btn-sm" style={{ width: 18, height: 18, marginLeft: -2 }} onClick={onToggle} title={expanded ? 'Hide logs' : 'Show logs'}>
          <CaretRight
            size={12} weight="bold"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: theme.dim }}
          />
        </button>
        <span style={{ ...bgTasksChipStyles.dot, background: running ? theme.success : theme.faint }} />
        <span style={{ ...bgTasksChipStyles.cmd, color: running ? theme.text : theme.textSoft }}>{t.command}</span>
        {running && (
          <button className="icon-btn-sm" onClick={() => onStop(t.pid)} title="Stop">
            <Stop size={14} color={theme.error} />
          </button>
        )}
      </div>
      <div style={bgTasksChipStyles.meta}>
        {running ? `pid ${t.pid} · ${fmtUptime(t.uptime_secs)}` : exitLabel(t.status)}
        {folder && (
          <>
            {' · '}
            <span title={t.workspace_path}>{folder}</span>
          </>
        )}
      </div>
      {expanded && <TaskLog pid={t.pid} running={running} />}
    </div>
  );
}

// Right-side panel, laid out as a flex sibling (pushes content, like the
// sidebar) — not an overlay. Drag the left edge to resize.
interface BgTasksPanelProps {
  tasks: BgTaskInfo[];
  onClose: () => void;
  onStop: (pid: number) => void;
  onClear: () => void;
}

export function BgTasksPanel({ tasks, onClose, onStop, onClear }: BgTasksPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null); // pid whose log is open

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const running = tasks.filter((t) => t.status === 'running');
  const finished = tasks.filter((t) => t.status !== 'running');
  const toggle = (pid: number) => setExpanded((cur) => (cur === pid ? null : pid));

  return (
    <div style={bgTasksChipStyles.panel}>
      <div style={bgTasksChipStyles.head}>
        <span style={bgTasksChipStyles.headTitle}>Background tasks</span>
        <button className="close-btn" onClick={onClose} title="Close"><X size={15} /></button>
      </div>

      <div style={bgTasksChipStyles.body}>
        {running.length === 0 && finished.length === 0 && (
          <div style={bgTasksChipStyles.empty}>No background tasks</div>
        )}

        {running.length > 0 && (
          <>
            <div style={bgTasksChipStyles.section}>Running</div>
            {running.map((t) => (
              <TaskCard
                key={t.pid} t={t} running expanded={expanded === t.pid}
                onToggle={() => toggle(t.pid)} onStop={onStop}
              />
            ))}
          </>
        )}

        {finished.length > 0 && (
          <>
            <div style={bgTasksChipStyles.sectionRow}>
              <span style={bgTasksChipStyles.section}>Finished</span>
              <button className="btn btn-sm btn-ghost" onClick={onClear}>Clear</button>
            </div>
            {finished.map((t) => (
              <TaskCard
                key={t.pid} t={t} running={false} expanded={expanded === t.pid}
                onToggle={() => toggle(t.pid)} onStop={onStop}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

