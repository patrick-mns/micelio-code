import React from 'react';
import type { PanelTab, PanelTabType } from '@/types';
import { panelDockStyles as styles } from '@/utils/theme-styles';
import TabBar, { TabIcon } from './TabBar';

interface PanelContainerProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Views this dock can host that aren't open right now — offered by "+", and
   * listed directly when the dock is empty. */
  openable?: PanelTab[];
  onOpenTab?: (tab: PanelTab) => void;
  onClosePanel?: () => void;
  /** Where this dock sits — only changes the card's outer margins, since the
   * bottom dock already gets its top gap from the resize handle. */
  dock?: 'bottom' | 'right';
  /** Real content per tab type, supplied by the caller (App.tsx) since it owns
   * the live data (bg tasks, review status, …). Keeps this a dumb shell rather
   * than something that reaches into app state itself. Panels rendered here
   * must drop their own card chrome (`embedded`) — this shell is the card. */
  content: Partial<Record<PanelTabType, React.ReactNode>>;
}

export default function PanelContainer({
  tabs, activeTabId, onSelectTab, onCloseTab, openable = [], onOpenTab, onClosePanel,
  dock = 'right', content,
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
          content[activeTab.type] ?? null
        ) : openable.length && onOpenTab ? (
          // Empty dock: offer the views themselves rather than pointing at the
          // "+". This is the panel's whole content, so it's a launcher list,
          // not a hint.
          <div style={styles.launcher}>
            {openable.map((tab) => (
              <button key={tab.id} className="dock-launcher-item" onClick={() => onOpenTab(tab)}>
                <TabIcon icon={tab.icon} size={15} />
                {tab.label}
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
