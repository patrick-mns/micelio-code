import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MagnifyingGlass, Warning } from '@phosphor-icons/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { fmtCount } from '@/utils/formatters';
import { fieldStyles, filePanelStyles as styles } from '@/utils/theme-styles';
import { theme } from '@/theme';
import CodeViewer from '@/components/CodeViewer';
import { mdComponents } from '@/components/MdComponents';
import type { FileRef } from '@/store/panelSlice';
import type { FileContent, FileHit } from '@/types';

// Quick open: the same fuzzy search that backs the composer's @-mention, used
// here to pick what the viewer shows. It's the whole body when no file is open,
// and a takeover when one is — no file tree, since the dock is narrow and the
// search finds a path in fewer keystrokes than a tree does.
function Finder({ onPick, onCancel }: { onPick: (path: string) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FileHit[]>([]);
  const [selected, setSelected] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);

  // The search is scoped to the selected folder on the backend, so switching
  // folders has to re-run it — otherwise the list keeps showing the previous
  // project's files until something is typed.
  const activeRoot = useStore((s) => s.activeRoot);

  // Debounced like the composer's palette: the search walks the workspace, so
  // it shouldn't run on every keystroke.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      ipc.searchWorkspaceFiles(query, 30)
        .then((h) => { if (alive) { setHits(h); setSelected(0); } })
        .catch(() => { if (alive) setHits([]); });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [query, activeRoot]);

  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[selected]) onPick(hits[selected].path); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
  };

  return (
    <div style={styles.finder}>
      <div style={styles.finderRow}>
        <MagnifyingGlass size={14} color={theme.faint} style={{ flexShrink: 0 }} />
        <input
          autoFocus
          type="text"
          value={query}
          placeholder="Open a file…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          style={{ ...fieldStyles.input, width: '100%' }}
        />
      </div>
      <div style={styles.hits}>
        {hits.length === 0 ? (
          <div style={styles.hint}>No files match.</div>
        ) : hits.map((h, i) => (
          <button
            key={h.path}
            ref={i === selected ? activeRef : undefined}
            className={i === selected ? 'menu-item is-active' : 'menu-item'}
            onClick={() => onPick(h.path)}
            onMouseEnter={() => setSelected(i)}
            title={h.path}
          >
            <span style={styles.hitName}>{h.name}</span>
            <span style={styles.hitPath}>{h.path}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const basename = (p: string) => p.split('/').pop() ?? p;
/** The folder part, empty at the root — the header pairs it with the name. */
const dirname = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);

/** Resolve a document-relative link against the folder of the file showing it,
 * collapsing `.` and `..`. A leading "/" means the workspace root, not the
 * filesystem one — that's what a repo's own markdown means by it. */
function resolveRelative(dir: string, href: string): string {
  const out: string[] = [];
  for (const part of (href.startsWith('/') ? href.slice(1) : dir + href).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

interface FilePanelProps {
  /** What to show, with the scope its path is relative to. Null → the picker. */
  file: FileRef | null;
  /** `root` carries the folder a path was cited against; omitted for the
   * picker, whose results are already scoped to the selected folder. */
  onOpenPath: (path: string, root?: string | null) => void;
}

// Read-only viewer for one file: markdown rendered, images shown, anything else
// highlighted. Which file it shows lives in the store (`openFileRef`), so any
// part of the app can point it somewhere.
export default function FilePanel({ file: ref, onOpenPath }: FilePanelProps) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [finding, setFinding] = useState(false);

  const path = ref?.path ?? null;
  const root = ref?.root ?? null;

  useEffect(() => {
    if (!path) { setFile(null); setError(''); return; }
    let alive = true;
    setLoading(true);
    setError('');
    // Reset per-file view state, or a markdown file opened after a "show
    // source" would come up raw.
    setShowSource(false);
    ipc.readWorkspaceFile(path, root)
      .then((f) => { if (alive) setFile(f); })
      .catch((e) => {
        if (!alive) return;
        setFile(null);
        setError(typeof e === 'string' ? e : (e as Error)?.message || 'Could not read this file');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, root]);

  const pick = (p: string) => { setFinding(false); onOpenPath(p); };

  // Links inside a rendered document. The webview *is* the app, so letting an
  // <a> navigate replaces Micelio with the page — every link has to be handled
  // here: a URL goes to the system browser, and a path opens in this viewer,
  // resolved against the folder of the file it was written in.
  const components = useMemo<Components>(() => ({
    ...mdComponents,
    a({ href, children }) {
      const target = href ?? '';
      // Any scheme (http:, mailto:, vscode:…) is somebody else's to open.
      const external = /^[a-z][a-z0-9+.-]*:/i.test(target);
      // A bare fragment points inside this document; there's nothing to open.
      const dead = !target || target.startsWith('#');
      return (
        <span
          style={{
            color: dead ? 'inherit' : theme.accent,
            cursor: dead ? 'default' : 'pointer',
            textDecoration: dead ? 'none' : 'underline',
          }}
          title={dead ? undefined : target}
          onClick={(e) => {
            e.stopPropagation();
            if (dead) return;
            if (external) ipc.openUrl(target);
            // Strip the fragment/query: they address a spot inside the file,
            // and the backend reads paths, not URLs. The link is relative to
            // *this* document's folder, so its root travels with it — the
            // selected folder may be a different project entirely.
            else onOpenPath(
              resolveRelative(dirname(file?.path ?? path ?? ''), target.split(/[#?]/)[0]),
              file?.root ?? root,
            );
          }}
        >
          {children}
        </span>
      );
    },
  }), [file?.path, file?.root, path, root, onOpenPath]);

  if (!path) return <div style={styles.panel}><Finder onPick={pick} /></div>;

  const isMarkdown = file?.language === 'markdown';
  // An SVG both renders and reads, so the toggle isn't markdown's alone: it's
  // offered whenever there's a rendered form *and* source behind it.
  const hasSource = (isMarkdown || !!file?.image) && !!file?.content;

  return (
    <div style={styles.panel}>
      <div style={styles.head}>
        <span style={styles.name}>{file?.name ?? basename(path)}</span>
        {/* Only the directory: repeating the filename next to itself would eat
            the width a narrow dock doesn't have. RTL clipping keeps the tail —
            the folder the file actually sits in — when even that is too long. */}
        <span style={styles.path} title={file?.path ?? path}>{dirname(file?.path ?? path)}</span>
        {hasSource && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setShowSource((v) => !v)}
            title={showSource ? 'Show the rendered file' : 'Show the source'}
          >
            {showSource ? 'Rendered' : 'Source'}
          </button>
        )}
        <button
          className="btn btn-icon-sm btn-ghost"
          onClick={() => setFinding((v) => !v)}
          title="Open another file"
          aria-label="Open another file"
        >
          <MagnifyingGlass size={14} />
        </button>
      </div>

      <div style={styles.body}>
        {finding ? (
          <Finder onPick={pick} onCancel={() => setFinding(false)} />
        ) : loading ? (
          <div style={styles.hint}>Loading…</div>
        ) : error ? (
          <div style={styles.error}>{error}</div>
        ) : !file ? null : file.binary ? (
          <div style={styles.hint}>
            Binary file — {fmtCount(file.size)} bytes. Nothing to show here.
          </div>
        ) : (
          <>
            {/* Only when text is what's on screen: the picture itself is whole,
                so warning about a partial read next to it would just confuse. */}
            {file.truncated && (!file.image || showSource) && (
              <div style={styles.notice}>
                <Warning size={13} color={theme.warn} />
                Showing the first part of a {fmtCount(file.size)}-byte file.
              </div>
            )}
            {file.image && !showSource ? (
              // Loaded straight from disk through the asset protocol — the
              // workspace folders are already in its scope (see
              // allow_workspace_assets), and a photo has no business being
              // pushed through IPC as bytes.
              <div style={styles.imageWrap}>
                <img
                  src={convertFileSrc(file.abs_path)}
                  alt={file.name}
                  style={styles.image}
                  onError={() => setError('Could not display this image.')}
                />
              </div>
            ) : isMarkdown && !showSource ? (
              <div className="md" style={styles.mdWrap}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{file.content}</ReactMarkdown>
              </div>
            ) : (
              <div style={styles.codeWrap}>
                <CodeViewer code={file.content} language={file.language} startLine={1} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
