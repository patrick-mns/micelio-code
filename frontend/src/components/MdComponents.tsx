import React, { type CSSProperties } from 'react';
import type { Components } from 'react-markdown';
import { convertFileSrc } from '@tauri-apps/api/core';
import { theme } from '@/theme';
import { ipc } from '@/ipc';
import { useStore } from '@/store';

// Passthrough remote/data URLs; resolve a local path (relative → the active
// folder) through the Tauri asset protocol so the webview can load it. The
// folder is opened to the asset scope on the backend (see allow_workspace_assets).
function resolveImageSrc(src: string, root: string): string {
  if (/^(https?:|data:|asset:|blob:)/i.test(src)) return src;
  const isAbsolute = src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src);
  const abs = isAbsolute || !root ? src : `${root}/${src}`;
  return convertFileSrc(abs);
}

// Renders a markdown image the model emitted (`![alt](path)`). Local paths are
// resolved against the selected folder; a load failure hides the element rather
// than showing a broken-image icon.
function MdImage({ src, alt }: { src?: string; alt?: string }) {
  const activeRoot = useStore((s) => s.activeRoot);
  const firstFolder = useStore((s) => s.currentWorkspace?.folders?.[0]);
  if (!src) return null;
  const root = activeRoot || firstFolder || '';
  return (
    <img
      src={resolveImageSrc(src, root)}
      alt={alt || ''}
      title={alt || src}
      style={mdStyles.image}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

// react-markdown components (shared between Message and StreamStatus).
// v9 dropped the `inline` prop on `code`, so we detect block vs inline ourselves.
export const mdComponents: Components = {
  a({ href, children }) {
    return (
      <span
        style={{ color: theme.accent, cursor: 'pointer', textDecoration: 'underline' }}
        onClick={(e) => {
          e.stopPropagation();
          if (href) ipc.openUrl(href);
        }}
      >
        {children}
      </span>
    );
  },
  code({ className, children }) {
    const text = String(children ?? '');
    const isBlock = /language-/.test(className || '') || text.includes('\n');
    return isBlock ? (
      <code style={mdStyles.codeBlock}>{children}</code>
    ) : (
      <code style={mdStyles.inlineCode}>{children}</code>
    );
  },
  pre({ children }) {
    return <pre style={{ margin: '8px 0' }}>{children}</pre>;
  },
  img({ src, alt }) {
    return (
      <MdImage
        src={typeof src === 'string' ? src : undefined}
        alt={typeof alt === 'string' ? alt : undefined}
      />
    );
  },
};

export const mdStyles: Record<string, CSSProperties> = {
  inlineCode: {
    background: theme.bgDeep,
    padding: '1px 5px',
    borderRadius: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: 12.5,
    color: theme.accent,
  },
  codeBlock: {
    display: 'block',
    background: theme.bgDeep,
    border: `1px solid ${theme.card}`,
    borderRadius: 8,
    padding: '12px 16px',
    overflowX: 'auto',
    fontSize: 12.5,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    lineHeight: 1.5,
    color: theme.textSoft,
    whiteSpace: 'pre',
  },
  image: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: 360,
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
    borderRadius: 8,
    border: `1px solid ${theme.card}`,
    margin: '8px 0',
  },
};
