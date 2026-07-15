import React, { useEffect, useState, type CSSProperties } from 'react';
import { nodeModalStyles } from '@/utils/theme-styles';
import { fmtCount } from '@/utils/formatters';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Sparkle, Warning, Lock, LockOpen } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme, KIND_COLORS } from '@/theme';
import type { NodeCode, TreemapNode } from '@/types';
import Modal from '@/components/Modal';

// Register only the languages the backend's lang_from_path can emit, so the
// modal doesn't pull Prism's entire language set into the bundle.
for (const [name, def] of Object.entries({
  rust, javascript, jsx, typescript, tsx, python, go, json, toml, yaml, markdown, markup, css, bash,
})) {
  SyntaxHighlighter.registerLanguage(name, def);
}

function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#2563eb';
}

// Above this, inline syntax highlighting (Prism) blocks the main thread long
// enough to freeze the window, so we show a notice instead of rendering.
const MAX_PREVIEW_CHARS = 80_000;

interface NodeModalProps {
  node: TreemapNode;
  onClose: () => void;
}

type CodeState = 'loading' | 'ready' | 'none';

// Centered modal for an inspected graph node: metadata + an in-app code
// preview (the function's span, or the whole file) + an on-demand summary.
export default function NodeModal({ node, onClose }: NodeModalProps) {
  const { summarizeModel, refreshGraph } = useStore();
  const [code, setCode] = useState<NodeCode | null>(null);
  const [codeState, setCodeState] = useState<CodeState>('loading');
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState(node.summary || '');
  const [summaryError, setSummaryError] = useState('');
  const [summaryStale, setSummaryStale] = useState(false);
  const [locked, setLocked] = useState(!!node.locked);
  const [locking, setLocking] = useState(false);

  // Fetch the node's code. Concept/note nodes have none — fall back gracefully.
  useEffect(() => {
    let alive = true;
    setCodeState('loading');
    setCode(null);
    setSummaryStale(false);
    ipc.getNodeCode(node.id)
      .then((c) => {
        if (alive) {
          setCode(c);
          setSummaryStale(c.summary_stale || false);
          setCodeState('ready');
        }
      })
      .catch(() => { if (alive) setCodeState('none'); });
    return () => { alive = false; };
  }, [node.id]);

  // Locking is file-level: a function node locks the file it lives in, so the
  // treemap has to re-read every node's state, not just this one.
  const toggleLock = async () => {
    setLocking(true);
    try {
      const next = !locked;
      await ipc.setNodeLocked(node.id, next);
      setLocked(next);
      node.locked = next;
      await refreshGraph();
    } catch (e) {
      console.error('failed to toggle lock', e);
    } finally {
      setLocking(false);
    }
  };

  const summarize = async () => {
    setSummarizing(true);
    setSummaryError('');
    try {
      const text = await ipc.summarizeNode(node.id);
      setSummary(text);
      node.summary = text;
    } catch (e) {
      // The backend returns a plain string error (e.g. "no content to
      // summarize", a model/daemon failure). Surface it instead of failing
      // silently.
      setSummaryError(typeof e === 'string' ? e : ((e as Error)?.message || 'Failed to generate summary'));
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <Modal onClose={onClose} animate backdropStyle={{ backdropFilter: 'blur(2px)' }}>
        <div style={nodeModalStyles.head}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: kindColor(node.kind), flexShrink: 0 }} />
          <span style={nodeModalStyles.title}>{node.name}</span>
          <span style={nodeModalStyles.kindChip}>{node.kind}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={toggleLock}
              disabled={locking}
              className="btn btn-sm btn-outline"
              style={{
                borderColor: locked ? theme.warn : theme.border,
                color: locked ? theme.warn : theme.dim,
              }}
              title={
                locked
                  ? 'Unlock — the agent can read this file again'
                  : "Lock this file — the agent still sees it exists, but can't read its contents"
              }
            >
              {locked ? <Lock size={14} weight="fill" /> : <LockOpen size={14} />}
              {locked ? 'Locked' : 'Lock'}
            </button>
            <button
              onClick={summarize}
              // Summarizing sends the file to a model, which a lock forbids —
              // the backend rejects it, so don't offer it either.
              disabled={summarizing || locked}
              className="btn btn-sm btn-outline"
              style={{
                borderColor: summaryStale && !locked ? theme.warn : theme.border,
                color: summaryStale && !locked ? theme.warn : theme.accent,
              }}
              title={
                locked
                  ? 'Locked — unlock to send this file to a model'
                  : summaryStale
                    ? 'Content changed, summary is outdated'
                    : ''
              }
            >
              {summaryStale ? <Warning size={14} weight="fill" /> : <Sparkle size={14} weight={summary ? "regular" : "fill"} />}
              {summarizing ? 'Summarizing…' : summaryStale ? 'Update summary' : summary ? 'Regenerate' : `Summarize by ${summarizeModel}`}
            </button>
            <button onClick={onClose} className="close-btn" style={nodeModalStyles.close} title="Close (Esc)"><X size={16} /></button>
          </div>
        </div>

        {(node.path || node.value > 0) && (
          <div style={nodeModalStyles.meta}>
            {node.path && <span style={nodeModalStyles.path}>{node.path}</span>}
            {node.value > 0 && <span style={nodeModalStyles.size}>~{fmtCount(node.tokens || Math.max(1, Math.round(node.value / 4)))} tokens</span>}
            {node.value > 0 && <span style={nodeModalStyles.size}>{fmtCount(node.value)} bytes</span>}
          </div>
        )}

        {(summary || summaryError) && (
          <div style={{ padding: '0 16px', flexShrink: 0 }}>
            {summary && <div style={nodeModalStyles.summary}>{summary}</div>}
            {summaryError && <div style={nodeModalStyles.summaryErr}>{summaryError}</div>}
          </div>
        )}

        <div style={nodeModalStyles.body}>
          {codeState === 'loading' && <div style={nodeModalStyles.hint}>Loading code…</div>}

          {codeState === 'ready' && code && code.code.length > MAX_PREVIEW_CHARS && (
            <div style={nodeModalStyles.tooLarge}>
              <Warning size={22} weight="fill" color={theme.warn} />
              <div style={nodeModalStyles.tooLargeTitle}>File too large to preview</div>
              <div style={nodeModalStyles.tooLargeText}>
                This file is ~{fmtCount(code.code.length)} characters. Rendering it inline
                would freeze the app. Optimized previews for large files are on the way.
              </div>
            </div>
          )}

          {codeState === 'ready' && code && code.code.length <= MAX_PREVIEW_CHARS && code.language === 'markdown' && (
            <div className="md" style={nodeModalStyles.mdWrap}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{code.code}</ReactMarkdown>
            </div>
          )}

          {codeState === 'ready' && code && code.code.length <= MAX_PREVIEW_CHARS && code.language !== 'markdown' && (
            <div style={nodeModalStyles.codeWrap}>
              <SyntaxHighlighter
                language={code.language}
                style={oneDark}
                showLineNumbers
                startingLineNumber={code.start_line}
                wrapLongLines={false}
                customStyle={{
                  margin: 0,
                  background: theme.codeBg,
                  fontSize: 12.5,
                  borderRadius: 10,
                  border: `1px solid ${theme.border}`,
                  flex: 1,
                  overflow: 'auto',
                }}
                codeTagProps={{ style: { background: 'transparent', fontFamily: 'ui-monospace, SFMono-Regular, monospace' } }}
              >
                {code.code}
              </SyntaxHighlighter>
            </div>
          )}

          {codeState === 'none' && (
            <div style={nodeModalStyles.hint}>No source code attached to this node.</div>
          )}
        </div>
    </Modal>
  );
}

