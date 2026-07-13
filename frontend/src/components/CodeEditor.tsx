import React, { useRef } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';

SyntaxHighlighter.registerLanguage('json', json);

// Shared text metrics — the transparent <textarea> and the highlighted layer
// must use identical font/size/line-height/padding so the caret lands exactly
// on the rendered glyphs.
const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_SIZE = 12.5;
const LINE_HEIGHT = 1.6;
const PAD = 12;
const TAB = 2;

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  minHeight?: number;
  spellCheck?: boolean;
}

/**
 * A lightweight syntax-highlighted code editor: a transparent textarea layered
 * over a Prism highlighter (the same `oneDark` surface used across the app for
 * code/JSON). The textarea owns input + scrolling; the highlight layer mirrors
 * its scroll via a transform. No external editor dependency.
 */
export default function CodeEditor({
  value,
  onChange,
  language = 'json',
  minHeight = 240,
  spellCheck = false,
}: CodeEditorProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    }
  };

  const shared: React.CSSProperties = {
    margin: 0,
    padding: PAD,
    fontFamily: FONT,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    tabSize: TAB,
    whiteSpace: 'pre',
    wordWrap: 'normal',
    overflowWrap: 'normal',
  };

  return (
    <div
      style={{
        position: 'relative',
        minHeight,
        height: minHeight,
        resize: 'vertical',
        overflow: 'hidden',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-code-bg)',
      }}
    >
      {/* Highlight layer (behind, non-interactive) */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div ref={innerRef} style={{ willChange: 'transform' }}>
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            wrapLongLines={false}
            customStyle={{ ...shared, background: 'transparent', minWidth: '100%' }}
            codeTagProps={{ style: { fontFamily: FONT, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, tabSize: TAB, background: 'transparent' } }}
          >
            {value + '\n'}
          </SyntaxHighlighter>
        </div>
      </div>

      {/* Editable layer (front, transparent text with visible caret) */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={spellCheck}
        wrap="off"
        style={{
          ...shared,
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          color: 'transparent',
          caretColor: 'var(--color-text)',
          overflow: 'auto',
        }}
      />
    </div>
  );
}
