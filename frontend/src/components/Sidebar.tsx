import React, { useEffect, type CSSProperties } from 'react';
import { sidebarStyles } from '@/utils/theme-styles';
import {
  PencilSimpleLine, Trash, ChatCircle, FolderOpen,
  Gear, DownloadSimple, CaretDown, CaretRight, Plus,
} from '@phosphor-icons/react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { ipc } from '@/ipc';
import { useStore, type SessionBrief } from '@/store';
import { theme } from '@/theme';
import type { SessionInfo } from '@/types';

interface SidebarProps {
  workspaceName: string;
  onPickWorkspace: () => void;
  switching: boolean;
  onOpenSettings: () => void;
  onOpenUpdate: () => void;
}

export default function Sidebar({
  workspaceName, onPickWorkspace, switching,
  onOpenSettings, onOpenUpdate,
}: SidebarProps) {
  const {
    sessions, setSessions, setMessages, setActiveTab,
    messagesBySession, isLoading, setCurrentSession, currentSession,
    setSessionModels, update,
    setSettingsCategory, setShowSettings,
    workspacesWithSessions, loadWorkspacesWithSessions,
    switchWorkspace, expandedWorkspaces, toggleExpandedWorkspace,
    currentWorkspace,
  } = useStore();

  const refresh = (): Promise<SessionInfo[]> =>
    ipc.listSessions().then((list) => { setSessions(list); return list; }).catch(() => []);

  const loadSessionModels = async (id: string) => {
    try { setSessionModels(id, await ipc.getSessionModels(id)); } catch {}
  };

  useEffect(() => { loadWorkspacesWithSessions(); }, [loadWorkspacesWithSessions]);

  useEffect(() => {
    refresh();
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

  const newSession = async () => {
    const id = await ipc.newSession().catch(() => null);
    if (id) { setCurrentSession(id); setMessages(id, []); loadSessionModels(id); }
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

  const deleteSession = async (e: React.MouseEvent, id: string) => {
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

  const handleWsHeaderClick = (id: string) => {
    toggleExpandedWorkspace(id);
    const ws = workspacesWithSessions.find((w) => w.id === id);
    if (ws && !ws.is_current) switchWorkspace(id);
  };

  return (
    <div style={sidebarStyles.root}>
      {/* Reserved gap for mac traffic-light buttons */}
      <div style={sidebarStyles.trafficGap} data-tauri-drag-region />

      {/* Workspaces → sessions tree */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
        {workspacesWithSessions.map((ws) => {
          const expanded = expandedWorkspaces.includes(ws.id);
          const current = ws.is_current;

          return (
            <div key={ws.id} style={{ marginBottom: 2 }}>
              {/* Workspace header row */}
              <div
                onClick={() => handleWsHeaderClick(ws.id)}
                tabIndex={0}
                role="button"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', margin: '0 6px', borderRadius: 8,
                  cursor: 'pointer',
                  background: current ? theme.cardActive : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!current) e.currentTarget.style.background = theme.cardActive;
                }}
                onMouseLeave={(e) => {
                  if (!current) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: theme.faint }}>
                  {expanded ? <CaretDown size={12} weight="fill" /> : <CaretRight size={12} weight="fill" />}
                </span>
                <FolderOpen
                  size={15}
                  color={current ? theme.accent : theme.faint}
                  style={{ flexShrink: 0 }}
                />
                <span style={{
                  flex: 1, fontSize: 12.5,
                  fontWeight: current ? 600 : 450,
                  color: current ? theme.text : theme.textSoft,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {ws.name}
                </span>
                {current && (
                  <span style={{ fontSize: 10, color: theme.accent, fontWeight: 500, flexShrink: 0 }}>
                    active
                  </span>
                )}
              </div>

              {/* Sessions under this workspace */}
              {expanded && (
                <div style={{ margin: '2px 0 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* New session button */}
                  {current && (
                    <div
                      onClick={newSession}
                      tabIndex={0}
                      role="button"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 14px 6px 38px', margin: '0 6px',
                        borderRadius: 6, cursor: 'pointer', fontSize: 12,
                        color: theme.faint,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = theme.accent; e.currentTarget.style.background = theme.cardActive; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = theme.faint; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Plus size={13} weight="bold" />
                      <span>New session</span>
                    </div>
                  )}
                  {ws.sessions.length === 0 && !current && (
                    <div style={{ fontSize: 11.5, color: theme.faint, padding: '6px 14px 6px 38px', fontStyle: 'italic' }}>
                      No conversations
                    </div>
                  )}
                  {ws.sessions.map((s) => (
                      <SessionItem
                        key={s.id}
                        session={s}
                        isCurrentWs={current}
                        onSwitch={() => {
                          if (!current) switchWorkspace(ws.id).then(() => switchTo(s.id, s.active));
                          else switchTo(s.id, s.active);
                        }}
                        onDelete={(e) => deleteSession(e, s.id)}
                      />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <UpdateStatusBar onOpenUpdate={onOpenUpdate} />

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

/* ── Sub-components ──────────────────────────────────────────────────── */

function WsHeader({
  name, foldersCount, expanded, isCurrent, onClick,
}: {
  name: string;
  foldersCount: number;
  expanded: boolean;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      tabIndex={0}
      role="button"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', margin: '0 6px', borderRadius: 8,
        cursor: 'pointer',
        background: isCurrent || hover ? theme.cardActive : 'transparent',
      }}
    >
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: theme.faint }}>
        {expanded ? <CaretDown size={12} weight="fill" /> : <CaretRight size={12} weight="fill" />}
      </span>
      <FolderOpen size={15} color={isCurrent ? theme.accent : theme.faint} style={{ flexShrink: 0 }} />
      <span style={{
        flex: 1, fontSize: 12.5,
        fontWeight: isCurrent ? 600 : 450,
        color: isCurrent ? theme.text : theme.textSoft,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name}
      </span>
      {isCurrent && (
        <span style={{ fontSize: 10, color: theme.accent, fontWeight: 500, flexShrink: 0 }}>active</span>
      )}
    </div>
  );
}

function SidebarRow({
  onClick, icon, label, isActive,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      tabIndex={0}
      role="button"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 14px 6px 38px', margin: '0 6px',
        borderRadius: 6, cursor: 'pointer',
        background: isActive || hover ? theme.cardActive : 'transparent',
        color: isActive ? theme.accent : hover ? theme.accent : theme.faint,
        fontSize: 12,
        transition: 'all 0.1s',
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function SessionItem({
  session, isCurrentWs, onSwitch, onDelete,
}: {
  session: SessionBrief;
  isCurrentWs: boolean;
  onSwitch: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const [hover, setHover] = React.useState(false);
  const isActive = session.active && isCurrentWs;

  return (
    <div
      onClick={onSwitch}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      tabIndex={0}
      role="button"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 14px 6px 38px', margin: '0 6px',
        borderRadius: 6, cursor: 'pointer',
        background: isActive ? theme.cardActive : hover ? theme.cardActive : 'transparent',
      }}
    >
      <ChatCircle
        size={13}
        color={isActive ? theme.accent : theme.faint}
        style={{ flexShrink: 0 }}
      />
      <span style={{
        flex: 1, fontSize: 12,
        color: isActive ? theme.text : theme.textSoft,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {session.title || 'New session'}
      </span>
      <span
        onClick={onDelete}
        style={{
          flexShrink: 0, color: theme.faint, cursor: 'pointer',
          padding: 2, display: 'flex', alignItems: 'center',
          opacity: hover ? 1 : 0,
          transition: 'opacity 0.1s',
        }}
        title="Delete"
      >
        <Trash size={11} />
      </span>
    </div>
  );
}


function UpdateStatusBar({ onOpenUpdate }: { onOpenUpdate: () => void }) {
  const { update } = useStore();
  const [hover, setHover] = React.useState(false);

  if (update.status !== 'available' && update.status !== 'ready') return null;

  const icon = <DownloadSimple size={15} color={theme.accent} />;
  const label = update.status === 'ready' ? 'Restart to update' : `Update available: v${update.version}`;
  const color = theme.text;

  return (
    <div
      onClick={onOpenUpdate}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px', margin: '0 6px 4px 6px', height: 34,
        borderRadius: 9,
        background: hover ? theme.cardActive : 'transparent',
        cursor: 'pointer', transition: 'all 0.15s ease-in-out', userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</div>
      <span style={{
        flex: 1, fontSize: 13, fontWeight: 400, color,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {update.status === 'available' && (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: theme.accent, boxShadow: `0 0 6px ${theme.accent}` }} />
      )}
    </div>
  );
}