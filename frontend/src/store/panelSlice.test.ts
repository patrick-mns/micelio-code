// The dock state machine. Everything here is pure state — no React, no IPC —
// so it's tested directly on a store built from the slice plus the two fields
// it reads from the rest of the app.
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { labelledFor, panelSlice, terminalLabel, VIEW_CATALOG, type PanelSlice } from './panelSlice';
import type { PanelTab, PanelView } from '@/types';

type TestState = PanelSlice & {
  currentWorkspace: { id: string; folders: string[] } | null;
  activeRoot: string | null;
};

function makeStore(
  workspace: TestState['currentWorkspace'] = { id: 'ws-1', folders: ['/w/first'] },
  activeRoot: string | null = null,
): UseBoundStore<StoreApi<TestState>> {
  return create<TestState>()((...a) => ({
    // The slice is typed against the whole AppState; here it only ever reads
    // `currentWorkspace` and `activeRoot`, which the two fields below supply.
    ...(panelSlice as unknown as (...args: typeof a) => PanelSlice)(...a),
    currentWorkspace: workspace,
    activeRoot,
  }));
}

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

    expect(s.getState().rightTabs.map((t) => t.id)).toEqual(['review']);
  });

  it('opening one that lives in the other dock moves it', () => {
    const s = makeStore();
    s.getState().openDockTab('right', REVIEW);
    s.getState().openDockTab('bottom', REVIEW);

    expect(s.getState().rightTabs).toEqual([]);
    expect(s.getState().bottomTabs.map((t) => t.id)).toEqual(['review']);
    // The dock it left must not keep pointing at a tab it no longer has.
    expect(s.getState().activeRightTab).toBeNull();
    expect(s.getState().activeBottomTab).toBe('review');
  });
});

describe('multi views', () => {
  it('opening one repeatedly stacks instances instead of replacing', () => {
    const s = makeStore();
    s.getState().openDockTab('right', FILE);
    s.getState().openDockTab('right', FILE);

    const ids = s.getState().rightTabs.map((t) => t.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('does not drag its siblings out of the other dock', () => {
    const s = makeStore();
    s.getState().openDockTab('right', FILE);
    s.getState().openDockTab('bottom', FILE);

    // A singleton would have moved; instances coexist.
    expect(s.getState().rightTabs).toHaveLength(1);
    expect(s.getState().bottomTabs).toHaveLength(1);
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

    expect(s.getState().rightTabs.map((t) => t.id)).toEqual(['file:1', 'terminal:1', 'bg-tasks']);
  });

  it('keeps the positions of the tabs already open', () => {
    const s = makeStore();
    s.getState().openDockTab('right', BG);
    s.getState().openDockTab('right', FILE);
    const before = s.getState().rightTabs.map((t) => t.id);

    s.getState().openDockTab('right', REVIEW);

    expect(s.getState().rightTabs.map((t) => t.id)).toEqual([...before, 'review']);
  });

  it('reopening a closed singleton puts it back at the end, not its old spot', () => {
    const s = makeStore();
    s.getState().openDockTab('right', BG);
    s.getState().openDockTab('right', FILE);
    s.getState().closeDockTab('right', 'bg-tasks');
    s.getState().openDockTab('right', BG);

    expect(s.getState().rightTabs.map((t) => t.id)).toEqual(['file:1', 'bg-tasks']);
  });
});

describe('openFile', () => {
  it('opens a File tab when there is none, pointed at the path', () => {
    const s = makeStore();
    s.getState().openFile('README.md');

    const [tab] = s.getState().rightTabs;
    expect(tab.type).toBe('file');
    expect(tab.params?.path).toBe('README.md');
    expect(s.getState().rightPanelOpen).toBe(true);
  });

  it('navigates the showing File tab instead of opening another', () => {
    const s = makeStore();
    s.getState().openFile('README.md');
    s.getState().openFile('docs/guide.md');

    expect(s.getState().rightTabs).toHaveLength(1);
    expect(s.getState().rightTabs[0].params?.path).toBe('docs/guide.md');
  });

  it('focuses the tab already holding the file rather than duplicating it', () => {
    const s = makeStore();
    s.getState().openFile('README.md');
    const first = s.getState().rightTabs[0].id;
    // A second tab, showing something else, is the one on screen.
    const second = s.getState().openDockTab('right', FILE);
    s.getState().openFileInTab(second, 'docs/guide.md');

    s.getState().openFile('README.md');

    expect(s.getState().rightTabs).toHaveLength(2);
    expect(s.getState().activeRightTab).toBe(first);
  });

  it('names the tab after the file, since several would all read "File"', () => {
    const s = makeStore();
    s.getState().openFile('docs/architecture.md');

    expect(s.getState().rightTabs[0].label).toBe('architecture.md');
  });

  it('leaves an untouched sibling alone when one tab navigates', () => {
    const s = makeStore();
    const a = s.getState().openDockTab('right', FILE);
    const b = s.getState().openDockTab('right', FILE);
    s.getState().openFileInTab(a, 'a.md');
    s.getState().openFileInTab(b, 'b.md');

    s.getState().openFileInTab(b, 'c.md');

    const byId = Object.fromEntries(s.getState().rightTabs.map((t) => [t.id, t]));
    expect(byId[a].params?.path).toBe('a.md');
    expect(byId[b].params?.path).toBe('c.md');
  });
});

describe('file references carry their scope', () => {
  it('stamps the current workspace and the selected folder', () => {
    const s = makeStore({ id: 'ws-42', folders: ['/w/first'] }, '/w/second');
    s.getState().openFile('README.md');

    expect(s.getState().rightTabs[0].params).toEqual({
      workspaceId: 'ws-42',
      path: 'README.md',
      root: '/w/second',
    });
  });

  it('falls back to the first folder when no folder is selected', () => {
    const s = makeStore({ id: 'ws-42', folders: ['/w/first'] }, null);
    s.getState().openFile('README.md');

    expect(s.getState().rightTabs[0].params?.root).toBe('/w/first');
  });

  it('keeps an explicitly cited folder, which is what a link in a document is', () => {
    const s = makeStore({ id: 'ws-42', folders: ['/w/first'] }, '/w/second');
    // The document lives in another folder than the selected one; its links
    // are relative to *it*, not to whatever happens to be selected.
    s.getState().openFile('docs/guide.md', '/w/third');

    expect(s.getState().rightTabs[0].params?.root).toBe('/w/third');
  });

  it('treats the same path in another workspace as a different file', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/first'] });
    s.getState().openFile('README.md');
    const first = s.getState().rightTabs[0].id;

    s.setState({ currentWorkspace: { id: 'ws-2', folders: ['/w/other'] } });
    s.getState().openFile('README.md');

    // Same path, different project: it must not be mistaken for the open one.
    expect(s.getState().rightTabs).toHaveLength(1);
    expect(s.getState().rightTabs[0].id).toBe(first);
    expect(s.getState().rightTabs[0].params?.workspaceId).toBe('ws-2');
  });
});

describe('terminals', () => {
  it('pins the shell to the folder selected when it opened', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/first'] }, '/w/second');
    const id = s.getState().openDockTab('bottom', TERMINAL);

    // Selecting another folder afterwards must not appear to move a shell
    // that is still sitting where it was started.
    s.setState({ activeRoot: '/w/third' });

    expect(s.getState().bottomTabs.find((t) => t.id === id)?.cwd).toBe('/w/second');
  });

  it('falls back to the first folder when none is selected', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/first'] }, null);
    s.getState().openDockTab('bottom', TERMINAL);

    expect(s.getState().bottomTabs[0].cwd).toBe('/w/first');
  });

  it('names a tab after its folder, numbering repeats in the same one', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/api'] }, '/w/api');
    s.getState().openDockTab('bottom', TERMINAL);
    s.getState().openDockTab('bottom', TERMINAL);

    expect(s.getState().bottomTabs.map((t) => t.label)).toEqual(['api', 'api 2']);
  });

  it('numbers across both docks, since a tab can be in either', () => {
    const s = makeStore({ id: 'ws-1', folders: ['/w/api'] }, '/w/api');
    s.getState().openDockTab('bottom', TERMINAL);
    s.getState().openDockTab('right', TERMINAL);

    expect(s.getState().bottomTabs[0].label).toBe('api');
    expect(s.getState().rightTabs[0].label).toBe('api 2');
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

describe('tab labels across a workspace switch', () => {
  const fileTab = (id: string, label: string, workspaceId: string | null): PanelTab => ({
    id,
    type: 'file',
    label,
    params: { workspaceId, path: 'src/a.ts', root: '/w/first' },
  });

  it('drops the filename from a tab whose file belongs to another workspace', () => {
    const tabs = [fileTab('file:1', 'a.ts', 'ws-1')];

    expect(labelledFor(tabs, 'ws-2').map((t) => t.label)).toEqual(['File']);
  });

  it('leaves tabs of the current workspace named after their file', () => {
    const tabs = [fileTab('file:1', 'a.ts', 'ws-1')];

    expect(labelledFor(tabs, 'ws-1')).toBe(tabs);
  });

  it('renames only the stale ones, and keeps other kinds alone', () => {
    const tabs: PanelTab[] = [
      fileTab('file:1', 'a.ts', 'ws-1'),
      fileTab('file:2', 'b.ts', 'ws-2'),
      // Named after its folder, which a workspace switch doesn't invalidate —
      // the shell is still running there.
      { id: 'terminal:1', type: 'terminal', label: 'first', cwd: '/w/first' },
      { id: 'review', type: 'review', label: 'Review' },
    ];

    expect(labelledFor(tabs, 'ws-2').map((t) => t.label)).toEqual(['File', 'b.ts', 'first', 'Review']);
  });

  it('leaves a File tab that never held a file alone', () => {
    const tabs: PanelTab[] = [{ id: 'file:1', type: 'file', label: 'File' }];

    expect(labelledFor(tabs, 'ws-9')).toBe(tabs);
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

    expect(s.getState().rightTabs.map((t) => t.id)).toEqual([a, 'review']);
    expect(s.getState().activeRightTab).toBe('review');
  });

  it('falls back to the tab on the left when the closed one was last', () => {
    const s = makeStore();
    const a = s.getState().openDockTab('right', FILE);
    const b = s.getState().openDockTab('right', FILE);
    s.getState().setActiveDockTab('right', b);

    s.getState().closeDockTab('right', b);

    expect(s.getState().activeRightTab).toBe(a);
  });

  it('leaves the dock open on the last tab, since empty is a designed state', () => {
    const s = makeStore();
    s.getState().openDockTab('right', BG);
    s.getState().closeDockTab('right', 'bg-tasks');

    expect(s.getState().rightTabs).toEqual([]);
    expect(s.getState().rightPanelOpen).toBe(true);
    expect(s.getState().activeRightTab).toBeNull();
  });
});
