import React, { useEffect, type CSSProperties } from 'react';
import { sidebarStyles } from '@/utils/theme-styles';
import { PencilSimpleLine, Trash, ChatCircle, FolderOpen, Gear, DownloadSimple } from '@phosphor-icons/react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import type { SessionInfo } from '@/types';

interface SidebarProps {
  workspaceName: string;
  onPickWorkspace: () => void;
  switching: boolean;
  onOpenSettings: () => void;
  onOpenUpdate: () => void;
}

// Left rail with the conversation list, Claude/Codex style. Full height: the
// mac traffic lights sit in the reserved gap at the top, the "New session" action
// and sessions fill the middle, and the workspace switcher + settings live in
// the footer.
export default function Sidebar({ workspaceName, onPickWorkspace, switching, onOpenSettings, onOpenUpdate }: SidebarProps) {
  const {
    sessions, setSessions, setMessages, setActiveTab,
    messagesBySession, isLoading, setCurrentSession, currentSession,
    setSessionModels, update, currentWorkspace, setSettingsCategory, setShowSettings
  } = useStore();

  const refresh = () =>
    ipc.listSessions().then((list) => {
      setSessions(list);
      return list;
    }).catch(console.error);

  const loadSessionModels = async (id: string) => {
    try {
      const models = await ipc.getSessionModels(id);
      setSessionModels(id, models);
    } catch {
      // ignore — no per-session pins is fine
    }
  };

  useEffect(() => {
    refresh().then((list) => {
      if (!list || currentSession) return;
      const active = list.find((s) => s.active);
      if (active) {
        setCurrentSession(active.id);
        loadSessionModels(active.id);
      }
    });
  }, []);
  // Re-pull after a turn finishes so new titles / counts show up.
  const curMsgs = currentSession ? messagesBySession[currentSession] : undefined;
  useEffect(() => { if (!isLoading) refresh(); }, [isLoading, curMsgs?.length]);

  // Update session title in-place when the backend generates one.
  useEffect(() => {
    let unsub: UnlistenFn | undefined;
    ipc.onSessionTitle(({ session_id, title }) => {
      setSessions((prev) => prev.map((s) => s.id === session_id ? { ...s, title } : s));
    }).then((u) => { unsub = u; });
    return () => unsub?.();
  }, []);

  const newChat = async () => {
    const id = await ipc.newSession().catch(() => null);
    if (id) {
      setCurrentSession(id);
      setMessages(id, []);
      loadSessionModels(id);
    }
    setActiveTab('chat');
    refresh();
  };

  const switchTo = async (id: string, active: boolean) => {
    if (active) { setActiveTab('chat'); return; }
    setCurrentSession(id);
    const msgs = await ipc.switchSession(id).catch(() => null);
    if (msgs) setMessages(id, msgs);
    loadSessionModels(id);
    setActiveTab('chat');
    refresh();
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const nextId = await ipc.deleteSession(id).catch(() => null);
    if (nextId) {
      const msgs = await ipc.getHistory().catch(() => []);
      setCurrentSession(nextId);
      setMessages(nextId, msgs);
    }
    refresh();
  };

  return (
    <div style={sidebarStyles.root}>
      {/* Reserved gap so the mac traffic-light buttons sit here, top-left. */}
      <div style={sidebarStyles.trafficGap} data-tauri-drag-region />

      {/* Workspace indicator — clean row matching sidebar aesthetic */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          margin: '0 6px 6px 6px',
          minWidth: 0,
        }}
      >
        <FolderOpen size={15} color={theme.accent} style={{ flexShrink: 0, opacity: 0.85 }} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 12.5, fontWeight: 550, color: theme.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.3,
          }}>
            {currentWorkspace?.name || workspaceName}
          </span>
          <span style={{ fontSize: 10.5, color: theme.dim, lineHeight: 1.2 }}>
            {currentWorkspace?.folders.length || 0} folder{(currentWorkspace?.folders.length ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => { setSettingsCategory('workspace'); setShowSettings(true); }}
          className="icon-btn-sm"
          title="Workspace settings"
          style={{ flexShrink: 0 }}
        >
          <Gear size={13} color={theme.dim} />
        </button>
      </div>

      <button className="ghost-btn" style={sidebarStyles.newBtn} onClick={newChat}>
        <PencilSimpleLine size={15} />
        New session
      </button>

      <div style={sidebarStyles.list}>
        {sessions.length === 0 && <div style={sidebarStyles.empty}>No conversations yet</div>}
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} onClick={() => switchTo(s.id, s.active)} onDelete={(e) => remove(e, s.id)} />
        ))}
      </div>

      {/* Update status indicator */}
      <UpdateStatusBar onOpenUpdate={onOpenUpdate} />

      {/* Footer: settings. */}
      <div style={sidebarStyles.footer}>
        <button className="ghost-btn" style={sidebarStyles.gearBtn} onClick={onOpenSettings} title="Settings">
          <Gear size={17} />
        </button>
      </div>
    </div>
  );
}

interface SessionRowProps {
  s: SessionInfo;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function SessionRow({ s, onClick, onDelete }: SessionRowProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...sidebarStyles.row, background: s.active ? theme.cardActive : hover ? theme.cardActive : 'transparent' }}
    >
      <ChatCircle size={15} color={s.active ? theme.accent : theme.faint} style={{ flexShrink: 0 }} />
      <span style={{ ...sidebarStyles.title, color: s.active ? theme.text : theme.textSoft }}>
        {s.title || 'New session'}
      </span>
      <button
        className="icon-btn-sm"
        style={{ opacity: hover ? 1 : 0, pointerEvents: hover ? 'auto' : 'none', marginRight: -2 }}
        onClick={onDelete}
        title="Delete conversation"
      >
        <Trash size={13} color={theme.dim} />
      </button>
    </div>
  );
}

function UpdateStatusBar({ onOpenUpdate }: { onOpenUpdate: () => void }) {
  const { update } = useStore();
  const [hover, setHover] = React.useState(false);

  // Only show in sidebar when there's something actionable
  if (update.status !== 'available' && update.status !== 'ready') {
    return null;
  }

  let icon = null;
  let label = '';
  let color = theme.textSoft;

  switch (update.status) {
    case 'available':
      icon = <DownloadSimple size={15} color={theme.accent} />;
      label = `Update available: v${update.version}`;
      color = theme.text;
      break;
    case 'ready':
      icon = <DownloadSimple size={15} color={theme.accent} />;
      label = 'Restart to update';
      color = theme.text;
      break;
    default:
      return null;
  }

  return (
    <div
      onClick={onOpenUpdate}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        margin: '0 6px 4px 6px',
        height: 34,
        borderRadius: 9,
        background: hover ? theme.cardActive : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.15s ease-in-out',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 400,
          color,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {update.status === 'available' && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: theme.accent,
            boxShadow: `0 0 6px ${theme.accent}`,
          }}
        />
      )}
    </div>
  );
}

