// The workspace tree. Browsing lives here; reading a file lives in the File
// tab, and clicking a row is what connects them.
//
// The split is the point: this panel never renders a file, and the viewer never
// browses. `openFile` already decides *which* File tab a path lands in — the one
// holding it, else the one on screen, else a new one — so a click here needs no
// plumbing of its own.
import { useCallback, useEffect, useState } from 'react';
import { CaretRight, FileCode, MagnifyingGlass } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import { filesPanelStyles as styles, fieldStyles } from '@/utils/theme-styles';
import type { DirEntry, FileHit } from '@/types';

// Deep enough to read as nesting, shallow enough that a narrow dock still has
// room for the name at four or five levels down.
const INDENT_PX = 12;

interface FilesPanelProps {
  /** Opens a path in a File tab. The tree's only job once a row is clicked. */
  onOpenPath: (path: string) => void;
}

export default function FilesPanel({ onOpenPath }: FilesPanelProps) {
  // Children by directory path; the root is ''. Absence means "not read yet",
  // which is what makes the tree lazy — a folder nobody opened is never listed.
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FileHit[]>([]);

  // The tree is rooted at the selected folder, so switching folder rebuilds it
  // rather than leaving another project's paths on screen.
  const activeRoot = useStore((s) => s.activeRoot);
  const workspaceId = useStore((s) => s.currentWorkspace?.id ?? null);

  const load = useCallback((dir: string) => {
    setLoading((l) => new Set(l).add(dir));
    ipc.listWorkspaceDir(dir || null)
      .then((entries) => setChildren((c) => ({ ...c, [dir]: entries })))
      .catch((e) => setError(typeof e === 'string' ? e : 'Could not read this folder'))
      .finally(() => setLoading((l) => { const n = new Set(l); n.delete(dir); return n; }));
  }, []);

  useEffect(() => {
    setChildren({});
    setOpen(new Set());
    setError('');
    load('');
  }, [load, activeRoot, workspaceId]);

  // Filtering hands over to the fuzzy search that already backs the composer's
  // @-mention, so one query language covers both. It is scoped by `.gitignore`
  // where the tree isn't: searching is for the code you work on, browsing is for
  // what's actually on disk.
  useEffect(() => {
    if (!query) { setHits([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      ipc.searchWorkspaceFiles(query, 60)
        .then((h) => { if (alive) setHits(h); })
        .catch(() => { if (alive) setHits([]); });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [query, activeRoot]);

  const toggle = (dir: string) => {
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        if (!children[dir]) load(dir);
      }
      return next;
    });
  };

  // Flattened to what's actually visible: a closed folder contributes only its
  // own row, so the list is as long as what the user has opened, not as long as
  // the project.
  const rows: { entry: DirEntry; depth: number }[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of children[dir] ?? []) {
      rows.push({ entry, depth });
      if (entry.is_dir && open.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  walk('', 0);

  return (
    <div style={styles.panel}>
      <div style={styles.searchRow}>
        <MagnifyingGlass size={14} color={theme.faint} style={{ flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          placeholder="Filter files…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
          style={{ ...fieldStyles.input, border: 'none', background: 'transparent', padding: 0 }}
        />
      </div>

      <div style={styles.list}>
        {error ? (
          <div style={styles.error}>{error}</div>
        ) : query ? (
          hits.length === 0 ? (
            <div style={styles.hint}>Nothing matches.</div>
          ) : (
            hits.map((hit) => (
              <button key={hit.path} className="tree-row" onClick={() => onOpenPath(hit.path)}>
                <FileCode size={14} color={theme.dim} style={{ flexShrink: 0 }} />
                <span style={styles.name}>{hit.name}</span>
                {/* The folder is what tells two same-named files apart, so it
                    travels with the result rather than being dropped. */}
                <span style={styles.dir}>{hit.path.split('/').slice(0, -1).join('/')}</span>
              </button>
            ))
          )
        ) : rows.length === 0 && !loading.has('') ? (
          <div style={styles.hint}>This folder is empty.</div>
        ) : (
          rows.map(({ entry, depth }) => (
            <button
              key={entry.path}
              className="tree-row"
              style={{ paddingLeft: 6 + depth * INDENT_PX }}
              onClick={() => (entry.is_dir ? toggle(entry.path) : onOpenPath(entry.path))}
            >
              {entry.is_dir ? (
                <CaretRight
                  size={12}
                  color={theme.dim}
                  style={{
                    flexShrink: 0,
                    // Rotated rather than swapped for a down-caret, so the glyph
                    // can animate and never changes weight mid-turn.
                    transform: open.has(entry.path) ? 'rotate(90deg)' : 'none',
                    transition: 'transform 120ms ease',
                  }}
                />
              ) : (
                <FileCode size={14} color={theme.dim} style={{ flexShrink: 0 }} />
              )}
              <span style={styles.name}>{entry.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
