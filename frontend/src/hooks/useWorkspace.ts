import { useState, useCallback } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';

// Workspace folder picker + switch. Prompts for a folder, points the backend at
// it, then reloads the dependent bundle (settings, graph, sessions, history).
// `switching` is true while the swap is in flight (for "Scanning…" labels).
// Pass a fallback session id (e.g. the currently viewed one) used when the new
// workspace has no active session of its own.
export function useWorkspace() {
  const {
    settings, setSettings, setGraphNodes, setScanning,
    setSelectedNode, setSessions, setMessages, setCurrentSession,
  } = useStore();
  const [switching, setSwitching] = useState(false);

  const pickWorkspace = useCallback(async (fallbackSessionId: string | null = null) => {
    const path = await ipc.pickFolder(settings?.workspace).catch(() => null);
    if (!path) return;
    setSwitching(true);
    setScanning(true);
    setSelectedNode(null);
    setGraphNodes([]);
    try {
      await ipc.setWorkspace(path);
      const [s, nodes, sessions, history] = await Promise.all([
        ipc.getSettings(), ipc.getGraph(), ipc.listSessions(), ipc.getHistory(),
      ]);
      setSettings(s);
      setGraphNodes(nodes);
      setSessions(sessions);
      const activeId = sessions.find((x) => x.active)?.id ?? fallbackSessionId;
      if (activeId) {
        setCurrentSession(activeId);
        setMessages(activeId, history);
      }
    } catch (e) {
      console.error('workspace switch failed', e);
    } finally {
      setScanning(false);
      setSwitching(false);
    }
  }, [settings]);

  return { switching, pickWorkspace };
}
