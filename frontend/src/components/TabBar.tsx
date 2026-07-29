import React from 'react';
import { X, Terminal, Check, List } from '@phosphor-icons/react';
import type { PanelTab } from '@/types';
import { theme } from '@/theme';

interface TabBarProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  orientation?: 'horizontal' | 'vertical';
}

const ICONS = {
  terminal: Terminal,
  activity: List,
  check: Check,
  list: List,
};

export default function TabBar({
  tabs, activeTabId, onSelectTab, onCloseTab, orientation = 'horizontal',
}: TabBarProps) {
  if (!tabs.length) return null;

  const isVertical = orientation === 'vertical';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        borderBottom: isVertical ? 'none' : `1px solid ${theme.border}`,
        borderRight: isVertical ? `1px solid ${theme.border}` : 'none',
        gap: 0,
        overflow: isVertical ? 'auto' : 'auto',
        backgroundColor: theme.bg,
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon ? ICONS[tab.icon] : null;
        const isActive = tab.id === activeTabId;

        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            title={tab.label}
            style={{
              flex: isVertical ? undefined : '0 1 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: isVertical ? '8px 12px' : '10px 12px',
              minWidth: isVertical ? 0 : 120,
              height: isVertical ? 'auto' : 40,
              background: isActive ? theme.card : 'transparent',
              border: 'none',
              borderBottom: !isVertical && isActive ? `2px solid ${theme.text}` : 'none',
              borderRight: isVertical && isActive ? `2px solid ${theme.text}` : 'none',
              color: isActive ? theme.text : theme.dim,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
              transition: 'background-color 0.1s, color 0.1s',
              whiteSpace: 'nowrap',
            }}
          >
            {Icon && <Icon size={14} weight="regular" />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tab.label}
            </span>
            {onCloseTab && tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  padding: '2px 4px',
                  cursor: 'pointer',
                  color: theme.dim,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={12} weight="bold" />
              </button>
            )}
          </button>
        );
      })}
    </div>
  );
}
