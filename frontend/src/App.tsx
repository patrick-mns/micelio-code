import React, { useEffect, useState, type CSSProperties } from 'react';
import { ChatCircle, SquaresFour, SidebarSimple, Rows, FileText, Info, type Icon } from '@phosphor-icons/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import Chat from '@/views/Chat';
import TreemapView from '@/views/Treemap';
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
import { BgTasksPanel } from '@/components/BgTasksChip';
import { ReviewPanel } from '@/components/ReviewChip';
import AnimatedPanel from '@/components/AnimatedPanel';
import Toasts from '@/components/Toasts';
import PanelContainer from '@/components/PanelContainer';
import { useStore } from '@/store';
import { VIEW_CATALOG } from '@/store/panelSlice';
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
    // Dock state (bottom + right tabbed panels)
    bottomTabs, activeBottomTab, bottomPanelOpen,
    rightTabs, activeRightTab, rightPanelOpen,
    setActiveDockTab, toggleDock, closeDockTab, openDockTab,
  } = useStore();

  // A dock offers everything it isn't already showing — including views open
  // in the other dock, since picking one there moves it.
  const openableBottom = VIEW_CATALOG.filter((c) => !bottomTabs.some((t) => t.id === c.id));
  const openableRight = VIEW_CATALOG.filter((c) => !rightTabs.some((t) => t.id === c.id));
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
    refresh: refreshReview,
  } = useReview();
  const { switching, pickWorkspace } = useWorkspace();
  const { loadCurrentWorkspace, currentWorkspace, activeRoot } = useStore();

  // The changes panel is scoped to a single active folder (backend workspace_root):
  // activeRoot when set, otherwise the workspace's first folder.
  const activeFolderPath = activeRoot || currentWorkspace?.folders?.[0] || '';

  // Re-fetch the diff whenever the folder or workspace changes. The backend
  // updates its workspace_root before either value settles, so by now
  // get_review_status reads the newly-selected folder. Without this the panel
  // keeps showing the previous folder's (or workspace's) changes.
  useEffect(() => {
    refreshReview();
  }, [refreshReview, activeFolderPath, currentWorkspace?.id]);

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
    // Load session models for all sessions on startup
    (async () => {
      try {
        const sessions = await ipc.listSessions();
        const { setSessionModels } = useStore.getState();
        for (const session of sessions) {
          const models = await ipc.getSessionModels(session.id);
          setSessionModels(session.id, models);
        }
      } catch (e) {
        console.error('Failed to load session models on startup', e);
      }
    })();
  }, [loadCurrentWorkspace]);

  // A view is "seen" only when it's the showing tab of an open dock — either
  // dock may be hosting it, so both have to be checked.
  const isViewShowing = (id: string) =>
    (bottomPanelOpen && activeBottomTab === id) || (rightPanelOpen && activeRightTab === id);
  const hasUnseenActivity =
    (runningCount > 0 && !isViewShowing('bg-tasks')) ||
    (reviewStatus.pending_count > 0 && !isViewShowing('review'));

  // One definition per view, shared by both docks — a view renders the same
  // wherever it's docked, so this can't drift between the two.
  const dockContent = {
    'bg-tasks': (
      <BgTasksPanel
        embedded
        tasks={bgTasks}
        onClose={() => closeDockTab(bottomTabs.some((t) => t.id === 'bg-tasks') ? 'bottom' : 'right', 'bg-tasks')}
        onStop={stopBg}
        onClear={clearBg}
      />
    ),
    review: (
      <ReviewPanel
        embedded
        gitFiles={reviewStatus.changes.git_files}
        onClose={() => closeDockTab(bottomTabs.some((t) => t.id === 'review') ? 'bottom' : 'right', 'review')}
        onRevert={gitRevertFile}
        onRevertAll={gitRevertAll}
      />
    ),
  };

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
              {/* One toggle per dock, not a chip per feature — which views a
                  dock hosts is chosen inside it, via the tab bar's "+". */}
              <button
                className="btn btn-icon btn-ghost"
                style={{ color: bottomPanelOpen ? theme.text : theme.dim }}
                title="Toggle bottom panel"
                onClick={() => toggleDock('bottom')}
              >
                <Rows size={16} weight={bottomPanelOpen ? 'fill' : 'regular'} />
              </button>
              <button
                className="btn btn-icon btn-ghost"
                style={{ color: rightPanelOpen ? theme.text : theme.dim, position: 'relative' }}
                title="Toggle right panel"
                onClick={() => toggleDock('right')}
              >
                <SidebarSimple size={16} weight={rightPanelOpen ? 'fill' : 'regular'} style={{ transform: 'scaleX(-1)' }} />
                {/* "There's activity you can't see right now" — a view counts as
                    seen only if it's the showing tab of an open dock, since
                    either dock may be hosting it. */}
                {hasUnseenActivity && (
                  <span
                    style={{
                      position: 'absolute', top: 4, right: 4, width: 6, height: 6,
                      borderRadius: '50%', background: theme.text,
                    }}
                  />
                )}
              </button>
              <OpenInButton />
              {platform.showWindowControls && <WindowControls />}
            </div>
          </div>
          <Group orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
            {/* Main content area: chat + treemap. The Panel has to be the flex
                column itself — `appStyles.view` sizes with `flex: 1`, which is
                inert unless its parent is a flex container, and the view would
                collapse to content height (shoving the composer to the top). */}
            {/* Sizes are strings on purpose: react-resizable-panels reads a
                bare number as pixels and a unitless string as a percentage. */}
            <Panel
              minSize="30"
              style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
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
                  </>
                )}
              </div>
            </Panel>

            {/* Bottom panel with tabs */}
            {bottomPanelOpen && (
              <>
                {/* Matches the side panels' .panel-resizer: an invisible grab
                    strip, not a painted divider — the dock's card edge is
                    what you actually see. */}
                <Separator className="panel-resizer panel-resizer-h" />
                <Panel
                  defaultSize="28"
                  minSize="12"
                  maxSize="70"
                  style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
                >
                  <PanelContainer
                    dock="bottom"
                    tabs={bottomTabs}
                    activeTabId={activeBottomTab}
                    onSelectTab={(id) => setActiveDockTab('bottom', id)}
                    onCloseTab={(id) => closeDockTab('bottom', id)}
                    openable={openableBottom}
                    onOpenTab={(tab) => openDockTab('bottom', tab)}
                    onClosePanel={() => toggleDock('bottom')}
                    content={dockContent}
                  />
                </Panel>
              </>
            )}
          </Group>
        </div>

        {rightPanelOpen && <ResizeHandle onMouseDown={bgResize.startResize} />}
        <AnimatedPanel open={!!rightPanelOpen} side="right" width={bgResize.width} resizing={bgResize.isResizing}>
          <PanelContainer
            dock="right"
            tabs={rightTabs}
            activeTabId={activeRightTab}
            onSelectTab={(id) => setActiveDockTab('right', id)}
            onCloseTab={(id) => closeDockTab('right', id)}
            openable={openableRight}
            onOpenTab={(tab) => openDockTab('right', tab)}
            onClosePanel={() => toggleDock('right')}
            content={dockContent}
          />
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
