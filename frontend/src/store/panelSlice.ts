// Dock state — which tabs are open in the bottom/right docks and which one each
// is showing. Docks are generic: any view in the catalog can be opened in
// either one, so the same view can be moved from the side to the bottom.
//
// A tab is an *instance* of a view, not the view itself: its identity is its
// id, and `params`/`cwd` carry what makes it that instance (which file, which
// folder). That's what lets one dock hold several files — or several terminals
// — at once, instead of a single slot per kind.
//
// The whole strip belongs to a *chat session*. `docks` is keyed by session id
// and the showing session's entry is the live one, so switching conversation
// swaps the strip instead of every view having to notice the change itself. It
// follows the grain the rest of the app already uses — `session_histories`,
// `session_cancels`, `pending_confirm` and `session_tool_allow` are all keyed
// this way — and it gives tabs a lifecycle they didn't have: deleting a session
// takes its tabs, and its shells, with it.
//
// A session lives inside one workspace (`sessions.db` is per workspace), so
// keying by session scopes the strip to the workspace for free.
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

/** One session's strip: both docks, what each is showing, and whether each is
 * up. Opening a dock is part of the layout too — coming back to a conversation
 * should find it as you left it. */
export interface DockState {
  bottomTabs: PanelTab[];
  activeBottomTab: string | null;
  bottomPanelOpen: boolean;

  rightTabs: PanelTab[];
  activeRightTab: string | null;
  rightPanelOpen: boolean;
}

// Shared, frozen, and returned by reference for any session without a strip
// yet, so a selector reading it doesn't hand React a new object every render.
export const EMPTY_DOCK: DockState = Object.freeze({
  bottomTabs: Object.freeze([]) as unknown as PanelTab[],
  activeBottomTab: null,
  bottomPanelOpen: false,
  rightTabs: Object.freeze([]) as unknown as PanelTab[],
  activeRightTab: null,
  rightPanelOpen: false,
});

export interface PanelSlice {
  /** Every session's strip, by session id. Sessions appear here as they're
   * visited; the showing one is what the UI renders. */
  docks: Record<string, DockState>;

  /** Build the strip for `sessionId` if this run hasn't seen it yet, restoring
   * the terminal tabs it had. Called when the showing session changes. */
  ensureDock: (sessionId: string) => void;
  /** Forget a session's strip — for a deleted conversation. Killing its shells
   * is the caller's job, since that's IPC and this slice is pure state. */
  dropDock: (sessionId: string) => void;

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

/** The strip of the showing session — what every consumer renders from. */
export const dockOf = (s: Pick<AppState, 'docks' | 'currentSession'>): DockState =>
  (s.currentSession ? s.docks[s.currentSession] : undefined) ?? EMPTY_DOCK;

/** The pty registry's key for a terminal tab.
 *
 * Tab ids are only unique inside one session's strip, and the registry in Rust
 * is a single global map — so `terminal:1` opened in two conversations would
 * attach both tabs to the same shell. The session makes it unique, and session
 * ids are hex nanoseconds, so they don't collide across workspaces either. */
export const ptyKey = (sessionId: string, tabId: string): string => `${sessionId}:${tabId}`;

// Closing a tab hands focus to its neighbour rather than jumping to the first,
// which is what every tabbed UI does and what the eye expects.
export function neighbourOf(tabs: PanelTab[], closedId: string): string | null {
  const i = tabs.findIndex((t) => t.id === closedId);
  if (i === -1) return tabs[0]?.id ?? null;
  const rest = tabs.filter((t) => t.id !== closedId);
  return (rest[i] ?? rest[i - 1] ?? rest[0])?.id ?? null;
}

/** A fresh id for another instance of `type`, unique across *both* docks of the
 * session — tabs move between them, and two tabs sharing an id would collapse
 * into one. Ids restart per session; `ptyKey` is what keeps the backend apart. */
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

// The two docks hold identical shapes, so every action is written once against
// whichever set of keys the dock maps to.
const KEYS = {
  bottom: { tabs: 'bottomTabs', active: 'activeBottomTab', open: 'bottomPanelOpen' },
  right: { tabs: 'rightTabs', active: 'activeRightTab', open: 'rightPanelOpen' },
} as const;

const DOCKS: DockId[] = ['bottom', 'right'];

// Terminal tabs are the one kind worth remembering across restarts: a file tab
// is one click from the palette, but a terminal is a place you set up. Only the
// tab comes back — the shell itself died with the app, and the restored tab
// starts a fresh one in the same folder.
const storedTerminals = (docks: Record<string, DockState>): StoredTerminal[] => {
  const rows: StoredTerminal[] = [];
  for (const [sessionId, d] of Object.entries(docks)) {
    for (const dock of DOCKS) {
      for (const t of d[KEYS[dock].tabs]) {
        if (t.type === 'terminal') {
          rows.push({ sessionId, id: t.id, dock, label: t.label, cwd: t.cwd ?? null });
        }
      }
    }
  }
  return rows;
};

/** The strip `sessionId` left behind, or an empty one. */
export function restoredDock(sessionId: string): DockState {
  const rows = (loadPrefs().terminals ?? []).filter((t) => t.sessionId === sessionId);
  const tabsFor = (dock: DockId): PanelTab[] =>
    rows
      .filter((t) => t.dock === dock)
      .map((t) => ({
        id: t.id,
        type: 'terminal' as const,
        label: t.label,
        icon: 'terminal' as const,
        cwd: t.cwd,
      }));
  const bottomTabs = tabsFor('bottom');
  const rightTabs = tabsFor('right');
  return {
    bottomTabs,
    activeBottomTab: bottomTabs[0]?.id ?? null,
    // Restoring tabs doesn't reopen the dock: coming back to a conversation
    // shouldn't take over the window, and the toggle still shows what's there.
    bottomPanelOpen: false,
    rightTabs,
    activeRightTab: rightTabs[0]?.id ?? null,
    rightPanelOpen: false,
  };
}

export const panelSlice: StateCreator<AppState, [], [], PanelSlice> = (set, get) => {
  const dockFor = (s: AppState, sessionId: string) => s.docks[sessionId] ?? EMPTY_DOCK;
  const tabsOf = (d: DockState, dock: DockId) => d[KEYS[dock].tabs];

  // Every mutation runs through here, so "which session owns this" is answered
  // once. No session (the last conversation was just deleted, or onboarding
  // hasn't finished) means there's no strip to write to.
  const patch = (fn: (d: DockState, s: AppState) => Partial<DockState>) =>
    set((s) => {
      const sid = s.currentSession;
      if (!sid) return {};
      const current = dockFor(s, sid);
      return { docks: { ...s.docks, [sid]: { ...current, ...fn(current, s) } } };
    });

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
    patch(() => ({ [KEYS[dock].active]: tabId, [KEYS[dock].open]: true }) as Partial<DockState>);

  // Rewrite the stored terminal list from the strips this run has loaded, and
  // keep the rows of every session it hasn't — otherwise visiting one
  // conversation would erase the remembered terminals of all the others.
  const persistTerminals = () => {
    const prefs = loadPrefs();
    const loaded = new Set(Object.keys(get().docks));
    const untouched = (prefs.terminals ?? []).filter((t) => !loaded.has(t.sessionId));
    savePrefs({ ...prefs, terminals: [...untouched, ...storedTerminals(get().docks)] });
  };

  return {
    docks: {},

    ensureDock: (sessionId) =>
      set((s) => (s.docks[sessionId] ? {} : { docks: { ...s.docks, [sessionId]: restoredDock(sessionId) } })),

    dropDock: (sessionId) => {
      set((s) => {
        if (!s.docks[sessionId]) return {};
        const { [sessionId]: _gone, ...rest } = s.docks;
        return { docks: rest };
      });
      persistTerminals();
    },

    setActiveDockTab: (dock, tabId) => patch(() => ({ [KEYS[dock].active]: tabId }) as Partial<DockState>),

    toggleDock: (dock) => patch((d) => ({ [KEYS[dock].open]: !d[KEYS[dock].open] }) as Partial<DockState>),

    // An empty dock is a designed state (it shows the "+"), so closing the last
    // tab leaves the dock open — dismissing it is the dock's own X.
    closeDockTab: (dock, tabId) => {
      patch((d) => {
        const k = KEYS[dock];
        const tabs = tabsOf(d, dock);
        return {
          [k.tabs]: tabs.filter((t) => t.id !== tabId),
          [k.active]: d[k.active] === tabId ? neighbourOf(tabs, tabId) : d[k.active],
        } as Partial<DockState>;
      });
      persistTerminals();
    },

    openDockTab: (dock, view) => {
      const s = get();
      const sid = s.currentSession;
      const live = sid ? dockFor(s, sid) : EMPTY_DOCK;
      const all = [...live.bottomTabs, ...live.rightTabs];
      const tab = instantiate(view, all);
      // A terminal is pinned to the folder selected when it opened. Reading it
      // live would make every open shell appear to follow the folder picker,
      // which is not where its shell is actually sitting.
      if (view.type === 'terminal') {
        tab.cwd = s.activeRoot || s.currentWorkspace?.folders?.[0] || null;
        tab.label = terminalLabel(tab.cwd, all, view.label);
      }
      patch((d) => {
        const k = KEYS[dock];
        const other = KEYS[dock === 'bottom' ? 'right' : 'bottom'];
        const tabs = tabsOf(d, dock);
        const otherTabs = tabsOf(d, dock === 'bottom' ? 'right' : 'bottom');
        const held = tabs.some((t) => t.id === tab.id);
        return {
          // Appended, never sorted. Tabs used to be kept in catalog order, which
          // meant opening a Background or Review tab pushed it in front of files
          // and terminals already open — you asked for a tab and it appeared
          // somewhere other than where you were looking. Position now records
          // the order you opened things in, like every other tabbed UI.
          [k.tabs]: held ? tabs : [...tabs, tab],
          [k.active]: tab.id,
          [k.open]: true,
          // Only a singleton is taken from the other dock: a new instance
          // displaces nothing, so its siblings stay where they are.
          [other.tabs]: view.multi ? otherTabs : otherTabs.filter((t) => t.id !== tab.id),
          [other.active]:
            !view.multi && d[other.active] === tab.id
              ? neighbourOf(otherTabs, tab.id)
              : d[other.active],
        } as Partial<DockState>;
      });
      if (view.type === 'terminal') persistTerminals();
      return tab.id;
    },

    openFileInTab: (tabId, path, root) => {
      const ref = refFor(path, root);
      const live = dockOf(get());
      const dock = DOCKS.find((d) => tabsOf(live, d).some((t) => t.id === tabId));
      if (!dock) return;
      patch((d) => ({
        [KEYS[dock].tabs]: tabsOf(d, dock).map((t) =>
          t.id === tabId ? { ...t, params: ref, label: labelFor(ref, t.label) } : t,
        ),
      }) as Partial<DockState>);
      show(dock, tabId);
    },

    openFile: (path, root) => {
      const live = dockOf(get());
      const ref = refFor(path, root);

      // Already open somewhere → just show it. Opening the same file twice by
      // accident is noise; two tabs on one file is something you ask for.
      for (const d of DOCKS) {
        const hit = tabsOf(live, d).find(
          (t) => t.params?.path === ref.path && t.params?.workspaceId === ref.workspaceId,
        );
        if (hit) return show(d, hit.id);
      }

      // Otherwise reuse a File tab, preferring the one on screen, so following
      // a link navigates where you were looking.
      const showing = DOCKS.map((d) => tabsOf(live, d).find((t) => t.id === live[KEYS[d].active] && t.type === 'file'))
        .find(Boolean);
      const any = DOCKS.map((d) => tabsOf(live, d).find((t) => t.type === 'file')).find(Boolean);
      const target = showing ?? any;
      if (target) return get().openFileInTab(target.id, path, root);

      // No File tab at all — open one and point it at the file.
      const id = get().openDockTab('right', FILE_VIEW);
      get().openFileInTab(id, path, root);
    },
  };
};
