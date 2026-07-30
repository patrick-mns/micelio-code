// The dock state machine. Everything here is pure state — no React, no IPC —
// so it's tested directly on a store built from the slice plus the two fields
// it reads from the rest of the app.
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import {
  dockOf, panelSlice, parseDock, ptyKey, serializeDock, terminalLabel, VIEW_CATALOG,
  type DockState, type PanelSlice,
} from './panelSlice';
import type { PanelTab, PanelView } from '@/types';

type TestState = PanelSlice & {
  currentWorkspace: { id: string; folders: string[] } | null;
  activeRoot: string | null;
  currentSession: string | null;
};

function makeStore(
  workspace: TestState['currentWorkspace'] = { id: 'ws-1', folders: ['/w/first'] },
  activeRoot: string | null = null,
  currentSession: string | null = 'sess-1',
): UseBoundStore<StoreApi<TestState>> {
  return create<TestState>()((...a) => ({
    // The slice is typed against the whole AppState; here it only ever reads
    // the three fields below.
    ...(panelSlice as unknown as (...args: typeof a) => PanelSlice)(...a),
    currentWorkspace: workspace,
    activeRoot,
    currentSession,
  }));
}

// The strip of whichever session the store is showing — what the UI renders.
const dock = (s: UseBoundStore<StoreApi<TestState>>) => dockOf(s.getState() as never);
const ids = (tabs: PanelTab[]) => tabs.map((t) => t.id);

const view = (type: PanelView['type']) => VIEW_CATALOG.find((v) => v.type === type)!;
const REVIEW = view('review');
const FILE = view('file');
const BG = view('bg-tasks');
const TERMINAL = view('terminal');

describe('singleton views', () => {
  it('opening one twice in a dock keeps a single tab', () => {
    const s = makeStore();
    s.getState().openDockTab('right', REVIEW);
    s.getState().openDockTab('right', REVIEW);

    expect(dock(s).rightTabs.map((t) => t.id)).toEqual(['review']);
  });

  it('opening one that lives in the other dock moves it', () => {
    const s = makeStore();
    s.getState().openDockTab('right', REVIEW);
    s.getState().openDockTab('bottom', REVIEW);

    expect(dock(s).rightTabs).toEqual([]);
    expect(dock(s).bottomTabs.map((t) => t.id)).toEqual(['review']);
    // The dock it left must not keep pointing at a tab it no longer has.
    expect(dock(s).activeRightTab).toBeNull();
    expect(dock(s).activeBottomTab).toBe('review');
  });
});

describe('multi views', () => {
  it('opening one repeatedly stacks instances instead of replacing', () => {
    const s = makeStore();
    s.getState().openDockTab('right', FILE);
    s.getState().openDockTab('right', FILE);

    const ids = dock(s).rightTabs.map((t) => t.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('does not drag its siblings out of the other dock', () => {
    const s = makeStore();
    s.getState().openDockTab('right', FILE);
    s.getState().openDockTab('bottom', FILE);

    // A singleton would have moved; instances coexist.
    expect(dock(s).rightTabs).toHaveLength(1);
    expect(dock(s).bottomTabs).toHaveLength(1);
  });

  it('gives instances ids that are unique across both docks', () => {
    const s = makeStore();
    const a = s.getState().openDockTab('right', FILE);
    const b = s.getState().openDockTab('bottom', FILE);

    // Tabs move between docks, so an id colliding across them would collapse
    // two tabs into one the moment they met.
    expect(a).not.toBe(b);
  });
});

describe('tab order', () => {
  it('appends a new tab at the end whatever kind it is', () => {
    const s = makeStore();
    s.getState().openDockTab('right', FILE);
    s.getState().openDockTab('right', TERMINAL);
    // Earlier in the catalog than both of the above — the case that used to
    // send a new tab to the front of the strip.
    s.getState().openDockTab('right', BG);

    expect(dock(s).rightTabs.map((t) => t.id)).toEqual(['file:1', 'terminal:1', 'bg-tasks']);
  });

  it('keeps the positions of the tabs already open', () => {
    const s = makeStore();
    s.getState().openDockTab('right', BG);
    s.getState().openDockTab('right', FILE);
    const before = dock(s).rightTabs.map((t) => t.id);

    s.getState().openDockTab('right', REVIEW);

    expect(dock(s).rightTabs.map((t) => t.id)).toEqual([...before, 'review']);
  });

  it('reopening a closed singleton puts it back at the end, not its old spot', () => {
    const s = makeStore();
    s.getState().openDockTab('right', BG);
    s.getState().openDockTab('right', FILE);
    s.getState().closeDockTab('right', 'bg-tasks');
    s.getState().openDockTab('right', BG);

    expect(dock(s).rightTabs.map((t) => t.id)).toEqual(['file:1', 'bg-tasks']);
  });
});

describe('openFile', () => {
  it('opens a File tab when there is none, pointed at the path', () => {
    const s = makeStore();
    s.getState().openFile('README.md');

    const [tab] = dock(s).rightTabs;
    expect(tab.type).toBe('file');
    expect(tab.params?.path).toBe('README.md');
    expect(dock(s).rightPanelOpen).toBe(true);
  });

  it('navigates the showing File tab instead of opening another', () => {
    const s = makeStore();
    s.getState().openFile('README.md');
    s.getState().openFile('docs/guide.md');

    expect(dock(s).rightTabs).toHaveLength(1);
    expect(dock(s).rightTabs[0].params?.path).toBe('docs/guide.md');
  });

  it('focuses the tab already holding the file rather than duplicating it', () => {
    const s = makeStore();
    s.getState().openFile('README.md');
    const first = dock(s).rightTabs[0].id;
    // A second tab, showing something else, is the one on screen.
    const second = s.getState().openDockTab('right', FILE);
    s.getState().openFileInTab(second, 'docs/guide.md');

    s.getState().openFile('README.md');

    expect(dock(s).rightTabs).toHaveLength(2);
    expect(dock(s).activeRightTab).toBe(first);
  });

  it('names the tab after the file, since several would all read "File"', () => {
    const s = makeStore();
    s.getState().openFile('docs/architecture.md');

    expect(dock(s).rightTabs[0].label).toBe('architecture.md');
  });

  it('leaves an untouched sibling alone when one tab navigates', () => {
    const s = makeStore();
    const a = s.getState().openDockTab('right', FILE);
    const b = s.getState().openDockTab('right', FILE);
    s.getState().openFileInTab(a, 'a.md');
    s.getState().openFileInTab(b, 'b.md');

    s.getState().openFileInTab(b, 'c.md');

    const byId = Object.fromEntries(dock(s).rightTabs.map((t) => [t.id, t]));
    expect(byId[a].params?.path).toBe('a.md');
    expect(byId[b].params?.path).toBe('c.md');
  });
});

describe('file references carry their scope', () => {
  it('stamps the current workspace and the selected folder', () => {
    const s = makeStore({ id: 'ws-42', folders: ['/w/first'] }, '/w/second');
    s.getState().openFile('README.md');

    expect(dock(s).rightTabs[0].params).toEqual({
      workspaceId: 'ws-42',
      path: 'README.md',
      root: '/w/second',
    });
  });

  it('falls back to the first folder when no folder is selected', () => {
    const s = makeStore({ id: 'ws-42', folders: ['/w/first'] }, null);
    s.getState().openFile('README.md');

    expect(dock(s).rightTabs[0].params?.root).toBe('/w/first');
  });

  it('keeps an explicitly cited folder, which is what a link in a document is', () => {
    const s = makeStore({ id: 'ws-42', folders: ['/w/first'] }, '/w/second');
    // The document lives in another folder than the selected one; its links
    // are relative to *it*, not to whatever happens to be selected.
    s.getState().openFile('docs/guide.md', '/w/third');

    expect(dock(s).rightTabs[0].params?.root).toBe('/w/third');
  });

  it('treats the same path in another workspace as a different file', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/first'] });
    s.getState().openFile('README.md');
    const first = dock(s).rightTabs[0].id;

    s.setState({ currentWorkspace: { id: 'ws-2', folders: ['/w/other'] } });
    s.getState().openFile('README.md');

    // Same path, different project: it must not be mistaken for the open one.
    expect(dock(s).rightTabs).toHaveLength(1);
    expect(dock(s).rightTabs[0].id).toBe(first);
    expect(dock(s).rightTabs[0].params?.workspaceId).toBe('ws-2');
  });
});

describe('terminals', () => {
  it('pins the shell to the folder selected when it opened', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/first'] }, '/w/second');
    const id = s.getState().openDockTab('bottom', TERMINAL);

    // Selecting another folder afterwards must not appear to move a shell
    // that is still sitting where it was started.
    s.setState({ activeRoot: '/w/third' });

    expect(dock(s).bottomTabs.find((t) => t.id === id)?.cwd).toBe('/w/second');
  });

  it('falls back to the first folder when none is selected', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/first'] }, null);
    s.getState().openDockTab('bottom', TERMINAL);

    expect(dock(s).bottomTabs[0].cwd).toBe('/w/first');
  });

  it('names a tab after its folder, numbering repeats in the same one', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/api'] }, '/w/api');
    s.getState().openDockTab('bottom', TERMINAL);
    s.getState().openDockTab('bottom', TERMINAL);

    expect(dock(s).bottomTabs.map((t) => t.label)).toEqual(['api', 'api 2']);
  });

  it('numbers across both docks, since a tab can be in either', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/api'] }, '/w/api');
    s.getState().openDockTab('bottom', TERMINAL);
    s.getState().openDockTab('right', TERMINAL);

    expect(dock(s).bottomTabs[0].label).toBe('api');
    expect(dock(s).rightTabs[0].label).toBe('api 2');
  });

  it('leaves terminals in other folders out of the count', () => {
    const tabs: PanelTab[] = [
      { id: 'terminal:1', type: 'terminal', label: 'api', cwd: '/w/api' },
      { id: 'terminal:2', type: 'terminal', label: 'web', cwd: '/w/web' },
    ];

    expect(terminalLabel('/w/api', tabs, 'Terminal')).toBe('api 2');
  });

  it('falls back to the view name when there is no folder at all', () => {
    expect(terminalLabel(null, [], 'Terminal')).toBe('Terminal');
  });
});

describe('the strip belongs to a session', () => {
  // What the app does on a session change: point at it, then install whatever
  // strip was stored for it (nothing, here — persistence is the hook's job).
  const switchTo = (s: UseBoundStore<StoreApi<TestState>>, sessionId: string) => {
    s.setState({ currentSession: sessionId } as Partial<TestState>);
    s.getState().hydrateDock(sessionId, null);
  };

  it('gives each session its own tabs', () => {
    const s = makeStore();
    s.getState().openDockTab('right', FILE);

    switchTo(s, 'sess-2');

    expect(dock(s).rightTabs).toEqual([]);
  });

  it('gives them back on return, untouched', () => {
    const s = makeStore();
    s.getState().openFile('README.md');
    switchTo(s, 'sess-2');
    s.getState().openDockTab('right', REVIEW);

    switchTo(s, 'sess-1');

    expect(ids(dock(s).rightTabs)).toEqual(['file:1']);
    expect(dock(s).rightTabs[0].params?.path).toBe('README.md');
  });

  it('opens a tab in the showing session only', () => {
    const s = makeStore();
    switchTo(s, 'sess-2');
    s.getState().openDockTab('bottom', TERMINAL);

    expect(ids(dock(s).bottomTabs)).toEqual(['terminal:1']);
    expect(s.getState().docks['sess-1']).toBeUndefined();
  });

  it('keeps whether each dock was open per session', () => {
    const s = makeStore();
    s.getState().openDockTab('bottom', TERMINAL);
    expect(dock(s).bottomPanelOpen).toBe(true);

    switchTo(s, 'sess-2');

    expect(dock(s).bottomPanelOpen).toBe(false);
  });

  it('does nothing when there is no session to own the tab', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/first'] }, null, null);

    s.getState().openDockTab('right', FILE);

    expect(dock(s).rightTabs).toEqual([]);
    expect(s.getState().docks).toEqual({});
  });

  it('forgets a deleted session\'s strip and leaves the others alone', () => {
    const s = makeStore();
    s.getState().openDockTab('right', FILE);
    switchTo(s, 'sess-2');
    s.getState().openDockTab('right', FILE);

    s.getState().dropDock('sess-1');

    expect(s.getState().docks['sess-1']).toBeUndefined();
    expect(ids(dock(s).rightTabs)).toEqual(['file:1']);
  });

  it('re-mints instance ids per session, so ptyKey is what keeps shells apart', () => {
    const s = makeStore();
    const first = s.getState().openDockTab('bottom', TERMINAL);
    switchTo(s, 'sess-2');
    const second = s.getState().openDockTab('bottom', TERMINAL);

    // The tab ids collide by design — they're only unique within a strip.
    expect(second).toBe(first);
    // What reaches the backend does not.
    expect(ptyKey('sess-2', second)).not.toBe(ptyKey('sess-1', first));
  });
});

describe('storing a strip', () => {
  const strip = (over: Partial<DockState> = {}): DockState => ({
    bottomTabs: [],
    activeBottomTab: null,
    bottomPanelOpen: false,
    rightTabs: [],
    activeRightTab: null,
    rightPanelOpen: false,
    ...over,
  });

  it('round-trips the layout, including what each tab holds', () => {
    const before = strip({
      rightTabs: [
        { id: 'file:1', type: 'file', label: 'a.ts', icon: 'file', params: { workspaceId: 'ws-1', path: 'src/a.ts', root: '/w' }, cwd: null },
        { id: 'terminal:1', type: 'terminal', label: 'w', icon: 'terminal', cwd: '/w' },
      ],
      activeRightTab: 'terminal:1',
      rightPanelOpen: true,
    });

    expect(parseDock(serializeDock(before))).toEqual(before);
  });

  it('reads a session that never had a strip as none at all', () => {
    expect(parseDock('')).toBeNull();
  });

  it('refuses a row it cannot make sense of, rather than half-reading it', () => {
    expect(parseDock('not json')).toBeNull();
    expect(parseDock('{"dock":{}}')).toBeNull();
    // A future format is unreadable by this build, which is the point of `v`.
    expect(parseDock(JSON.stringify({ v: 99, dock: strip() }))).toBeNull();
  });

  it('drops a tab of a view this build no longer has', () => {
    const json = JSON.stringify({
      v: 1,
      dock: { ...strip(), rightTabs: [{ id: 'ghost:1', type: 'ghost', label: 'Ghost' }] },
    });

    expect(parseDock(json)?.rightTabs).toEqual([]);
  });

  it('re-points an active id that names a tab which did not survive', () => {
    const json = JSON.stringify({
      v: 1,
      dock: {
        ...strip(),
        rightTabs: [{ id: 'file:1', type: 'file', label: 'a.ts' }],
        activeRightTab: 'ghost:1',
      },
    });

    expect(parseDock(json)?.activeRightTab).toBe('file:1');
  });

  it('will not restore an empty dock as open, which would show a launcher nobody asked for', () => {
    const json = JSON.stringify({ v: 1, dock: strip({ rightPanelOpen: true }) });

    expect(parseDock(json)?.rightPanelOpen).toBe(false);
  });
});

describe('closing', () => {
  it('hands focus to the neighbour — the tab that takes the closed one\'s place', () => {
    const s = makeStore();
    const a = s.getState().openDockTab('right', FILE);
    const b = s.getState().openDockTab('right', FILE);
    s.getState().openDockTab('right', REVIEW);
    s.getState().setActiveDockTab('right', b);

    s.getState().closeDockTab('right', b);

    expect(dock(s).rightTabs.map((t) => t.id)).toEqual([a, 'review']);
    expect(dock(s).activeRightTab).toBe('review');
  });

  it('falls back to the tab on the left when the closed one was last', () => {
    const s = makeStore();
    const a = s.getState().openDockTab('right', FILE);
    const b = s.getState().openDockTab('right', FILE);
    s.getState().setActiveDockTab('right', b);

    s.getState().closeDockTab('right', b);

    expect(dock(s).activeRightTab).toBe(a);
  });

  it('leaves the dock open on the last tab, since empty is a designed state', () => {
    const s = makeStore();
    s.getState().openDockTab('right', BG);
    s.getState().closeDockTab('right', 'bg-tasks');

    expect(dock(s).rightTabs).toEqual([]);
    expect(dock(s).rightPanelOpen).toBe(true);
    expect(dock(s).activeRightTab).toBeNull();
  });
});
