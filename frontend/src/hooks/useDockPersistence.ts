// Reads and writes the dock strip of the showing conversation.
//
// The strip lives in the session's own row in `sessions.db`, which is the
// database of the workspace the session belongs to — so a layout is stored
// beside the conversation it describes, and never leaks between projects. This
// hook is the only place that talks to the backend about it; `panelSlice` stays
// pure state so it can be tested without IPC.
import { useEffect, useRef } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { dockOf, parseDock, serializeDock, EMPTY_DOCK } from '@/store/panelSlice';

// Opening a few tabs in a row, or dragging through a resize, is one intent and
// deserves one write.
const WRITE_DELAY = 400;

export function useDockPersistence(): void {
  const sessionId = useStore((s) => s.currentSession);
  const dock = useStore(dockOf);
  const hydrateDock = useStore((s) => s.hydrateDock);

  // Sessions this hook has already loaded. Without it, the write effect below
  // would fire on the hydrated strip and immediately store back what was just
  // read — harmless but pointless, and it would also stamp an empty strip over
  // a real one if the read were still in flight.
  const loaded = useRef(new Set<string>());

  useEffect(() => {
    if (!sessionId || loaded.current.has(sessionId)) return;
    let alive = true;
    ipc.getSessionDock(sessionId)
      .then((json) => {
        if (!alive) return;
        hydrateDock(sessionId, parseDock(json));
        loaded.current.add(sessionId);
      })
      .catch(() => {
        // A session with no readable strip is just an empty one. Marking it
        // loaded matters: otherwise the write effect stays parked and the
        // layout the user builds now would never be stored.
        if (!alive) return;
        hydrateDock(sessionId, null);
        loaded.current.add(sessionId);
      });
    return () => { alive = false; };
  }, [sessionId, hydrateDock]);

  useEffect(() => {
    if (!sessionId || !loaded.current.has(sessionId)) return;
    // A session whose strip was never touched has nothing worth a row.
    if (dock === EMPTY_DOCK) return;
    const t = setTimeout(() => {
      ipc.setSessionDock(sessionId, serializeDock(dock)).catch(() => {});
    }, WRITE_DELAY);
    return () => clearTimeout(t);
  }, [sessionId, dock]);
}
