import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Warning } from '@phosphor-icons/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipc } from '@/ipc';
import { fmtCount } from '@/utils/formatters';
import { filePanelStyles as styles } from '@/utils/theme-styles';
import { theme } from '@/theme';
import CodeViewer from '@/components/CodeViewer';
import { mdComponents } from '@/components/MdComponents';
import type { FileContent, FileRef } from '@/types';

/** The folder part, empty at the root. All the header shows, since the tab
 * itself is named after the file. */
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

  // Same reason CodeViewer is memoized: parsing the document is expensive, and
  // this panel re-renders on every token of a streaming reply because App
  // subscribes to the whole store. Without this, reading a document while the
  // agent answers reparses it dozens of times a second.
  const markdownBody = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {file?.content ?? ''}
      </ReactMarkdown>
    ),
    [file?.content, components],
  );

  // Nothing to show yet. Browsing belongs to the Files tab now, so this points
  // there rather than growing a second picker of its own.
  if (!path) {
    return (
      <div style={styles.panel}>
        <div style={styles.hint}>Pick a file in the Files tab to read it here.</div>
      </div>
    );
  }

  const isMarkdown = file?.language === 'markdown';
  // An SVG both renders and reads, so the toggle isn't markdown's alone: it's
  // offered whenever there's a rendered form *and* source behind it.
  const hasSource = (isMarkdown || !!file?.image) && !!file?.content;
  const dir = dirname(file?.path ?? path);

  return (
    <div style={styles.panel}>
      {/* Only the directory. The tab is already named after the file, so
          repeating the filename here said the same thing twice and ate the
          width a narrow dock doesn't have. RTL clipping keeps the tail — the
          folder the file actually sits in — when even that is too long. A file
          at the root has no directory, and then there's nothing to draw. */}
      {(dir || hasSource) && (
        <div style={styles.head}>
          <span style={styles.path} title={file?.path ?? path}>{dir}</span>
          {hasSource && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setShowSource((v) => !v)}
              title={showSource ? 'Show the rendered file' : 'Show the source'}
            >
              {showSource ? 'Rendered' : 'Source'}
            </button>
          )}
        </div>
      )}

      <div style={styles.body}>
        {loading ? (
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
              <div className="md" style={styles.mdWrap}>{markdownBody}</div>
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
