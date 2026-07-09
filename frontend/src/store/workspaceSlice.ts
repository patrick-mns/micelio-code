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
  allWorkspaces: Workspace[];
  workspacesWithSessions: WorkspaceWithSessions[];
  workspaceLoading: boolean;
  expandedWorkspaces: string[];

  loadCurrentWorkspace: () => Promise<Workspace | null>;
  loadAllWorkspaces: () => Promise<Workspace[]>;
  loadWorkspacesWithSessions: () => Promise<void>;
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
  allWorkspaces: [],
  workspacesWithSessions: [],
  workspaceLoading: false,
  expandedWorkspaces: [],

  loadCurrentWorkspace: async () => {
    set({ workspaceLoading: true });
    try {
      const ws = await invoke<Workspace>('get_current_workspace');
      set({ currentWorkspace: ws, expandedWorkspaces: [ws.id] });
      return ws;
    } catch (e) {
      console.error('Failed to load current workspace', e);
      return null;
    } finally {
      set({ workspaceLoading: false });
    }
  },

  loadAllWorkspaces: async () => {
    try {
      const list = await invoke<Workspace[]>('list_all_workspaces');
      set({ allWorkspaces: list });
      return list;
    } catch (e) {
      console.error('Failed to list workspaces', e);
      return [];
    }
  },

  loadWorkspacesWithSessions: async () => {
    try {
      const list = await invoke<WorkspaceWithSessions[]>('list_all_workspaces_with_sessions');
      set((s) => ({
        workspacesWithSessions: list,
        currentWorkspace: list.find((w) => w.is_current) ?? s.currentWorkspace,
        expandedWorkspaces:
          s.expandedWorkspaces.length > 0
            ? s.expandedWorkspaces
            : list.filter((w) => w.is_current).map((w) => w.id),
      }));
    } catch (e) {
      console.error('Failed to load workspaces with sessions', e);
    }
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
      await get().refreshGraph();
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
      await get().refreshGraph();
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
      await get().refreshGraph();
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
      await invoke('delete_workspace', { id });
      await get().loadWorkspacesWithSessions();
      if (get().currentWorkspace?.id === id) {
        await get().loadSessions();
        await get().refreshGraph();
      }
    } catch (e) {
      console.error('Failed to delete workspace', e);
      throw e;
    }
  },
});