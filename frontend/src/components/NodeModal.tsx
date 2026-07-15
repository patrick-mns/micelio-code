import React, { useEffect, useState, type CSSProperties } from 'react';
import { nodeModalStyles } from '@/utils/theme-styles';
import { fmtCount } from '@/utils/formatters';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Sparkle, Warning, Lock, LockOpen } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme, KIND_COLORS } from '@/theme';
import type { NodeCode, TreemapNode } from '@/types';
import Modal from '@/components/Modal';
import CodeViewer from '@/components/CodeViewer';

function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#2563eb';
}

// The viewer virtualizes the DOM, so line count no longer drives the cost —
// what's left is Prism tokenizing the whole file, which is linear and cheap
// (~120ms for 600k chars). This cap is really a guard against the pathological
// case virtualizing can't help: a minified bundle, where the whole file is one
// enormous line and so a single unsplittable row.
const MAX_PREVIEW_CHARS = 400_000;

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
                This file is ~{fmtCount(code.code.length)} characters — past the point where
                highlighting it stays responsive. Files this size are usually generated or
                minified; open it in an editor instead.
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
              <CodeViewer code={code.code} language={code.language} startLine={code.start_line} />
            </div>
          )}

          {codeState === 'none' && (
            <div style={nodeModalStyles.hint}>No source code attached to this node.</div>
          )}
        </div>
    </Modal>
  );
}

