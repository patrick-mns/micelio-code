import { useEffect, useState, useCallback } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import type { BgTaskInfo } from '@/types';

// Background-task list with 3s polling + immediate refresh when one exits.
// Exposes the derived running count and stop/clear actions (which refresh).
//
// The backend scopes the list to the showing conversation, so this refetches
// when that changes — otherwise the panel would keep showing the previous
// session's processes until the next poll came round.
export function useBgTasks() {
  const [tasks, setTasks] = useState<BgTaskInfo[]>([]);
  const currentSession = useStore((s) => s.currentSession);

  const refresh = useCallback(
    () => ipc.listBgTasks().then(setTasks).catch(console.error),
    [],
  );

  useEffect(() => {
    // Clear first: the list belongs to the conversation being left, and holding
    // it on screen until the fetch lands would attribute it to the new one.
    setTasks([]);
    refresh();
    const t = setInterval(refresh, 3000);
    let un: UnlistenFn | undefined;
    ipc.onBgTaskExited(() => refresh()).then((u) => { un = u; });
    return () => { clearInterval(t); if (un) un(); };
  }, [refresh, currentSession]);

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const stop = (pid: number) => ipc.stopBgTask(pid).then(refresh).catch(console.error);
  const clear = () => ipc.clearBgTasks().then(refresh).catch(console.error);

  return { tasks, runningCount, stop, clear };
}
