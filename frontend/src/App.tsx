import React, { useEffect, useState, type CSSProperties } from 'react';
import { ChatCircle, SquaresFour, SidebarSimple, ChartBar, FileText, Info, type Icon } from '@phosphor-icons/react';
import Chat from '@/views/Chat';
import TreemapView from '@/views/Treemap';
import Usage from '@/views/Usage';
import Settings from '@/components/Settings';
import SystemPromptModal from '@/components/SystemPromptModal';
import AboutModal from '@/components/AboutModal';
import UpdateModal from '@/components/UpdateModal';
import Sidebar from '@/components/Sidebar';
import SessionBadge from '@/components/SessionBadge';
import ConfirmModal from '@/components/ConfirmModal';
import Onboarding from '@/components/Onboarding';
import ScanOverlay from '@/components/ScanOverlay';
import OpenInButton from '@/components/OpenInButton';
import BgTasksChip, { BgTasksPanel } from '@/components/BgTasksChip';
import ReviewChip, { ReviewPanel } from '@/components/ReviewChip';
import AnimatedPanel from '@/components/AnimatedPanel';
import Toasts from '@/components/Toasts';
import { useStore } from '@/store';
import { theme } from '@/theme';
import { useI18n } from '@/i18n';
import { usePanelResize } from '@/hooks/usePanelResize';
import { useBgTasks } from '@/hooks/useBgTasks';
import { useReview } from '@/hooks/useReview';
import { useWorkspace } from '@/hooks/useWorkspace';
import { usePlatform } from '@/hooks/usePlatform';
import { ipc } from '@/ipc';
import type { TabId } from '@/store/uiSlice';
import { appStyles } from '@/utils/theme-styles';
import WindowControls from '@/components/WindowControls';
import ResizeEdgeHandles from '@/components/ResizeEdgeHandles';

// Thin draggable strip rendered in the gap between two side panels. Lives in
// the flex flow (not inside a panel), so it never overlaps a panel's scrollbar.
function ResizeHandle({ onMouseDown }: { onMouseDown: () => void }) {
  return <div className="panel-resizer" onMouseDown={onMouseDown} title="Drag to resize" />;
}

const TABS: { id: TabId; Icon: Icon }[] = [
  { id: 'chat', Icon: ChatCircle },
  { id: 'treemap', Icon: SquaresFour },
  { id: 'usage', Icon: ChartBar },
];

function basename(p: string | undefined): string {
  if (!p) return '';
  return p.replace(/\/+$/, '').split('/').pop() ?? '';
}

export default function App() {
  const {
    activeTab, setActiveTab, showSettings, setShowSettings,
    settings, setSettings, sidebarOpen, setSidebarOpen, scanning,
    update, setUpdateState, checkForUpdates,
  } = useStore();
  const [rightPanel, setRightPanel] = useState<'bg' | 'review' | null>(null);
  const [panelContent, setPanelContent] = useState<'bg' | 'review' | null>(null);
  useEffect(() => {
    if (rightPanel !== null) setPanelContent(rightPanel);
  }, [rightPanel]);
  const [sysPromptOpen, setSysPromptOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<string | null>(null);
const { t } = useI18n();

  // Set up background update check
  useEffect(() => {
    // 1. Listen for background progress events from the Rust updater
    let unlisten: any;
    ipc.onUpdateStatus((res) => {
      const st = typeof res === 'string' ? res : Object.keys(res)[0];
      const payload = typeof res === 'string' ? {} : res[st];
      setUpdateState({
        status: st as any,
        version: payload?.version,
        notes: payload?.notes,
        download_url: payload?.download_url,
        asset_name: payload?.asset_name,
        asset_size: payload?.asset_size,
        progress: payload?.progress,
        error_msg: typeof res === 'object' && 'error' in res ? res.error : undefined,
      });
    }).then((un) => { unlisten = un; }).catch(console.error);

    // 2. Perform background check after 15s delay
    const initialCheck = setTimeout(() => {
      checkForUpdates().catch(console.error);
    }, 15000);

    // 3. Keep checking every 8 hours
    const intervalCheck = setInterval(() => {
      checkForUpdates().catch(console.error);
    }, 8 * 60 * 60 * 1000);

    return () => {
      clearTimeout(initialCheck);
      clearInterval(intervalCheck);
      if (unlisten) unlisten();
    };
  }, []);

  // Auto-open About modal on first launch (no dismiss flag in localStorage yet).
  useEffect(() => {
    const seen = localStorage.getItem('aboutSeen');
    if (!seen) {
      setAboutOpen(true);
      localStorage.setItem('aboutSeen', '1');
    }
  }, []);

  const { tasks: bgTasks, runningCount, stop: stopBg, clear: clearBg } = useBgTasks();
  const platform = usePlatform();
  const {
    status: reviewStatus,
    gitRevertFile, gitRevertAll,
  } = useReview();
  const { switching, pickWorkspace } = useWorkspace();
  const { loadCurrentWorkspace, currentWorkspace } = useStore();

  const handleDeleteSessionConfirm = async () => {
    const id = confirmDeleteSession;
    if (!id) return;
    setConfirmDeleteSession(null);
    const { setSessions, setCurrentSession, setMessages, loadSessions, loadWorkspacesWithSessions } = useStore.getState();
    const nextId = await ipc.deleteSession(id).catch(() => null);
    if (nextId) {
      const msgs = await ipc.getHistory().catch(() => []);
      setCurrentSession(nextId);
      setMessages(nextId, msgs);
      await loadSessions();
    } else {
      setSessions([]);
      setCurrentSession(null);
      setMessages('', []);
    }
    // The sidebar tree renders from workspacesWithSessions, so refresh it too or
    // the deleted chat lingers until the next sidebar interaction.
    await loadWorkspacesWithSessions();
  };

  // Gate the main UI behind having a workspace, but only after the initial load
  // resolves — otherwise returning users would flash the onboarding screen.
  const [wsReady, setWsReady] = useState(false);

  // Resizable widths for the two side panels (the wrapper width, including the
  // 8px float inset). Persisted + clamped by the hook.
  const sidebarResize = usePanelResize({ storageKey: 'sidebarWidth', defaultWidth: 256, min: 208, side: 'left' });
  const bgResize = usePanelResize({ storageKey: 'bgPanelWidth', defaultWidth: 328, min: 268, side: 'right' });

  useEffect(() => {
    loadCurrentWorkspace().finally(() => setWsReady(true));
    ipc.getSettings().then(setSettings).catch(console.error);
    // Backend resets agent mode to its default on restart — push the persisted
    // choice so the two stay in sync.
    useStore.getState().syncAgentMode();
  }, [loadCurrentWorkspace]);

  return (
    <div style={appStyles.root}>
      {/* Full-height layout: sidebar (left, hosts the mac traffic lights at its
          top) + content column with its own header. */}
      <div style={appStyles.body}>
        <AnimatedPanel open={sidebarOpen} side="left" width={sidebarResize.width} resizing={sidebarResize.isResizing}>
          <Sidebar
            workspaceName={switching ? t('sidebar.scanning') : currentWorkspace?.name || t('sidebar.openFolder')}
            onPickWorkspace={pickWorkspace}
            switching={switching}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUpdate={() => setUpdateOpen(true)}
            onDeleteSession={(id) => setConfirmDeleteSession(id)}
          />
        </AnimatedPanel>
        {sidebarOpen && <ResizeHandle onMouseDown={sidebarResize.startResize} />}

        <div style={appStyles.content}>
          {/* Header over the content area only. When the sidebar is closed it
              reserves the traffic-light gap; otherwise the sidebar does. */}
          <div style={{ ...appStyles.header, height: platform.isMac ? 52 : 38, paddingInline: platform.isMac ? 12 : 0 }}>
            {/* On macOS the whole header is draggable (traffic lights float over
                it via the gap); on Windows/Linux only the center span is draggable
                so the window-control buttons remain clickable. */}

            {/* --- Left --- */}
            <div style={appStyles.headerLeft} data-tauri-drag-region>
              {platform.isMac && !sidebarOpen && <div style={appStyles.trafficGap} />}
              <button
                className="icon-btn"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={t('app.sidebarToggle')}
              >
                <SidebarSimple size={18} weight={sidebarOpen ? 'fill' : 'regular'} />
              </button>
              <SessionBadge />
            </div>

            {/* --- Center (draggable on all platforms) --- */}
            <div style={appStyles.center} data-tauri-drag-region>
              <div className="seg-track" style={{ visibility: currentWorkspace ? 'visible' : 'hidden' }}>
                {TABS.map(({ id, Icon }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      className={active ? 'seg-btn is-active' : 'seg-btn'}
                      onClick={() => setActiveTab(id)}
                    >
                      <Icon size={15} weight={active ? 'fill' : 'regular'} />
                      {t('tabs.' + id)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* --- Right --- */}
            <div style={{ ...appStyles.headerRight, alignSelf: 'stretch' }}>
              <button
                className="btn btn-icon btn-ghost"
                style={{ color: aboutOpen ? theme.text : theme.dim }}
                title={t('header.about')}
                onClick={() => setAboutOpen(true)}
              >
                <Info size={16} />
              </button>
              <button
                className="btn btn-icon btn-ghost"
                style={{ color: sysPromptOpen ? theme.text : theme.dim }}
                title={t('header.systemPrompt')}
                onClick={() => setSysPromptOpen(true)}
              >
                <FileText size={16} />
              </button>
              <BgTasksChip running={runningCount} active={rightPanel === 'bg'} onClick={() => setRightPanel((p) => (p === 'bg' ? null : 'bg'))} />
              <ReviewChip pendingCount={reviewStatus.pending_count} active={rightPanel === 'review'} onClick={() => setRightPanel((p) => (p === 'review' ? null : 'review'))} />
              <OpenInButton />
              {platform.showWindowControls && <WindowControls />}
            </div>
          </div>
          <div style={appStyles.view}>
            {/* No workspace yet → onboarding. Wait for the initial load so
                returning users don't flash it. */}
            {!wsReady ? null : !currentWorkspace ? (
              <Onboarding />
            ) : (
              <>
                {/* Chat stays mounted across tab switches so an in-flight stream
                    keeps rendering when you leave to the treemap and come back. */}
                <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
                  <Chat />
                </div>
                {activeTab === 'treemap' && <TreemapView />}
                {activeTab === 'usage' && <Usage />}
              </>
            )}
          </div>
        </div>

        {rightPanel && <ResizeHandle onMouseDown={bgResize.startResize} />}
        <AnimatedPanel open={!!rightPanel} side="right" width={bgResize.width} resizing={bgResize.isResizing}>
          {panelContent === 'review' ? (
            <ReviewPanel
              gitFiles={reviewStatus.changes.git_files}
              onClose={() => setRightPanel(null)}
              onRevert={gitRevertFile}
              onRevertAll={gitRevertAll}
            />
          ) : (
            <BgTasksPanel
              tasks={bgTasks}
              onClose={() => setRightPanel(null)}
              onStop={stopBg}
              onClear={clearBg}
            />
          )}
        </AnimatedPanel>
      </div>

      {scanning && <ScanOverlay />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {sysPromptOpen && <SystemPromptModal onClose={() => setSysPromptOpen(false)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {updateOpen && <UpdateModal onClose={() => setUpdateOpen(false)} />}
      <ConfirmModal
        open={confirmDeleteSession !== null}
        title="Delete session"
        message="This will permanently delete this session and its history. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteSessionConfirm}
        onCancel={() => setConfirmDeleteSession(null)}
      />
      <Toasts />
      {platform.showWindowControls && <ResizeEdgeHandles />}
    </div>
  );
}
