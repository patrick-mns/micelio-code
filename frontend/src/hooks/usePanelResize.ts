import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

// localStorage throws (SecurityError) under Tauri's opaque `tauri://` origin in
// production — guard every access, matching the rest of the app. An unguarded
// read in a render path crashes React into a blank white screen.
const readWidth = (key: string, fallback: number): number => {
  try {
    const saved = parseInt(localStorage.getItem(key) ?? '', 10);
    return Number.isFinite(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
};
const writeWidth = (key: string, value: number): void => {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {}
};

// Shared drag-to-resize for the side panels (sidebar, background tasks, turn
// detail). Returns the current width, a setter, and props for the drag handle.
// The width is clamped and persisted to localStorage so the panel reopens at
// the size the user last chose.
//
//   side: 'left'  — panel is on the left; handle sits on its RIGHT edge,
//                   dragging right grows it (width = pointer X).
//   side: 'right' — panel is on the right; handle sits on its LEFT edge,
//                   dragging left grows it (width = viewport − pointer X).
export interface PanelResizeOptions {
  storageKey: string;
  defaultWidth: number;
  min?: number;
  side?: 'left' | 'right';
}

export function usePanelResize({ storageKey, defaultWidth, min = 200, side = 'right' }: PanelResizeOptions) {
  const [width, setWidth] = useState(() => readWidth(storageKey, defaultWidth));
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      // Cap at the larger of 720px or 60% of the viewport so a panel can never
      // swallow the whole window.
      const max = Math.max(720, window.innerWidth * 0.6);
      const raw = side === 'left' ? e.clientX : window.innerWidth - e.clientX;
      setWidth(Math.min(max, Math.max(min, raw)));
    };
    const onMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // Suppress text selection + show the resize cursor for the whole drag.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, min, side]);

  // Persist once the drag finishes (not on every pixel).
  useEffect(() => {
    if (!isResizing) writeWidth(storageKey, width);
  }, [isResizing, width]);

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
    style: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      [side === 'left' ? 'right' : 'left']: -2,
      width: 6,
      cursor: 'ew-resize',
      zIndex: 10,
    } as CSSProperties,
  };

  return { width, setWidth, isResizing, startResize, handleProps };
}
