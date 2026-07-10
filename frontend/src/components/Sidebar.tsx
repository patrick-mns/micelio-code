import React, { useEffect, useState, type CSSProperties } from 'react';
import { sidebarStyles } from '@/utils/theme-styles';
import {
  Trash, FolderOpen,
  Gear, DownloadSimple, CaretRight, Plus,
} from '@phosphor-icons/react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { ipc } from '@/ipc';
import { useStore, type SessionBrief } from '@/store';
import { theme } from '@/theme';
import { useI18n } from '@/i18n';
import { usePlatform } from '@/hooks/usePlatform';
import type { SessionInfo } from '@/types';

interface SidebarProps {
  workspaceName: string;
  onPickWorkspace: () => void;
  switching: boolean;
  onOpenSettings: () => void;
  onOpenUpdate: () => void;
  onDeleteSession: (id: string) => void;
}

export default function Sidebar({
  workspaceName, onPickWorkspace, switching,
  onOpenSettings, onOpenUpdate, onDeleteSession,
}: SidebarProps) {
  const {
    sessions, setSessions, setMessages, setActiveTab,
    messagesBySession, isLoading, setCurrentSession, currentSession,
    setSessionModels, update,
    setSettingsCategory, setShowSettings,
    workspacesWithSessions, loadWorkspacesWithSessions,
    switchWorkspace, expandedWorkspaces, toggleExpandedWorkspace,
    currentWorkspace, setAgentStatus,
  } = useStore();

  const { t } = useI18n();
  const platform = usePlatform();

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

  useEffect(() => {
    let unsub: UnlistenFn | undefined;
    ipc.onSessionCreated(() => {
      loadWorkspacesWithSessions();
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
    setAgentStatus(id, 'idle');
    const msgs = await ipc.switchSession(id).catch(() => null);
    if (msgs) setMessages(id, msgs);
    loadSessionModels(id);
    setActiveTab('chat');
    refresh();
    loadWorkspacesWithSessions();
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDeleteSession(id);
  };

  const handleWsHeaderClick = async (id: string) => {
    toggleExpandedWorkspace(id);
    const ws = workspacesWithSessions.find((w) => w.id === id);
    if (ws && !ws.is_current) {
      await switchWorkspace(id);
    }
  };

  return (
    <div style={sidebarStyles.root}>
      {/* Reserved gap for mac traffic-light buttons */}
      {platform.isMac && <div style={sidebarStyles.trafficGap} data-tauri-drag-region />}

      {/* Workspaces → sessions tree */}
      <div style={sidebarStyles.sessionList}>
        {/* Global new session button — only when a workspace is loaded. */}
        {currentWorkspace && (
          <div
            onClick={newSession}
            tabIndex={0}
            role="button"
            style={sidebarStyles.newBtn}
            onMouseEnter={(e) => { e.currentTarget.style.color = theme.accent; e.currentTarget.style.background = theme.cardActive; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = theme.faint; e.currentTarget.style.background = 'transparent'; }}
          >
            <Plus size={14} weight="bold" />
            <span>{t('sidebar.newSession')}</span>
          </div>
        )}

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
                  ...sidebarStyles.wsHeader,
                  background: current ? theme.cardActive : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!current) e.currentTarget.style.background = theme.cardActive;
                }}
                onMouseLeave={(e) => {
                  if (!current) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={sidebarStyles.wsChevron}>
                  <CaretRight size={12} weight="bold" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                </span>
                <span style={{
                  ...sidebarStyles.wsName,
                  fontWeight: current ? 600 : 450,
                  color: current ? theme.text : theme.textSoft,
                }}>
                  {ws.name}
                </span>
              </div>

              {/* Sessions under this workspace */}
              {expanded && (
                <div style={{ margin: '2px 0 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {ws.sessions.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 14px 6px 36px', margin: '0 6px', fontSize: 11.5, color: theme.faint, fontWeight: 400 }}>
                        {t('sidebar.noConversations')}
                    </div>
                  )}
                  {ws.sessions.map((s) => (
                      <SessionItem
                        key={s.id}
                        session={s}
                        isCurrentWs={current}
                        onSwitch={async () => {
                          if (!current) {
                            await switchWorkspace(ws.id);
                            await switchTo(s.id, s.active);
                          } else {
                            await switchTo(s.id, s.active);
                          }
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
          className="btn btn-ghost"
          style={sidebarStyles.gearBtn}
          onClick={() => { setSettingsCategory('workspace'); setShowSettings(true); }}
          title={t('sidebar.openSettings')}
        >
          <FolderOpen size={15} />
        </button>
        <button className="btn btn-ghost" style={sidebarStyles.gearBtn} onClick={onOpenSettings} title={t('sidebar.openSettings')}>
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
      <FolderOpen size={15} color={theme.faint} style={{ flexShrink: 0 }} />
      <span style={{
        flex: 1, fontSize: 12.5,
        fontWeight: isCurrent ? 600 : 450,
        color: isCurrent ? theme.text : theme.textSoft,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name}
      </span>
      <CaretRight
        size={12}
        weight="bold"
        style={{
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform .15s',
          flexShrink: 0,
          color: theme.faint,
        }}
      />
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
        padding: '8px 14px', margin: '0 6px',
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
  const { t } = useI18n();
  const [hover, setHover] = React.useState(false);
  const isActive = session.active && isCurrentWs;
  const dotColor = useDotColor(session.id, isActive);

  return (
    <div
      onClick={onSwitch}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      tabIndex={0}
      role="button"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', margin: '0 6px',
        borderRadius: 6, cursor: 'pointer',
        background: isActive ? theme.cardActive : hover ? theme.cardActive : 'transparent',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: dotColor,
        flexShrink: 0,
        marginLeft: 3,
      }} />
      <span style={{
        flex: 1, fontSize: 12.5,
        color: isActive ? theme.text : theme.textSoft,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {session.title || t('sidebar.newSession')}
      </span>
      <span
        onClick={onDelete}
        style={{
          flexShrink: 0, color: theme.faint, cursor: 'pointer',
          padding: 2, display: 'flex', alignItems: 'center',
          opacity: hover ? 1 : 0,
          transition: 'opacity 0.1s',
        }}
        title={t('sidebar.deleteBtn')}
      >
        <Trash size={11} />
      </span>
    </div>
  );
}

/** Map agent status to a dot color (or fallback to the existing active/faint logic). */
function useDotColor(sessionId: string, isActive: boolean): string {
  const status = useStore((s) => s.agentStatus[sessionId]) ?? 'idle';

  if (status === 'idle') {
    return isActive ? theme.accent : theme.faint;
  }

  const dotColors: Record<string, string> = {
    running:        theme.warn,
    awaiting_input: theme.accent,
    error:          theme.error,
    complete:       theme.success,
  };
  return dotColors[status] ?? (isActive ? theme.accent : theme.faint);
}


function UpdateStatusBar({ onOpenUpdate }: { onOpenUpdate: () => void }) {
  const { t } = useI18n();
  const { update } = useStore();
  const [hover, setHover] = React.useState(false);

  if (update.status !== 'available' && update.status !== 'ready') return null;

  const icon = <DownloadSimple size={15} color={theme.accent} />;
  const label = update.status === 'ready' ? t('update.restartLabel') : `${t('update.available')}: v${update.version}`;
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