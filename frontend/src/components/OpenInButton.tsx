import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { openInButtonStyles } from '@/utils/theme-styles';
import { Code, FolderOpen, Terminal, CaretDown } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { theme } from '@/theme';
import type { Opener } from '@/types';

const LAST_KEY = 'openInApp';

function iconFor(kind: string, size = 15): ReactNode {
  if (kind === 'finder') return <FolderOpen size={size} />;
  if (kind === 'terminal') return <Terminal size={size} />;
  return <Code size={size} />;
}

// Split button in the titlebar: the main half opens the workspace in the last
// used app; the caret opens a menu of all auto-detected apps.
//
// HIDDEN — return null below. Kept as reference until the compact SVG-opener-icon
// version replaces the generic phosphor icons (see BACKLOG.md).
export default function OpenInButton() {
  const [openers, setOpeners] = useState<Opener[]>([]);
  const [current, setCurrent] = useState<string | null>(null); // opener id
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ipc.listOpeners().then((list) => {
      setOpeners(list);
      const saved = localStorage.getItem(LAST_KEY);
      const pick = list.find((o) => o.id === saved) || list.find((o) => o.kind === 'editor') || list[0];
      setCurrent(pick?.id ?? null);
    }).catch(console.error);
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  return null; // HIDDEN — see comment at top

  if (openers.length === 0 || !current) return null;
  const active = openers.find((o) => o.id === current) ?? openers[0];

  const open = (id: string) => {
    ipc.openIn(id).catch(console.error);
    localStorage.setItem(LAST_KEY, id);
    setCurrent(id);
    setMenuOpen(false);
  };

  return (
    <div ref={wrapRef} style={openInButtonStyles.wrap}>
      <button className="open-in-btn" style={openInButtonStyles.main} title={`Open workspace in ${active.name}`} onClick={() => open(active.id)}>
        {iconFor(active.kind)}
        <span style={openInButtonStyles.name}>{active.name}</span>
      </button>
      <button className="open-in-btn" style={openInButtonStyles.caret} title="Open in…" onClick={() => setMenuOpen((v) => !v)}>
        <CaretDown size={12} />
      </button>

      {menuOpen && (
        <div style={openInButtonStyles.menu}>
          {openers.map((o) => (
            <button
              key={o.id}
              className={o.id === current ? 'menu-item is-active' : 'menu-item'}
              onClick={() => open(o.id)}
            >
              {iconFor(o.kind, 16)}
              <span>{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

