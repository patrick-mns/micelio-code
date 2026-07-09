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
import ScanOverlay from '@/components/ScanOverlay';
import OpenInButton from '@/components/OpenInButton';
import BgTasksChip, { BgTasksPanel } from '@/components/BgTasksChip';
import ReviewChip, { ReviewPanel } from '@/components/ReviewChip';
import AnimatedPanel from '@/components/AnimatedPanel';
import Toasts from '@/components/Toasts';
import { useStore } from '@/store';
import { theme } from '@/theme';
import { usePanelResize } from '@/hooks/usePanelResize';
import { useBgTasks } from '@/hooks/useBgTasks';
import { useReview } from '@/hooks/useReview';
import { useWorkspace } from '@/hooks/useWorkspace';
import { ipc } from '@/ipc';
import type { TabId } from '@/store/uiSlice';
import { appStyles } from '@/utils/theme-styles';

// Thin draggable strip rendered in the gap between two side panels. Lives in
// the flex flow (not inside a panel), so it never overlaps a panel's scrollbar.
function ResizeHandle({ onMouseDown }: { onMouseDown: () => void }) {
  return <div className="panel-resizer" onMouseDown={onMouseDown} title="Drag to resize" />;
}

const TABS: { id: TabId; label: string; Icon: Icon }[] = [
  { id: 'chat', label: 'Chat', Icon: ChatCircle },
  { id: 'treemap', label: 'Treemap', Icon: SquaresFour },
  { id: 'usage', label: 'Usage', Icon: ChartBar },
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
  const [sysPromptOpen, setSysPromptOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

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
  const {
    status: reviewStatus,
    gitRevertFile, gitRevertAll,
  } = useReview();
  const { switching, pickWorkspace } = useWorkspace();
  const { loadCurrentWorkspace, currentWorkspace } = useStore();

  // Resizable widths for the two side panels (the wrapper width, including the
  // 8px float inset). Persisted + clamped by the hook.
  const sidebarResize = usePanelResize({ storageKey: 'sidebarWidth', defaultWidth: 256, min: 208, side: 'left' });
  const bgResize = usePanelResize({ storageKey: 'bgPanelWidth', defaultWidth: 328, min: 268, side: 'right' });

  useEffect(() => {
    loadCurrentWorkspace();
    ipc.getSettings().then(setSettings).catch(console.error);
  }, [loadCurrentWorkspace]);

  return (
    <div style={appStyles.root}>
      {/* Full-height layout: sidebar (left, hosts the mac traffic lights at its
          top) + content column with its own header. */}
      <div style={appStyles.body}>
        <AnimatedPanel open={sidebarOpen} side="left" width={sidebarResize.width} resizing={sidebarResize.isResizing}>
          <Sidebar
            workspaceName={switching ? 'Scanning…' : currentWorkspace?.name || 'Open folder'}
            onPickWorkspace={pickWorkspace}
            switching={switching}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUpdate={() => setUpdateOpen(true)}
          />
        </AnimatedPanel>
        {sidebarOpen && <ResizeHandle onMouseDown={sidebarResize.startResize} />}

        <div style={appStyles.content}>
          {/* Header over the content area only. When the sidebar is closed it
              reserves the traffic-light gap; otherwise the sidebar does. */}
          <div style={appStyles.header} data-tauri-drag-region>
            <div style={appStyles.headerLeft} data-tauri-drag-region>
              {!sidebarOpen && <div style={appStyles.trafficGap} />}

              <button
                className="icon-btn"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title="Toggle conversations"
              >
                <SidebarSimple size={18} weight={sidebarOpen ? 'fill' : 'regular'} />
              </button>
            </div>

            <div style={appStyles.center} data-tauri-drag-region>
              <div className="seg-track">
                {TABS.map(({ id, label, Icon }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      className={active ? 'seg-btn is-active' : 'seg-btn'}
                      onClick={() => setActiveTab(id)}
                    >
                      <Icon size={15} weight={active ? 'fill' : 'regular'} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: context actions for the current workspace. */}
            <div style={appStyles.headerRight} data-tauri-drag-region>
              <button
                className="btn btn-icon btn-ghost"
                style={{ color: aboutOpen ? theme.text : theme.dim }}
                title="About Micelio Code"
                onClick={() => setAboutOpen(true)}
              >
                <Info size={16} />
              </button>
              <button
                className="btn btn-icon btn-ghost"
                style={{ color: sysPromptOpen ? theme.text : theme.dim }}
                title="View system prompt"
                onClick={() => setSysPromptOpen(true)}
              >
                <FileText size={16} />
              </button>
              <BgTasksChip running={runningCount} active={rightPanel === 'bg'} onClick={() => setRightPanel((p) => (p === 'bg' ? null : 'bg'))} />
              <ReviewChip pendingCount={reviewStatus.pending_count} active={rightPanel === 'review'} onClick={() => setRightPanel((p) => (p === 'review' ? null : 'review'))} />
              <OpenInButton />
            </div>
          </div>

          <div style={appStyles.view}>
            {/* Chat stays mounted across tab switches so an in-flight stream
                keeps rendering when you leave to the treemap and come back. */}
            <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
              <Chat />
            </div>
            {activeTab === 'treemap' && <TreemapView />}
            {activeTab === 'usage' && <Usage />}
          </div>
        </div>

        {rightPanel && <ResizeHandle onMouseDown={bgResize.startResize} />}
        <AnimatedPanel open={!!rightPanel} side="right" width={bgResize.width} resizing={bgResize.isResizing}>
          {rightPanel === 'review' ? (
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
      <Toasts />
    </div>
  );
}
