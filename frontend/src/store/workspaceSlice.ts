import { type StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { type AppState } from './index';

export interface Workspace {
  id: string;
  name: string;
  folders: string[];
  pinned_model: string | null;
}

export interface WorkspaceSlice {
  currentWorkspace: Workspace | null;
  allWorkspaces: Workspace[];
  workspaceLoading: boolean;

  loadCurrentWorkspace: () => Promise<Workspace | null>;
  loadAllWorkspaces: () => Promise<Workspace[]>;
  createWorkspace: (name: string, folders: string[]) => Promise<Workspace>;
  switchWorkspace: (id: string) => Promise<Workspace>;
  addFolderToWorkspace: (path: string) => Promise<Workspace>;
  removeFolderFromWorkspace: (path: string) => Promise<Workspace>;
  renameWorkspace: (name: string) => Promise<Workspace>;
}

export const workspaceSlice: StateCreator<
  AppState,
  [],
  [],
  WorkspaceSlice
> = (set, get) => ({
  currentWorkspace: null,
  allWorkspaces: [],
  workspaceLoading: false,

  loadCurrentWorkspace: async () => {
    set({ workspaceLoading: true });
    try {
      const ws = await invoke<Workspace>('get_current_workspace');
      set({ currentWorkspace: ws });
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

  createWorkspace: async (name, folders) => {
    set({ workspaceLoading: true });
    try {
      const ws = await invoke<Workspace>('create_workspace', { name, folders });
      set({ currentWorkspace: ws });
      // Refresh list
      const list = await invoke<Workspace[]>('list_all_workspaces');
      set({ allWorkspaces: list });
      
      // Sync sessions list after switch
      await get().loadSessions();
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
      // Refresh list
      const list = await invoke<Workspace[]>('list_all_workspaces');
      set({ allWorkspaces: list });

      // Sync sessions and reset workspace_root
      await get().loadSessions();
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
      // Refresh list
      const list = await invoke<Workspace[]>('list_all_workspaces');
      set({ allWorkspaces: list });
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
      // Refresh list
      const list = await invoke<Workspace[]>('list_all_workspaces');
      set({ allWorkspaces: list });
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
      // Refresh list
      const list = await invoke<Workspace[]>('list_all_workspaces');
      set({ allWorkspaces: list });
      return ws;
    } catch (e) {
      console.error('Failed to rename workspace', e);
      throw e;
    }
  },
});
