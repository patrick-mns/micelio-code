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
        <div style={styles.iconWrap}>
          <FolderOpen size={28} color={theme.accent} weight="duotone" />
        </div>
        <h1 style={styles.title}>Create your first workspace</h1>
        <p style={styles.subtitle}>
          A workspace holds its own folders, conversations, and knowledge graph.
          Open a folder to get started, or create an empty one and add folders later.
        </p>

        <button
          onClick={openFolder}
          disabled={disabled}
          className="btn btn-primary"
          style={styles.primaryBtn}
        >
          <FolderOpen size={16} weight="bold" />
          {busy ? 'Opening…' : 'Open a folder'}
        </button>

        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <span style={styles.dividerLine} />
        </div>

        <form onSubmit={createEmpty} style={styles.form}>
          <input
            type="text"
            placeholder="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            style={styles.input}
          />
          <button
            type="submit"
            disabled={disabled || !name.trim()}
            className="btn btn-outline"
            style={styles.createBtn}
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
    maxWidth: 380,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 14,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: theme.cardActive,
    border: `1px solid ${theme.border}`,
    marginBottom: 2,
  },
  title: { fontSize: 17, fontWeight: 600, color: theme.text, margin: 0 },
  subtitle: { fontSize: 12.5, lineHeight: 1.5, color: theme.dim, margin: 0 },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    width: '100%', justifyContent: 'center', marginTop: 6,
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', margin: '2px 0',
  },
  dividerLine: { flex: 1, height: 1, background: theme.border },
  dividerText: { fontSize: 11.5, color: theme.faint },
  form: { display: 'flex', gap: 8, width: '100%' },
  input: {
    flex: 1, background: theme.bgDeep, border: `1px solid ${theme.border}`,
    borderRadius: 'var(--radius-md)', padding: '8px 11px', fontSize: 13,
    color: theme.text, fontFamily: 'inherit', outline: 'none',
  },
  createBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 },
};
