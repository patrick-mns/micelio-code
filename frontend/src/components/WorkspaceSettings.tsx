import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { Plus, Trash, FolderOpen } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { fieldStyles } from '@/utils/theme-styles';
import ConfirmModal from './ConfirmModal';

const MONO = 'ui-monospace, SFMono-Regular, monospace';

export default function WorkspaceSettings() {
  const {
    currentWorkspace,
    workspacesWithSessions,
    workspaceLoading,
    loadWorkspacesWithSessions,
    createWorkspace,
    switchWorkspace,
    addFolderToWorkspace,
    removeFolderFromWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useStore();

  const [name, setName] = useState('');
  const [createName, setCreateName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [confirmDeleteWs, setConfirmDeleteWs] = useState<string | null>(null); // workspace id or null
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadWorkspacesWithSessions(); }, [loadWorkspacesWithSessions]);

  // Keep the name field in sync with the current workspace, but not while the
  // field is focused (would clobber in-progress typing on background reloads).
  useEffect(() => {
    if (currentWorkspace && document.activeElement !== nameRef.current) {
      setName(currentWorkspace.name);
    }
  }, [currentWorkspace]);

  const commitRename = async () => {
    if (!currentWorkspace) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentWorkspace.name) {
      setName(currentWorkspace.name);
      return;
    }
    try { await renameWorkspace(trimmed); } catch (e) { console.error(e); }
  };

  const handleAddFolder = async () => {
    if (!currentWorkspace) return;
    setAddingFolder(true);
    try {
      const path = await ipc.pickFolder(currentWorkspace.folders[0]);
      if (path) await addFolderToWorkspace(path);
    } catch (e) { console.error(e); }
    finally { setAddingFolder(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    try { await createWorkspace(createName.trim(), []); setCreateName(''); } catch (e) { console.error(e); }
  };

  const dirName = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() || p;

  return (
    <div>
      {currentWorkspace && (
        <>
          <Section title="NAME">
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') nameRef.current?.blur();
                if (e.key === 'Escape') { setName(currentWorkspace.name); nameRef.current?.blur(); }
              }}
              style={{ ...fieldStyles.input, width: '100%' }}
            />
          </Section>

          <Section title="FOLDERS">
            {currentWorkspace.folders.length === 0 ? (
              <div style={fieldStyles.desc}>No folders yet — add one to index files.</div>
            ) : (
              <div>
                {currentWorkspace.folders.map((folder) => (
                  <div key={folder} style={styles.row}>
                    <FolderOpen size={15} color={theme.faint} style={{ flexShrink: 0 }} />
                    <div style={styles.col}>
                      <span style={styles.name}>{dirName(folder)}</span>
                      <span style={styles.path}>{folder}</span>
                    </div>
                    <button
                      onClick={() => removeFolderFromWorkspace(folder)}
                      className="icon-btn-sm"
                      title="Remove folder"
                      style={{ flexShrink: 0 }}
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={handleAddFolder}
              disabled={addingFolder}
              className="btn btn-sm btn-solid"
              style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <Plus size={13} weight="bold" />
              {addingFolder ? 'Adding…' : 'Add folder'}
            </button>
          </Section>
        </>
      )}

      <Section title="ALL WORKSPACES">
        {workspacesWithSessions.length === 0 ? (
          <div style={fieldStyles.desc}>No workspaces yet.</div>
        ) : (
          <div>
            {workspacesWithSessions.map((ws) => {
              const isCurrent = ws.id === currentWorkspace?.id;
              const canSwitch = !isCurrent && !workspaceLoading;
              return (
                <div
                  key={ws.id}
                  onClick={() => { if (canSwitch) switchWorkspace(ws.id); }}
                  style={{
                    ...styles.row,
                    cursor: canSwitch ? 'pointer' : 'default',
                    opacity: workspaceLoading && !isCurrent ? 0.5 : 1,
                    borderRadius: 6,
                  }}
                  onMouseEnter={(e) => { if (canSwitch) e.currentTarget.style.background = theme.cardActive; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <FolderOpen size={15} color={theme.faint} style={{ flexShrink: 0 }} />
                  <div style={styles.col}>
                    <span style={{ ...styles.name, color: theme.textSoft }}>{ws.name}</span>
                    <span style={styles.sub}>
                      {ws.folders.length} folder{ws.folders.length !== 1 ? 's' : ''}
                      {ws.sessions.length > 0 && ` · ${ws.sessions.length} session${ws.sessions.length !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteWs(ws.id); }}
                    className="icon-btn-sm"
                    title="Delete workspace"
                    style={{ flexShrink: 0 }}
                  >
                    <Trash size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="text"
            placeholder="New workspace name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            style={{ ...fieldStyles.input, width: '100%' }}
          />
          <button type="submit" disabled={!createName.trim()} className="btn btn-md btn-solid" style={{ flexShrink: 0 }}>
            Create
          </button>
        </form>
      </Section>

      <ConfirmModal
        open={!!confirmDeleteWs}
        title="Delete workspace"
        message="This will permanently delete the workspace and all its chats. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => { if (confirmDeleteWs) deleteWorkspace(confirmDeleteWs); setConfirmDeleteWs(null); }}
        onCancel={() => setConfirmDeleteWs(null)}
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 6px', margin: '0 -6px',
    borderBottom: `1px solid ${theme.card}`,
    transition: 'background 0.1s',
  },
  col: { flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 },
  name: {
    fontSize: 13, color: theme.text,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  sub: {
    fontSize: 11, color: theme.dim,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  path: {
    fontFamily: MONO, fontSize: 10.5, color: theme.dim,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};
