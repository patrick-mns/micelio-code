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
  { id: 'file', type: 'file', label: 'File', icon: 'file' },
];

const FILE_VIEW = VIEW_CATALOG.find((t) => t.type === 'file')!;

/** A file the viewer is pointed at, carrying the workspace it belongs to.
 *
 * The path alone doesn't identify a file: it's workspace-relative, so after a
 * switch it would resolve against the new root and quietly show the *other*
 * project's file of the same name. Pairing it with the workspace lets the
 * viewer derive that the reference went stale, instead of every place that
 * switches workspace having to remember to clear it — the way `activeRoot` is
 * reset by hand in four spots today. */
export interface FileRef {
  /** null only before a workspace exists, which is the onboarding screen. */
  workspaceId: string | null;
  path: string;
  /** The folder the path was cited against. A multi-folder workspace can hold
   * the same relative path twice, so without this the file would change under
   * the viewer when the selected folder does. */
  root: string | null;
}

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

  /** Which file the File view is showing. Kept here rather than inside the
   * component so anywhere in the app can point the viewer at a file. */
  openFileRef: FileRef | null;
  /** Shows `path` in the File view, opening/focusing that view wherever it
   * lives. Workspace-relative or absolute — the backend resolves both.
   * `root` is the folder the path was cited against; omit it to use the
   * selected folder, and pass it when the citation came from somewhere else —
   * a link inside a document belongs to *that* document's folder, not to
   * whichever folder happens to be selected now. */
  openFile: (path: string, root?: string | null) => void;
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

export const panelSlice: StateCreator<AppState, [], [], PanelSlice> = (set, get) => ({
  bottomTabs: [],
  activeBottomTab: null,
  bottomPanelOpen: false,

  rightTabs: [],
  activeRightTab: null,
  rightPanelOpen: false,

  openFileRef: null,

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

  openFile: (path, root) => {
    // Show it wherever the File view already is — sending a file to the viewer
    // shouldn't yank the view across docks. Otherwise it lands on the right.
    const s = get();
    const dock: DockId = s.bottomTabs.some((t) => t.type === 'file') ? 'bottom' : 'right';
    // Stamp the folder the path was cited against: the caller's when it knows
    // (a link inside a document), otherwise the selected one — the same folder
    // the palette and the changes panel scope to.
    set({
      openFileRef: {
        workspaceId: s.currentWorkspace?.id ?? null,
        path,
        root: root !== undefined ? root : s.activeRoot || s.currentWorkspace?.folders?.[0] || null,
      },
    });
    s.openDockTab(dock, FILE_VIEW);
  },
});
