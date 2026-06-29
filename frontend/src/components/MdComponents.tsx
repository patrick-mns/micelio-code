import React, { type CSSProperties } from 'react';
import type { Components } from 'react-markdown';
import { theme } from '@/theme';
import { ipc } from '@/ipc';

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
};
