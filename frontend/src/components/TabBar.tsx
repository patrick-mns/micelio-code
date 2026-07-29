import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Plus, Terminal, Check, Rows } from '@phosphor-icons/react';
import type { PanelTab, PanelTabType } from '@/types';
import { panelDockStyles as styles } from '@/utils/theme-styles';

export interface TabBarProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  /** Views this dock can host that aren't currently open — offered by the
   * trailing "+". Empty means the "+" is hidden. */
  openable?: PanelTab[];
  onOpenTab?: (tab: PanelTab) => void;
  /** Dismisses the whole dock. Anchored at the strip's far right — a fixed
   * spot that doesn't move as tabs are opened and closed. */
  onClosePanel?: () => void;
}

const ICONS: Record<NonNullable<PanelTab['icon']>, React.ElementType> = {
  terminal: Terminal,
  activity: Rows,
  check: Check,
  list: Rows,
};

// Always `regular`: swapping to `fill` on the active tab visibly deforms
// outline glyphs like Check, and the tab's own background already carries
// the selected state.
export function TabIcon({ icon, size = 14 }: { icon?: PanelTab['icon']; size?: number }) {
  if (!icon) return null;
  const Icon = ICONS[icon];
  return <Icon size={size} weight="regular" />;
}

// The dock's tab strip: closable tabs plus a "+" that reopens whatever this
// dock can host but isn't showing. Ghost-button grammar (see `.dock-tab`), so
// tabs sit in the same visual family as the rest of the toolbar.
export default function TabBar({
  tabs, activeTabId, onSelectTab, onCloseTab, openable = [], onOpenTab, onClosePanel,
}: TabBarProps) {
  const addRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The "+" sits inside the scrolling tab row, which is itself inside the
  // dock's `overflow: hidden` card — an absolutely-positioned menu would be
  // clipped by both. So the menu is fixed-positioned, anchored to the button's
  // viewport rect captured when it opens.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Keep the menu inside the viewport on both axes. The "+" can sit anywhere
  // — a bottom dock puts it near the left edge, and it's always low on screen
  // — so a fixed corner-anchoring rule sends the menu off-screen. Measured
  // after render (in a layout effect, so the correction lands before paint)
  // because the menu's size depends on how many views are openable.
  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    const gap = 6;
    const edge = 8;

    let left = anchor.left;
    if (left + menu.width > window.innerWidth - edge) left = window.innerWidth - menu.width - edge;
    left = Math.max(edge, left);

    // Flip above the button when there's no room below it.
    let top = anchor.bottom + gap;
    if (top + menu.height > window.innerHeight - edge) top = anchor.top - menu.height - gap;
    top = Math.max(edge, top);

    setPos({ top, left });
  }, [anchor]);

  const close = () => { setAnchor(null); setPos(null); };

  // Close on an outside click, Escape, or anything that moves the anchor
  // (scroll/resize) — the menu can't follow it while fixed.
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!addRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [anchor]);

  // Nothing open and nothing to open — the dock shouldn't be showing at all.
  if (!tabs.length && !openable.length) return null;

  return (
    <div style={styles.head}>
      <div style={styles.tabs}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={active ? 'dock-tab is-active' : 'dock-tab'}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(e) => { if (e.button === 1) onCloseTab(tab.id); }}
              role="tab"
              aria-selected={active}
              title={tab.label}
            >
              <TabIcon icon={tab.icon} />
              <span>{tab.label}</span>
              <button
                className="dock-tab-close"
                title={`Close ${tab.label}`}
                aria-label={`Close ${tab.label}`}
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              >
                <X size={11} weight="bold" />
              </button>
            </div>
          );
        })}

        {/* "+" rides directly after the last tab, the way a browser's new-tab
            button does — it belongs to the tab row, not to the strip's edge. */}
        {onOpenTab && openable.length > 0 && (
          <div ref={addRef} style={styles.addWrap}>
            <button
              className="btn btn-icon-sm btn-ghost"
              title="Open a view"
              aria-label="Open a view"
              onClick={(e) => (anchor ? close() : setAnchor(e.currentTarget.getBoundingClientRect()))}
            >
              <Plus size={14} weight="bold" />
            </button>
            {anchor && (
              <div
                ref={menuRef}
                style={{
                  ...styles.addMenu,
                  // First paint uses the raw anchor; the layout effect above
                  // replaces it with the clamped position before the browser
                  // paints, so this never shows off-screen.
                  top: pos?.top ?? anchor.bottom + 6,
                  left: pos?.left ?? anchor.left,
                  visibility: pos ? 'visible' : 'hidden',
                }}
              >
                {openable.map((tab) => (
                  <button
                    key={tab.id}
                    className="menu-item"
                    onClick={() => { onOpenTab(tab); close(); }}
                  >
                    <TabIcon icon={tab.icon} />
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {onClosePanel && (
        <button className="close-btn" onClick={onClosePanel} title="Close panel" aria-label="Close panel">
          <X size={15} />
        </button>
      )}
    </div>
  );
}
