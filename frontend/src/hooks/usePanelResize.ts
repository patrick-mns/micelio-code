import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

// localStorage throws (SecurityError) under Tauri's opaque `tauri://` origin in
// production — guard every access, matching the rest of the app. An unguarded
// read in a render path crashes React into a blank white screen.
const readSize = (key: string, fallback: number): number => {
  try {
    const saved = parseInt(localStorage.getItem(key) ?? '', 10);
    return Number.isFinite(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
};
const writeSize = (key: string, value: number): void => {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {}
};

// Shared drag-to-resize for docked panels (sidebar, the right dock, the bottom
// dock). Returns the current size along the panel's axis, a setter, and props
// for the drag handle. The size is clamped and persisted to localStorage so the
// panel reopens at the size the user last chose.
//
//   side: 'left'   — panel on the left; handle on its RIGHT edge,
//                    dragging right grows it (width = pointer X).
//   side: 'right'  — panel on the right; handle on its LEFT edge,
//                    dragging left grows it (width = viewport − pointer X).
//   side: 'bottom' — panel at the bottom; handle on its TOP edge,
//                    dragging up grows it (height = viewport − pointer Y).
export type PanelSide = 'left' | 'right' | 'bottom';

export interface PanelResizeOptions {
  storageKey: string;
  defaultSize: number;
  min?: number;
  side?: PanelSide;
}

const isVertical = (side: PanelSide) => side === 'bottom';

export function usePanelResize({ storageKey, defaultSize, min = 200, side = 'right' }: PanelResizeOptions) {
  const [size, setSize] = useState(() => readSize(storageKey, defaultSize));
  const [isResizing, setIsResizing] = useState(false);
  const vertical = isVertical(side);

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      // Cap so a panel can never swallow the whole window. The vertical cap is
      // a plain fraction — there's far less height to give away than width, so
      // the horizontal floor (720px) would be most of a short window.
      const max = vertical
        ? window.innerHeight * 0.75
        : Math.max(720, window.innerWidth * 0.6);
      const raw = vertical
        ? window.innerHeight - e.clientY
        : side === 'left' ? e.clientX : window.innerWidth - e.clientX;
      setSize(Math.min(max, Math.max(min, raw)));
    };
    const onMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // Suppress text selection + show the resize cursor for the whole drag.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = vertical ? 'ns-resize' : 'ew-resize';
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, min, side, vertical]);

  // Persist once the drag finishes (not on every pixel).
  useEffect(() => {
    if (!isResizing) writeSize(storageKey, size);
  }, [isResizing, size]);

  // Prevent the mousedown's default text-selection synchronously (before React
  // re-renders and the effect runs) — otherwise the first drag pixels select
  // text under the cursor.
  const startResize = (e?: ReactMouseEvent) => {
    e?.preventDefault();
    document.body.style.userSelect = 'none';
    setIsResizing(true);
  };

  // Props for an absolutely-positioned grabber pinned to the resize edge —
  // used inside positioned (non-clipped) containers like the turn-detail
  // drawer. For flex-layout panels, use `startResize` on a sibling strip
  // instead so the handle sits in the inter-panel gap, clear of scrollbars.
  const handleProps = {
    onMouseDown: startResize,
    style: (vertical
      ? { position: 'absolute', left: 0, right: 0, top: -2, height: 6, cursor: 'ns-resize', zIndex: 10 }
      : {
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side === 'left' ? 'right' : 'left']: -2,
        width: 6,
        cursor: 'ew-resize',
        zIndex: 10,
      }) as CSSProperties,
  };

  return { size, setSize, isResizing, startResize, handleProps };
}
