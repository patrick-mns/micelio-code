import React from 'react';

/**
 * Invisible edge handles that show native resize cursors at window borders.
 *
 * Tauri removes native window decorations on Linux/Windows
 * (`set_decorations(false)`) so the compositor's default resize cursors
 * never appear through the WebView.  These thin fixed-position strips with
 * `data-tauri-drag-region` forward mouse events to the native window, which
 * lets the compositor show the right cursor and handle the resize gesture.
 *
 * Only rendered on Windows/Linux (controlled by the parent).
 */

const EDGE = 5; // px — wide enough to hit easily, thin enough not to obscure content

type HandleStyle = React.CSSProperties;

const top: HandleStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: EDGE,
  zIndex: 9999,
  cursor: 'n-resize',
};

const bottom: HandleStyle = {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  height: EDGE,
  zIndex: 9999,
  cursor: 's-resize',
};

const left: HandleStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  bottom: 0,
  width: EDGE,
  zIndex: 9999,
  cursor: 'w-resize',
};

const right: HandleStyle = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: EDGE,
  zIndex: 9999,
  cursor: 'e-resize',
};

const cornerSize = EDGE * 2;
const cornerBase: HandleStyle = {
  position: 'fixed',
  zIndex: 10000, // above edges so corners take priority
  width: cornerSize,
  height: cornerSize,
};

const tl: HandleStyle = { ...cornerBase, top: 0, left: 0, cursor: 'nw-resize' };
const tr: HandleStyle = { ...cornerBase, top: 0, right: 0, cursor: 'ne-resize' };
const bl: HandleStyle = { ...cornerBase, bottom: 0, left: 0, cursor: 'sw-resize' };
const br: HandleStyle = { ...cornerBase, bottom: 0, right: 0, cursor: 'se-resize' };

export default function ResizeEdgeHandles() {
  return (
    <>
      <div style={top} data-tauri-drag-region />
      <div style={bottom} data-tauri-drag-region />
      <div style={left} data-tauri-drag-region />
      <div style={right} data-tauri-drag-region />
      {/* Corners get higher z-index so the diagonal cursor wins over the
          edge cursor when you're exactly at the corner */}
      <div style={tl} data-tauri-drag-region />
      <div style={tr} data-tauri-drag-region />
      <div style={bl} data-tauri-drag-region />
      <div style={br} data-tauri-drag-region />
    </>
  );
}
