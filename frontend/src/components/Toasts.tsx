import React, { useEffect, useState, type CSSProperties } from 'react';
import { toastsStyles } from '@/utils/theme-styles';
import { CheckCircle, XCircle, X } from '@phosphor-icons/react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { ipc } from '@/ipc';
import { theme } from '@/theme';

const DISMISS_MS = 6000;

interface Toast {
  id: string;
  ok: boolean;
  command: string;
  code: number | null;
}

// Bottom-right toast stack. Listens for background-task completion events and
// shows a transient notification with the command + exit status.
let listenerRegistered = false;

export default function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = (id: string) => setToasts((ts) => ts.filter((t) => t.id !== id));

  useEffect(() => {
    let un: UnlistenFn | undefined;
    let seq = 0;
    if (!listenerRegistered) {
      listenerRegistered = true;
      ipc.onBgTaskExited((payload) => {
        const id = `${Date.now()}-${seq++}`;
        const ok = payload?.code === 0;
        setToasts((ts) => [
          ...ts,
          { id, ok, command: payload?.command || 'background task', code: payload?.code },
        ]);
        setTimeout(() => remove(id), DISMISS_MS);
      }).then((u) => { un = u; });
    }
    return () => { if (un) un(); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={toastsStyles.wrap}>
      {toasts.map((t) => (
        <div key={t.id} style={toastsStyles.toast}>
          {t.ok
            ? <CheckCircle size={18} weight="fill" color={theme.success} style={{ flexShrink: 0 }} />
            : <XCircle size={18} weight="fill" color={theme.error} style={{ flexShrink: 0 }} />}
          <div style={toastsStyles.body}>
            <div style={toastsStyles.title}>
              {t.ok ? 'Task finished' : `Task failed · code ${t.code}`}
            </div>
            <div style={toastsStyles.cmd}>{t.command}</div>
          </div>
          <button className="close-btn" style={toastsStyles.close} onClick={() => remove(t.id)} title="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

