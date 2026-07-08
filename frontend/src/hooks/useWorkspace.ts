import { useState, useCallback } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';

export function useWorkspace() {
  const {
    currentWorkspace,
    addFolderToWorkspace,
    removeFolderFromWorkspace,
    switchWorkspace,
    workspaceLoading,
    setSelectedNode,
    setGraphNodes,
  } = useStore();
  const [switching, setSwitching] = useState(false);

  const addNewFolder = useCallback(async (_fallbackPath?: string) => {
    // Open directory picker
    const path = await ipc.pickFolder(currentWorkspace?.folders?.[0]).catch(() => null);
    if (!path) return;
    setSwitching(true);
    setSelectedNode(null);
    setGraphNodes([]);
    try {
      await addFolderToWorkspace(path);
    } catch (e) {
      console.error('Failed to add folder to workspace', e);
    } finally {
      setSwitching(false);
    }
  }, [currentWorkspace, addFolderToWorkspace, setSelectedNode, setGraphNodes]);

  return {
    currentWorkspace,
    addNewFolder,
    pickWorkspace: addNewFolder,
    removeFolder: removeFolderFromWorkspace,
    switchWorkspace,
    loading: workspaceLoading || switching,
    switching,
    workspaceLoading,
  };
}
