import { useEffect, useState, useCallback } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { ipc } from '@/ipc';
import type { BgTaskInfo } from '@/types';

// Background-task list with 3s polling + immediate refresh when one exits.
// Exposes the derived running count and stop/clear actions (which refresh).
export function useBgTasks() {
  const [tasks, setTasks] = useState<BgTaskInfo[]>([]);

  const refresh = useCallback(
    () => ipc.listBgTasks().then(setTasks).catch(console.error),
    [],
  );

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    let un: UnlistenFn | undefined;
    ipc.onBgTaskExited(() => refresh()).then((u) => { un = u; });
    return () => { clearInterval(t); if (un) un(); };
  }, [refresh]);

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const stop = (pid: number) => ipc.stopBgTask(pid).then(refresh).catch(console.error);
  const clear = () => ipc.clearBgTasks().then(refresh).catch(console.error);

  return { tasks, runningCount, stop, clear };
}
