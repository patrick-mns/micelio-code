import { type StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { type AppState } from './index';

export interface Workspace {
  id: string;
  name: string;
  folders: string[];
}

export interface SessionBrief {
  id: string;
  title: string;
  message_count: number;
  active: boolean;
}

export interface WorkspaceWithSessions {
  id: string;
  name: string;
  folders: string[];
  sessions: SessionBrief[];
  is_current: boolean;
}

export interface WorkspaceSlice {
  currentWorkspace: Workspace | null;
  workspacesWithSessions: WorkspaceWithSessions[];
  workspaceLoading: boolean;
  expandedWorkspaces: string[];

  loadCurrentWorkspace: () => Promise<Workspace | null>;
  loadWorkspacesWithSessions: () => Promise<void>;
  /** Rebuild the graph for the current workspace's folders in the background
   *  (shows the scan overlay, non-blocking). No-op when there are no folders. */
  backgroundScan: () => void;
  toggleExpandedWorkspace: (id: string) => void;
  createWorkspace: (name: string, folders: string[]) => Promise<Workspace>;
  switchWorkspace: (id: string) => Promise<Workspace>;
  addFolderToWorkspace: (path: string) => Promise<Workspace>;
  removeFolderFromWorkspace: (path: string) => Promise<Workspace>;
  renameWorkspace: (name: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
}

export const workspaceSlice: StateCreator<
  AppState,
  [],
  [],
  WorkspaceSlice
> = (set, get) => ({
  currentWorkspace: null,
  workspacesWithSessions: [],
  workspaceLoading: false,
  expandedWorkspaces: [],

  loadCurrentWorkspace: async () => {
    set({ workspaceLoading: true });
    try {
      // null when the app has no workspaces yet (fresh install / all deleted).
      const ws = await invoke<Workspace | null>('get_current_workspace');
      set({ currentWorkspace: ws, expandedWorkspaces: ws ? [ws.id] : [] });
      return ws;
    } catch (e) {
      console.error('Failed to load current workspace', e);
      return null;
    } finally {
      set({ workspaceLoading: false });
    }
  },

  loadWorkspacesWithSessions: async () => {
    try {
      const list = await invoke<WorkspaceWithSessions[]>('list_all_workspaces_with_sessions');
      // `is_current` is authoritative: it's set exactly when a workspace is
      // loaded, and absent in the empty onboarding state — so fall back to null
      // (not the stale previous value) when nothing is current.
      const current = list.find((w) => w.is_current) ?? null;
      set((s) => ({
        workspacesWithSessions: list,
        currentWorkspace: current,
        expandedWorkspaces:
          s.expandedWorkspaces.length > 0
            ? s.expandedWorkspaces
            : current ? [current.id] : [],
      }));
    } catch (e) {
      console.error('Failed to load workspaces with sessions', e);
    }
  },

  backgroundScan: () => {
    const folders = get().currentWorkspace?.folders ?? [];
    // Nothing to do only when there are no folders AND no stale graph to clear.
    // (With no folders the scan simply empties the graph.)
    if (folders.length === 0 && get().graphNodes.length === 0) return;
    get().setScanning(true);
    invoke<void>('scan_workspace')
      .then(() => get().refreshGraph())
      .catch((e) => console.error('background scan failed', e))
      .finally(() => get().setScanning(false));
  },

  toggleExpandedWorkspace: (id) =>
    set((s) => ({
      expandedWorkspaces: s.expandedWorkspaces.includes(id)
        ? s.expandedWorkspaces.filter((e) => e !== id)
        : [...s.expandedWorkspaces, id],
    })),

  createWorkspace: async (name, folders) => {
    set({ workspaceLoading: true });
    try {
      const ws = await invoke<Workspace>('create_workspace', { name, folders });
      set({ currentWorkspace: ws });
      await get().loadWorkspacesWithSessions();
      await get().loadSessions();
      await get().refreshGraph();
      // A fresh workspace starts with no sessions; clear the stale pointer so
      // the chat drops the previous workspace's conversation.
      const target = get().workspacesWithSessions.find((w) => w.id === ws.id);
      get().setCurrentSession(target?.sessions.find((s) => s.active)?.id ?? null);
      // Build the graph in the background so creation returns instantly instead
      // of freezing on a synchronous scan of the chosen folder(s).
      get().backgroundScan();
      return ws;
    } finally {
      set({ workspaceLoading: false });
    }
  },

  switchWorkspace: async (id) => {
    set({ workspaceLoading: true });
    try {
      const ws = await invoke<Workspace>('switch_workspace', { id });
      set({ currentWorkspace: ws });
      await get().loadWorkspacesWithSessions();
      await get().loadSessions(); // Reload sessions to update the central sessions list immediately on switch workspace!
      await get().refreshGraph();
      // The backend switched its active session to the new workspace's latest.
      // Sync the frontend currentSession too, otherwise it stays pinned to the
      // previous workspace's (now-unreachable) session and the chat never
      // reloads — making it look like the switch had no effect.
      const target = get().workspacesWithSessions.find((w) => w.id === ws.id);
      const activeSession =
        target?.sessions.find((s) => s.active)?.id ?? target?.sessions[0]?.id ?? null;
      get().setCurrentSession(activeSession);
      // The switch loads the workspace's saved graph. If it has none yet (never
      // scanned), build it in the background.
      if (get().graphNodes.length === 0) get().backgroundScan();
      return ws;
    } finally {
      set({ workspaceLoading: false });
    }
  },

  addFolderToWorkspace: async (path) => {
    try {
      const ws = await invoke<Workspace>('add_folder_to_workspace', { folderPath: path });
      set({ currentWorkspace: ws });
      await get().loadWorkspacesWithSessions();
      // Folders changed → rebuild the graph in the background (backend no
      // longer scans inline, so this won't freeze on a large folder).
      get().backgroundScan();
      return ws;
    } catch (e) {
      console.error('Failed to add folder', e);
      throw e;
    }
  },

  removeFolderFromWorkspace: async (path) => {
    try {
      const ws = await invoke<Workspace>('remove_folder_from_workspace', { folderPath: path });
      set({ currentWorkspace: ws });
      await get().loadWorkspacesWithSessions();
      get().backgroundScan();
      return ws;
    } catch (e) {
      console.error('Failed to remove folder', e);
      throw e;
    }
  },

  renameWorkspace: async (name) => {
    try {
      const ws = await invoke<Workspace>('rename_workspace', { name });
      set({ currentWorkspace: ws });
      await get().loadWorkspacesWithSessions();
      return ws;
    } catch (e) {
      console.error('Failed to rename workspace', e);
      throw e;
    }
  },

  deleteWorkspace: async (id) => {
    try {
      // Capture this before reloading: loadWorkspacesWithSessions overwrites
      // currentWorkspace with whatever the backend switched to, so checking
      // after would never match the deleted id.
      const wasCurrent = get().currentWorkspace?.id === id;
      await invoke('delete_workspace', { id });
      await get().loadWorkspacesWithSessions();
      if (wasCurrent) {
        await get().loadSessions();
        await get().refreshGraph();
        const cur = get().currentWorkspace;
        const target = cur
          ? get().workspacesWithSessions.find((w) => w.id === cur.id)
          : undefined;
        get().setCurrentSession(
          target?.sessions.find((s) => s.active)?.id ?? target?.sessions[0]?.id ?? null,
        );
      }
    } catch (e) {
      console.error('Failed to delete workspace', e);
      throw e;
    }
  },
});