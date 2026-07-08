import React, { useEffect, type CSSProperties } from 'react';
import { sidebarStyles } from '@/utils/theme-styles';
import { PencilSimpleLine, Trash, ChatCircle, FolderOpen, Folder, Gear, DownloadSimple, CaretDown, CaretRight } from '@phosphor-icons/react';
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

// Left rail with workspaces → sessions, like Claude/Codex.
export default function Sidebar({ workspaceName, onPickWorkspace, switching, onOpenSettings, onOpenUpdate }: SidebarProps) {
  const {
    sessions, setSessions, setMessages, setActiveTab,
    messagesBySession, isLoading, setCurrentSession, currentSession,
    setSessionModels, update, setSettingsCategory, setShowSettings,
    workspacesWithSessions, loadWorkspacesWithSessions,
    switchWorkspace, expandedWorkspaces, toggleExpandedWorkspace,
    currentWorkspace,
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
    loadWorkspacesWithSessions();
  }, [loadWorkspacesWithSessions]);

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

  const curMsgs = currentSession ? messagesBySession[currentSession] : undefined;
  useEffect(() => { if (!isLoading) refresh(); }, [isLoading, curMsgs?.length]);

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
    loadWorkspacesWithSessions();
  };

  const switchTo = async (id: string, active: boolean) => {
    if (active) { setActiveTab('chat'); return; }
    setCurrentSession(id);
    const msgs = await ipc.switchSession(id).catch(() => null);
    if (msgs) setMessages(id, msgs);
    loadSessionModels(id);
    setActiveTab('chat');
    refresh();
    loadWorkspacesWithSessions();
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
    loadWorkspacesWithSessions();
  };

  const handleWorkspaceClick = (id: string) => {
    toggleExpandedWorkspace(id);
    // If collapsed and not current, switch to it
    if (!expandedWorkspaces.includes(id)) {
      const ws = workspacesWithSessions.find((w) => w.id === id);
      if (ws && !ws.is_current) {
        switchWorkspace(id);
      }
    }
  };

  return (
    <div style={sidebarStyles.root}>
      {/* Reserved gap so the mac traffic-light buttons sit here, top-left. */}
      <div style={sidebarStyles.trafficGap} data-tauri-drag-region />

      {/* Workspaces tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {workspacesWithSessions.map((ws) => {
          const isExpanded = expandedWorkspaces.includes(ws.id);
          const isCurrent = ws.is_current;

          return (
            <div key={ws.id} style={{ marginBottom: 2 }}>
              {/* Workspace header */}
              <div
                onClick={() => handleWorkspaceClick(ws.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  margin: '0 6px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: isCurrent ? theme.cardActive : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = theme.cardActive; }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
              >
                {isExpanded ? (
                  <CaretDown size={12} color={theme.dim} weight="fill" style={{ flexShrink: 0 }} />
                ) : (
                  <CaretRight size={12} color={theme.dim} weight="fill" style={{ flexShrink: 0 }} />
                )}
                <FolderOpen size={15} color={isCurrent ? theme.accent : theme.faint} style={{ flexShrink: 0 }} />
                <span style={{
                  flex: 1,
                  fontSize: 12.5,
                  fontWeight: isCurrent ? 600 : 450,
                  color: isCurrent ? theme.text : theme.textSoft,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {ws.name}
                </span>
                {ws.folders.length > 0 && (
                  <span style={{ fontSize: 10, color: theme.faint }}>
                    {ws.folders.length}F
                  </span>
                )}
              </div>

              {/* Sessions under this workspace */}
              {isExpanded && (
                <div style={{ marginLeft: 8 }}>
                  {ws.sessions.length === 0 && (
                    <div style={{
                      fontSize: 11.5,
                      color: theme.faint,
                      padding: '6px 14px 6px 36px',
                      fontStyle: 'italic',
                    }}>
                      No conversations yet
                    </div>
                  )}
                  {ws.sessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => {
                        if (!isCurrent) switchWorkspace(ws.id).then(() => switchTo(s.id, s.active));
                        else switchTo(s.id, s.active);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 14px 6px 36px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        background: s.active && isCurrent ? theme.cardActive : 'transparent',
                        transition: 'background 0.1s',
                        margin: '0 6px',
                      }}
                      onMouseEnter={(e) => { if (!(s.active && isCurrent)) e.currentTarget.style.background = theme.cardActive; }}
                      onMouseLeave={(e) => { if (!(s.active && isCurrent)) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <ChatCircle size={13} color={s.active && isCurrent ? theme.accent : theme.faint} style={{ flexShrink: 0 }} />
                      <span style={{
                        flex: 1,
                        fontSize: 12,
                        color: s.active && isCurrent ? theme.text : theme.textSoft,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {s.title || 'New session'}
                      </span>
                      <button
                        className="icon-btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          // For simplicity, delete using standard ipc method
                          ipc.deleteSession(s.id).then(() => {
                            refresh();
                            loadWorkspacesWithSessions();
                          });
                        }}
                        title="Delete conversation"
                        style={{ flexShrink: 0, opacity: 0.6 }}
                      >
                        <Trash size={11} color={theme.dim} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Update status indicator */}
      <UpdateStatusBar onOpenUpdate={onOpenUpdate} />

      {/* Footer: workspace settings gear. */}
      <div style={sidebarStyles.footer}>
        <button
          className="ghost-btn"
          style={sidebarStyles.gearBtn}
          onClick={() => { setSettingsCategory('workspace'); setShowSettings(true); }}
          title="Workspace settings"
        >
          <FolderOpen size={15} />
        </button>
        <button className="ghost-btn" style={sidebarStyles.gearBtn} onClick={onOpenSettings} title="All settings">
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