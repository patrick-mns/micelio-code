// Dock state — which tabs are open in the bottom/right docks and which one each
// is showing. Docks are generic: any view in the catalog can be opened in
// either one, so the same view can be moved from the side to the bottom.
//
// A tab is an *instance* of a view, not the view itself: its identity is its
// id, and `params`/`cwd` carry what makes it that instance (which file, which
// folder). That's what lets one dock hold several files — or several terminals
// — at once, instead of a single slot per kind.
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { loadPrefs, savePrefs, type StoredTerminal } from './_persist';
import type { FileRef, PanelTab, PanelView } from '@/types';

export type DockId = 'bottom' | 'right';

/** Every view a dock can host. Both docks draw from this one list — nothing is
 * bound to a particular dock. Adding a view to the app means adding it here
 * and rendering its type in App.tsx. */
export const VIEW_CATALOG: PanelView[] = [
  { type: 'bg-tasks', label: 'Background', icon: 'activity' },
  { type: 'review', label: 'Review', icon: 'check' },
  { type: 'file', label: 'File', icon: 'file', multi: true },
  { type: 'terminal', label: 'Terminal', icon: 'terminal', multi: true },
];

const FILE_VIEW = VIEW_CATALOG.find((v) => v.type === 'file')!;
export const TERMINAL_VIEW = VIEW_CATALOG.find((v) => v.type === 'terminal')!;

export interface PanelSlice {
  // Both docks start empty apart from restored terminals: opening one shows an
  // empty dock with a "+", and the user picks what goes in it rather than
  // inheriting a default view.
  bottomTabs: PanelTab[];
  activeBottomTab: string | null;
  bottomPanelOpen: boolean;

  rightTabs: PanelTab[];
  activeRightTab: string | null;
  rightPanelOpen: boolean;

  setActiveDockTab: (dock: DockId, tabId: string) => void;
  toggleDock: (dock: DockId) => void;
  closeDockTab: (dock: DockId, tabId: string) => void;
  /** Opens `view` in `dock` and returns the tab's id.
   *
   * A singleton lives in a single place, so opening one that's in the other
   * dock moves it rather than showing two copies. A `multi` view has nothing
   * to move: every call is a new instance, sitting alongside its siblings. */
  openDockTab: (dock: DockId, view: PanelView) => string;

  /** Shows `path` in a File tab: the one already holding it, else the showing
   * File tab, else a new one. Following a link navigates in place instead of
   * piling up tabs; deliberately opening a second File tab from "+" is what
   * gets you two at once.
   *
   * `root` is the folder the path was cited against; omit it to use the
   * selected folder, and pass it when the citation came from somewhere else —
   * a link inside a document belongs to *that* document's folder, not to
   * whichever folder happens to be selected now. */
  openFile: (path: string, root?: string | null) => void;
  /** Points one specific File tab at a file — what the viewer's own picker and
   * in-document links use, since those act on the tab they live in. */
  openFileInTab: (tabId: string, path: string, root?: string | null) => void;
}

// Closing a tab hands focus to its neighbour rather than jumping to the first,
// which is what every tabbed UI does and what the eye expects.
export function neighbourOf(tabs: PanelTab[], closedId: string): string | null {
  const i = tabs.findIndex((t) => t.id === closedId);
  if (i === -1) return tabs[0]?.id ?? null;
  const rest = tabs.filter((t) => t.id !== closedId);
  return (rest[i] ?? rest[i - 1] ?? rest[0])?.id ?? null;
}

// Reopening keeps catalog order instead of appending, so a view always lands in
// the same place regardless of the order things were closed and reopened.
// Instances of the same view group together — the sort is by kind, and a stable
// sort leaves siblings in the order they were opened.
export function orderTabs(tabs: PanelTab[]): PanelTab[] {
  const rank = (t: PanelTab) => {
    const i = VIEW_CATALOG.findIndex((v) => v.type === t.type);
    return i === -1 ? VIEW_CATALOG.length : i;
  };
  return [...tabs].sort((a, b) => rank(a) - rank(b));
}

/** A fresh id for another instance of `type`, unique across *both* docks —
 * tabs move between them, and two tabs sharing an id would collapse into one. */
export function nextInstanceId(type: PanelTab['type'], tabs: PanelTab[]): string {
  const used = tabs
    .filter((t) => t.type === type)
    .map((t) => Number.parseInt(t.id.slice(type.length + 1), 10))
    .filter((n) => Number.isFinite(n));
  return `${type}:${Math.max(0, ...used) + 1}`;
}

/** Build the tab a view opens as. A singleton's id is its type, which is what
 * makes reopening it find the existing one instead of stacking copies. */
export function instantiate(view: PanelView, allTabs: PanelTab[]): PanelTab {
  return {
    id: view.multi ? nextInstanceId(view.type, allTabs) : view.type,
    type: view.type,
    label: view.label,
    icon: view.icon,
  };
}

/** A File tab is named after the file it holds — with several open, "File"
 * three times over would tell you nothing. */
export function labelFor(ref: FileRef | undefined, fallback: string): string {
  const name = ref?.path.split('/').pop();
  return name || fallback;
}

const basename = (p: string | null | undefined): string =>
  p?.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '';

/** A Terminal tab is named after the folder its shell started in — same reason
 * File tabs carry a filename. Folders repeat where filenames don't, so a
 * second shell in the same place is numbered rather than left ambiguous. */
export function terminalLabel(cwd: string | null | undefined, tabs: PanelTab[], fallback: string): string {
  const name = basename(cwd) || fallback;
  const siblings = tabs.filter(
    (t) => t.type === 'terminal' && (basename(t.cwd) || fallback) === name,
  ).length;
  return siblings ? `${name} ${siblings + 1}` : name;
}

// Terminal tabs are the one kind worth remembering across restarts: a file tab
// is one click from the palette, but a terminal is a place you set up. Only the
// tab comes back — the shell itself died with the app, and the restored tab
// starts a fresh one in the same folder.
const storedTerminals = (tabs: PanelTab[], dock: DockId): StoredTerminal[] =>
  tabs
    .filter((t) => t.type === 'terminal')
    .map((t) => ({ id: t.id, dock, label: t.label, cwd: t.cwd ?? null }));

/** Rebuild the terminal tabs of one dock from the last session. */
export function restoreTerminals(dock: DockId): PanelTab[] {
  return (loadPrefs().terminals ?? [])
    .filter((t) => t.dock === dock)
    .map((t) => ({
      id: t.id,
      type: 'terminal' as const,
      label: t.label,
      icon: 'terminal' as const,
      cwd: t.cwd,
    }));
}

// The two docks hold identical shapes, so every action is written once against
// whichever set of keys the dock maps to.
const KEYS = {
  bottom: { tabs: 'bottomTabs', active: 'activeBottomTab', open: 'bottomPanelOpen' },
  right: { tabs: 'rightTabs', active: 'activeRightTab', open: 'rightPanelOpen' },
} as const;

const DOCKS: DockId[] = ['bottom', 'right'];

export const panelSlice: StateCreator<AppState, [], [], PanelSlice> = (set, get) => {
  const tabsOf = (s: AppState, dock: DockId) => s[KEYS[dock].tabs] as PanelTab[];

  // Stamp a path with the scope it was cited in. One place, so every entry
  // point — picker, link, and whatever opens files next — agrees.
  const refFor = (path: string, root?: string | null): FileRef => {
    const s = get();
    return {
      workspaceId: s.currentWorkspace?.id ?? null,
      path,
      root: root !== undefined ? root : s.activeRoot || s.currentWorkspace?.folders?.[0] || null,
    };
  };

  const show = (dock: DockId, tabId: string) =>
    set({ [KEYS[dock].active]: tabId, [KEYS[dock].open]: true } as Partial<AppState>);

  // Write the terminal tabs of both docks back to prefs. Called after anything
  // that adds or removes one, so the stored list is always the live one.
  const persistTerminals = () => {
    const s = get();
    savePrefs({
      ...loadPrefs(),
      terminals: [
        ...storedTerminals(s.bottomTabs, 'bottom'),
        ...storedTerminals(s.rightTabs, 'right'),
      ],
    });
  };

  return {
    // Both docks start empty apart from the terminals the last session left
    // open — see `restoreTerminals`.
    bottomTabs: restoreTerminals('bottom'),
    activeBottomTab: null,
    bottomPanelOpen: false,

    rightTabs: restoreTerminals('right'),
    activeRightTab: null,
    rightPanelOpen: false,

    setActiveDockTab: (dock, tabId) => set({ [KEYS[dock].active]: tabId } as Partial<AppState>),

    toggleDock: (dock) => set((s) => ({ [KEYS[dock].open]: !s[KEYS[dock].open] } as Partial<AppState>)),

    // An empty dock is a designed state (it shows the "+"), so closing the last
    // tab leaves the dock open — dismissing it is the dock's own X.
    closeDockTab: (dock, tabId) => {
      set((s) => {
        const k = KEYS[dock];
        const tabs = tabsOf(s, dock);
        return {
          [k.tabs]: tabs.filter((t) => t.id !== tabId),
          [k.active]: s[k.active] === tabId ? neighbourOf(tabs, tabId) : s[k.active],
        } as Partial<AppState>;
      });
      persistTerminals();
    },

    openDockTab: (dock, view) => {
      const s = get();
      const all = [...s.bottomTabs, ...s.rightTabs];
      const tab = instantiate(view, all);
      // A terminal is pinned to the folder selected when it opened. Reading it
      // live would make every open shell appear to follow the folder picker,
      // which is not where its shell is actually sitting.
      if (view.type === 'terminal') {
        tab.cwd = s.activeRoot || s.currentWorkspace?.folders?.[0] || null;
        tab.label = terminalLabel(tab.cwd, all, view.label);
      }
      set((cur) => {
        const k = KEYS[dock];
        const other = KEYS[dock === 'bottom' ? 'right' : 'bottom'];
        const tabs = tabsOf(cur, dock);
        const otherTabs = tabsOf(cur, dock === 'bottom' ? 'right' : 'bottom');
        const held = tabs.some((t) => t.id === tab.id);
        return {
          [k.tabs]: held ? tabs : orderTabs([...tabs, tab]),
          [k.active]: tab.id,
          [k.open]: true,
          // Only a singleton is taken from the other dock: a new instance
          // displaces nothing, so its siblings stay where they are.
          [other.tabs]: view.multi ? otherTabs : otherTabs.filter((t) => t.id !== tab.id),
          [other.active]:
            !view.multi && cur[other.active] === tab.id
              ? neighbourOf(otherTabs, tab.id)
              : cur[other.active],
        } as Partial<AppState>;
      });
      if (view.type === 'terminal') persistTerminals();
      return tab.id;
    },

    openFileInTab: (tabId, path, root) => {
      const ref = refFor(path, root);
      const dock = DOCKS.find((d) => tabsOf(get(), d).some((t) => t.id === tabId));
      if (!dock) return;
      set((s) => ({
        [KEYS[dock].tabs]: tabsOf(s, dock).map((t) =>
          t.id === tabId ? { ...t, params: ref, label: labelFor(ref, t.label) } : t,
        ),
      } as Partial<AppState>));
      show(dock, tabId);
    },

    openFile: (path, root) => {
      const s = get();
      const ref = refFor(path, root);

      // Already open somewhere → just show it. Opening the same file twice by
      // accident is noise; two tabs on one file is something you ask for.
      for (const d of DOCKS) {
        const hit = tabsOf(s, d).find(
          (t) => t.params?.path === ref.path && t.params?.workspaceId === ref.workspaceId,
        );
        if (hit) return show(d, hit.id);
      }

      // Otherwise reuse a File tab, preferring the one on screen, so following
      // a link navigates where you were looking.
      const showing = DOCKS.map((d) => tabsOf(s, d).find((t) => t.id === s[KEYS[d].active] && t.type === 'file'))
        .find(Boolean);
      const any = DOCKS.map((d) => tabsOf(s, d).find((t) => t.type === 'file')).find(Boolean);
      const target = showing ?? any;
      if (target) return get().openFileInTab(target.id, path, root);

      // No File tab at all — open one and point it at the file.
      const id = get().openDockTab('right', FILE_VIEW);
      get().openFileInTab(id, path, root);
    },
  };
};
