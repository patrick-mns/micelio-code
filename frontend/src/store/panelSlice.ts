// Dock state — which views are open in the bottom/right docks and which one
// each is showing. Docks are generic: any view in the catalog can be opened in
// either one, so the same view can be moved from the side to the bottom.
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import type { PanelTab } from '@/types';

export type DockId = 'bottom' | 'right';

/** Every view a dock can host. Both docks draw from this one list — nothing is
 * bound to a particular dock. Adding a view to the app means adding it here
 * and supplying its content in App.tsx. */
export const VIEW_CATALOG: PanelTab[] = [
  { id: 'bg-tasks', type: 'bg-tasks', label: 'Background', icon: 'activity' },
  { id: 'review', type: 'review', label: 'Review', icon: 'check' },
];

export interface PanelSlice {
  // Both docks start empty: opening one shows an empty dock with a "+", and
  // the user picks what goes in it rather than inheriting a default view.
  bottomTabs: PanelTab[];
  activeBottomTab: string | null;
  bottomPanelOpen: boolean;

  rightTabs: PanelTab[];
  activeRightTab: string | null;
  rightPanelOpen: boolean;

  setActiveDockTab: (dock: DockId, tabId: string) => void;
  toggleDock: (dock: DockId) => void;
  closeDockTab: (dock: DockId, tabId: string) => void;
  /** Opens a view in `dock`, removing it from the other one — a view lives in
   * a single place, so picking it from the bottom dock's "+" moves it there
   * rather than showing two copies. */
  openDockTab: (dock: DockId, tab: PanelTab) => void;
}

// Closing a tab hands focus to its neighbour rather than jumping to the first,
// which is what every tabbed UI does and what the eye expects.
function neighbourOf(tabs: PanelTab[], closedId: string): string | null {
  const i = tabs.findIndex((t) => t.id === closedId);
  if (i === -1) return tabs[0]?.id ?? null;
  const rest = tabs.filter((t) => t.id !== closedId);
  return (rest[i] ?? rest[i - 1] ?? rest[0])?.id ?? null;
}

// Reopening keeps catalog order instead of appending, so a view always lands
// in the same place regardless of the order things were closed and reopened.
function inCatalogOrder(tabs: PanelTab[]): PanelTab[] {
  const order = VIEW_CATALOG.map((t) => t.id);
  return [...tabs].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// The two docks hold identical shapes, so every action is written once against
// whichever set of keys the dock maps to.
const KEYS = {
  bottom: { tabs: 'bottomTabs', active: 'activeBottomTab', open: 'bottomPanelOpen' },
  right: { tabs: 'rightTabs', active: 'activeRightTab', open: 'rightPanelOpen' },
} as const;

export const panelSlice: StateCreator<AppState, [], [], PanelSlice> = (set) => ({
  bottomTabs: [],
  activeBottomTab: null,
  bottomPanelOpen: false,

  rightTabs: [],
  activeRightTab: null,
  rightPanelOpen: false,

  setActiveDockTab: (dock, tabId) => set({ [KEYS[dock].active]: tabId } as Partial<AppState>),

  toggleDock: (dock) => set((s) => ({ [KEYS[dock].open]: !s[KEYS[dock].open] } as Partial<AppState>)),

  // An empty dock is a designed state (it shows the "+"), so closing the last
  // tab leaves the dock open — dismissing it is the dock's own X.
  closeDockTab: (dock, tabId) => set((s) => {
    const k = KEYS[dock];
    const tabs = s[k.tabs] as PanelTab[];
    return {
      [k.tabs]: tabs.filter((t) => t.id !== tabId),
      [k.active]: s[k.active] === tabId ? neighbourOf(tabs, tabId) : s[k.active],
    } as Partial<AppState>;
  }),

  openDockTab: (dock, tab) => set((s) => {
    const k = KEYS[dock];
    const other = KEYS[dock === 'bottom' ? 'right' : 'bottom'];
    const tabs = s[k.tabs] as PanelTab[];
    const otherTabs = s[other.tabs] as PanelTab[];
    return {
      [k.tabs]: tabs.some((t) => t.id === tab.id) ? tabs : inCatalogOrder([...tabs, tab]),
      [k.active]: tab.id,
      [k.open]: true,
      // Moving out of the other dock: drop it there and re-point that dock's
      // selection so it isn't left highlighting a tab it no longer has.
      [other.tabs]: otherTabs.filter((t) => t.id !== tab.id),
      [other.active]: s[other.active] === tab.id ? neighbourOf(otherTabs, tab.id) : s[other.active],
    } as Partial<AppState>;
  }),

});
