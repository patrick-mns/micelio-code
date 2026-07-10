import React, { useCallback, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const btn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 46,
  height: '100%',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-dim)',
  transition: 'background 0.1s, color 0.1s',
  flexShrink: 0,
  position: 'relative',
  zIndex: 10,
};

export default function WindowControls() {
  const win = useMemo(() => {
    try {
      return getCurrentWindow();
    } catch (e) {
      console.error('[WindowControls] getCurrentWindow failed:', e);
      return null;
    }
  }, []);

  const handleMinimize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[WindowControls] minimize clicked, win=', !!win);
    if (!win) return;
    win.minimize().catch((err) => console.error('[WindowControls] minimize failed:', err));
  }, [win]);

  const handleMaximize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[WindowControls] maximize clicked, win=', !!win);
    if (!win) return;
    win.toggleMaximize().catch((err) => console.error('[WindowControls] toggleMaximize failed:', err));
  }, [win]);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[WindowControls] close clicked, win=', !!win);
    if (!win) return;
    win.close().catch((err) => console.error('[WindowControls] close failed:', err));
  }, [win]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: '100%',
        alignSelf: 'stretch',
        userSelect: 'none',
      }}
    >
      {/* Minimize */}
      <button
        className="win-btn"
        style={btn}
        onMouseDown={handleMinimize}
        aria-label="Minimize"
        title="Minimize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        className="win-btn"
        style={btn}
        onMouseDown={handleMaximize}
        aria-label="Maximize"
        title="Maximize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>

      {/* Close */}
      <button
        className="win-btn win-btn-close"
        style={btn}
        onMouseDown={handleClose}
        aria-label="Close"
        title="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}