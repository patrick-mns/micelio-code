import React, { useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const btn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 46,
  height: '100%',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--color-dim)',
  transition: 'background 0.1s, color 0.1s',
  flexShrink: 0,
  position: 'relative',
  zIndex: 10,
};

const closeHoverBg = '#e81123';
const closeHoverColor = '#fff';

export default function WindowControls() {
  const win = getCurrentWindow();

  const handleMinimize = useCallback(() => {
    win.minimize().catch(console.error);
  }, [win]);

  const handleMaximize = useCallback(() => {
    win.toggleMaximize().catch(console.error);
  }, [win]);

  const handleClose = useCallback(() => {
    win.close().catch(console.error);
  }, [win]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        userSelect: 'none',
      }}
    >
      {/* Minimize */}
      <button
        className="win-btn"
        style={btn}
        onClick={handleMinimize}
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
        onClick={handleMaximize}
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
        onClick={handleClose}
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