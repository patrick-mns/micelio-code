import React, { useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { theme } from '@/theme';

const btn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 46,
  height: '100%',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: theme.dim,
  transition: 'background 0.1s, color 0.1s',
  flexShrink: 0,
};

const hoverBg = 'rgba(var(--overlay), 0.08)';
const closeHoverBg = '#e81123';
const closeHoverColor = '#fff';

export default function WindowControls() {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const win = getCurrentWindow();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        marginRight: -4,
        marginLeft: 4,
        userSelect: 'none',
      }}
    >
      {/* Minimize */}
      <button
        style={{
          ...btn,
          background: hoverIdx === 0 ? hoverBg : 'transparent',
        }}
        onMouseEnter={() => setHoverIdx(0)}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => win.minimize()}
        aria-label="Minimize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        style={{
          ...btn,
          background: hoverIdx === 1 ? hoverBg : 'transparent',
        }}
        onMouseEnter={() => setHoverIdx(1)}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => win.toggleMaximize()}
        aria-label="Maximize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>

      {/* Close */}
      <button
        style={{
          ...btn,
          background: hoverIdx === 2 ? closeHoverBg : 'transparent',
          color: hoverIdx === 2 ? closeHoverColor : theme.dim,
        }}
        onMouseEnter={() => setHoverIdx(2)}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => win.close()}
        aria-label="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}