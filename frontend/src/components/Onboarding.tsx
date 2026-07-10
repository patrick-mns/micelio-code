import React, { useState } from 'react';
import { FolderOpen, Plus } from '@phosphor-icons/react';
import { useStore } from '@/store';
import { ipc } from '@/ipc';
import { theme } from '@/theme';

/**
 * Shown when the app has no workspace loaded (fresh install or all workspaces
 * deleted). Lets the user create their first workspace instead of the app
 * silently bootstrapping a phantom default.
 */
export default function Onboarding() {
  const { createWorkspace, workspaceLoading } = useStore();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const dirName = (path: string) => path.split(/[/\\]/).filter(Boolean).pop() || path;

  const openFolder = async () => {
    setBusy(true);
    try {
      const path = await ipc.pickFolder().catch(() => null);
      if (path) await createWorkspace(dirName(path), [path]);
    } catch (e) {
      console.error('Failed to open folder', e);
    } finally {
      setBusy(false);
    }
  };

  const createEmpty = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createWorkspace(trimmed, []);
      setName('');
    } catch (err) {
      console.error('Failed to create workspace', err);
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || workspaceLoading;

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <h1 style={styles.title}>Create your first workspace</h1>
        <p style={styles.subtitle}>
          A workspace holds its own folders, conversations, and knowledge graph.
        </p>

        {/* Primary action — mirrors the sidebar's "New session" row: a quiet,
            borderless row that lifts on hover, not a loud filled button. */}
        <button
          onClick={openFolder}
          disabled={disabled}
          style={{ ...styles.openRow, ...(disabled ? styles.rowDisabled : null) }}
          onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = theme.cardActive; e.currentTarget.style.color = theme.text; e.currentTarget.style.borderColor = theme.dim; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = theme.card; e.currentTarget.style.color = theme.textSoft; e.currentTarget.style.borderColor = theme.border; }}
        >
          <FolderOpen size={17} weight="regular" />
          <span style={{ flex: 1, textAlign: 'left' }}>{busy ? 'Opening…' : 'Open a folder'}</span>
          <span style={styles.hint}>scan a project</span>
        </button>

        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <span style={styles.dividerLine} />
        </div>

        <form onSubmit={createEmpty} style={styles.form}>
          <input
            type="text"
            placeholder="Name an empty workspace"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            style={styles.input}
          />
          <button
            type="submit"
            disabled={disabled || !name.trim()}
            className="btn btn-md btn-solid"
            style={{ flexShrink: 0 }}
          >
            <Plus size={15} weight="bold" />
            Create
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  title: { fontSize: 16, fontWeight: 600, color: theme.text, margin: 0, textAlign: 'center' },
  subtitle: {
    fontSize: 12.5, lineHeight: 1.5, color: theme.dim, margin: '0 0 4px',
    textAlign: 'center',
  },
  openRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '11px 14px',
    borderRadius: 'var(--radius-md)',
    background: theme.card,
    border: `1px solid ${theme.border}`,
    color: theme.textSoft,
    fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
    transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
  },
  rowDisabled: { opacity: 0.5, cursor: 'default', pointerEvents: 'none' },
  hint: { fontSize: 11, color: theme.faint, flexShrink: 0 },
  divider: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', margin: '2px 0',
  },
  dividerLine: { flex: 1, height: 1, background: theme.border },
  dividerText: { fontSize: 11.5, color: theme.faint },
  form: { display: 'flex', gap: 8, width: '100%' },
  input: {
    flex: 1, background: theme.bgDeep, border: `1px solid ${theme.border}`,
    borderRadius: 'var(--radius-md)', padding: '0 11px', height: 28, fontSize: 12.5,
    color: theme.text, fontFamily: 'inherit', outline: 'none',
  },
};
