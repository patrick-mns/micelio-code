import type { CSSProperties } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  PrismLight as SyntaxHighlighter,
  createElement,
  type SyntaxHighlighterProps,
} from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import { theme } from '@/theme';

// Register only the languages the backend's lang_from_path can emit, so the
// viewer doesn't pull Prism's entire language set into the bundle.
for (const [name, def] of Object.entries({
  rust, javascript, jsx, typescript, tsx, python, go, json, toml, yaml, markdown, markup, css, bash,
})) {
  SyntaxHighlighter.registerLanguage(name, def);
}

type Renderer = NonNullable<SyntaxHighlighterProps['renderer']>;

// Rows past this point aren't mounted, but Virtuoso still needs to know they
// exist to size the scrollbar — that part is O(1) per row.
const OVERSCAN_PX = 600;

// Renders only the lines currently on screen.
//
// react-syntax-highlighter's default renderer turns *every* row into React
// elements up front, so a few thousand lines become tens of thousands of DOM
// nodes built in one synchronous pass — that is what froze the modal. The
// `renderer` prop hands us the same rows the default one would use, already
// tokenized and split per line, and lets us mount just the visible slice.
//
// Splitting the file into lines ourselves and highlighting each one on demand
// would be wrong: a block comment or template literal spans lines, so a line
// can't be tokenized in isolation. Prism still parses the whole file once here;
// only the DOM is virtualized.
const virtualizedRows: Renderer = ({ rows, stylesheet, useInlineStyles }) => (
  <Virtuoso
    style={{ flex: 1 }}
    totalCount={rows.length}
    increaseViewportBy={OVERSCAN_PX}
    computeItemKey={(index) => index}
    itemContent={(index) =>
      createElement({
        node: rows[index],
        stylesheet,
        useInlineStyles,
        key: `line-${index}`,
      })
    }
  />
);

// Virtuoso owns the scrolling, so the <pre> must not scroll too — it only draws
// the frame and gives the list a bounded box to fill.
const preStyle: CSSProperties = {
  margin: 0,
  padding: '8px 0',
  background: theme.codeBg,
  fontSize: 12.5,
  borderRadius: 10,
  border: `1px solid ${theme.border}`,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  overflow: 'hidden',
};

const codeStyle: CSSProperties = {
  background: 'transparent',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
};

interface CodeViewerProps {
  code: string;
  language: string;
  /** 1-based line the snippet starts at, so a symbol's span numbers correctly. */
  startLine: number;
}

export default function CodeViewer({ code, language, startLine }: CodeViewerProps) {
  return (
    <SyntaxHighlighter
      language={language}
      style={oneDark}
      showLineNumbers
      startingLineNumber={startLine}
      wrapLongLines={false}
      renderer={virtualizedRows}
      // Plain divs: the default pre/code carry their own scrolling and block
      // layout, which fights the virtualized list.
      PreTag="div"
      CodeTag="div"
      customStyle={preStyle}
      codeTagProps={{ style: codeStyle }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
