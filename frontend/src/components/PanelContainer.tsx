import React from 'react';
import type { PanelTab, PanelView } from '@/types';
import { panelDockStyles as styles } from '@/utils/theme-styles';
import TabBar, { TabIcon } from './TabBar';

interface PanelContainerProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Views this dock can host — offered by "+", and listed directly when the
   * dock is empty. Already-open singletons are filtered out by the caller. */
  openable?: PanelView[];
  onOpenTab?: (view: PanelView) => void;
  onClosePanel?: () => void;
  /** Where this dock sits — only changes the card's outer margins, since the
   * bottom dock already gets its top gap from the resize handle. */
  dock?: 'bottom' | 'right';
  /** Renders one open tab, supplied by the caller (App.tsx) since it owns the
   * live data (bg tasks, review status, …). A function rather than a map by
   * type: two tabs of the same kind are different instances holding different
   * things, so each has to be rendered from its own tab. Keeps this a dumb
   * shell rather than something that reaches into app state itself. Panels
   * rendered here must drop their own card chrome (`embedded`) — this shell is
   * the card. */
  renderTab: (tab: PanelTab) => React.ReactNode;
}

export default function PanelContainer({
  tabs, activeTabId, onSelectTab, onCloseTab, openable = [], onOpenTab, onClosePanel,
  dock = 'right', renderTab,
}: PanelContainerProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div style={{ ...styles.shell, ...(dock === 'bottom' ? styles.shellBottom : styles.shellRight) }}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTab?.id ?? null}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        openable={openable}
        onOpenTab={onOpenTab}
        onClosePanel={onClosePanel}
      />
      <div style={styles.body}>
        {activeTab ? (
          // Keyed by tab id: two tabs of the same kind are separate instances,
          // and without a key React would reuse one's state for the other when
          // you switch between them.
          <React.Fragment key={activeTab.id}>{renderTab(activeTab)}</React.Fragment>
        ) : openable.length && onOpenTab ? (
          // Empty dock: offer the views themselves rather than pointing at the
          // "+". This is the panel's whole content, so it's a launcher list,
          // not a hint.
          <div style={styles.launcher}>
            {openable.map((view) => (
              <button key={view.type} className="dock-launcher-item" onClick={() => onOpenTab(view)}>
                <TabIcon icon={view.icon} size={15} />
                {view.label}
              </button>
            ))}
          </div>
        ) : (
          <div style={styles.launcherEmpty}>Nothing to open here.</div>
        )}
      </div>
    </div>
  );
}
