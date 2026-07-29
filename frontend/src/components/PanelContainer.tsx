import React from 'react';
import type { PanelTab } from '@/types';
import { theme } from '@/theme';
import TabBar from './TabBar';

interface PanelContentProps {
  tab: PanelTab;
}

// Registry: map tab types to their content components
const PanelContentRegistry: Record<string, React.ComponentType<PanelContentProps>> = {
  terminal: () => (
    <div style={{ padding: 16, color: theme.text }}>
      Terminal (coming soon)
    </div>
  ),
  output: () => (
    <div style={{ padding: 16, color: theme.text }}>
      Output
    </div>
  ),
  'bg-tasks': () => (
    <div style={{ padding: 16, color: theme.text }}>
      Background Tasks
    </div>
  ),
  review: () => (
    <div style={{ padding: 16, color: theme.text }}>
      Review
    </div>
  ),
};

interface PanelContainerProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  height?: number;
  width?: number;
  orientation?: 'horizontal' | 'vertical';
}

export default function PanelContainer({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  height,
  width,
  orientation = 'horizontal',
}: PanelContainerProps) {
  if (!tabs.length) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  if (!activeTab) return null;

  const ContentComponent = PanelContentRegistry[activeTab.type];
  const isVertical = orientation === 'vertical';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'row' : 'column',
        height: isVertical ? '100%' : height,
        width: isVertical ? width : '100%',
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 0,
      }}
    >
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        orientation={orientation}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'auto',
          background: theme.codeBg,
        }}
      >
        {ContentComponent && <ContentComponent tab={activeTab} />}
      </div>
    </div>
  );
}
