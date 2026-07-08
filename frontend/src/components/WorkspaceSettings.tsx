import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { Plus, Trash, PencilSimple } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { fieldStyles } from '@/utils/theme-styles';

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

export default function WorkspaceSettings() {
  const {
    currentWorkspace,
    loadAllWorkspaces,
    createWorkspace,
    addFolderToWorkspace,
    removeFolderFromWorkspace,
    renameWorkspace,
  } = useStore();

  const [editingName, setEditingName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [createName, setCreateName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadAllWorkspaces(); }, [loadAllWorkspaces]);
  useEffect(() => {
    if (currentWorkspace) setEditingName(currentWorkspace.name);
  }, [currentWorkspace]);
  useEffect(() => {
    if (isEditing) nameInputRef.current?.select();
  }, [isEditing]);

  if (!currentWorkspace) {
    return <div style={{ color: theme.dim, fontSize: 13 }}>Loading workspace…</div>;
  }

  const commitRename = async () => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === currentWorkspace.name) {
      setEditingName(currentWorkspace.name);
      setIsEditing(false);
      return;
    }
    try { await renameWorkspace(trimmed); } catch (e) { console.error(e); }
    setIsEditing(false);
  };

  const handleAddFolder = async () => {
    setAddingFolder(true);
    try {
      const path = await ipc.pickFolder(currentWorkspace.folders[0]);
      if (path) await addFolderToWorkspace(path);
    } catch (e) { console.error(e); }
    finally { setAddingFolder(false); }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    try { await createWorkspace(createName.trim(), []); setCreateName(''); } catch (e) { console.error(e); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Current workspace name ── */}
      <Section title="WORKSPACE">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={nameInputRef}
            type="text"
            value={isEditing ? editingName : currentWorkspace.name}
            onChange={(e) => {
              setEditingName(e.target.value);
              if (!isEditing) setIsEditing(true);
            }}
            onFocus={() => {
              setEditingName(currentWorkspace.name);
              setIsEditing(true);
              setTimeout(() => nameInputRef.current?.select(), 0);
            }}
            onBlur={() => {
              if (isEditing) commitRename();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitRename(); nameInputRef.current?.blur(); }
              if (e.key === 'Escape') { setEditingName(currentWorkspace.name); setIsEditing(false); nameInputRef.current?.blur(); }
            }}
            style={{
              flex: 1,
              fontSize: 15,
              fontWeight: 550,
              color: theme.text,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => {
              setEditingName(currentWorkspace.name);
              setIsEditing(true);
              setTimeout(() => nameInputRef.current?.focus(), 0);
            }}
            className="icon-btn-sm"
            title="Rename workspace"
            style={{ flexShrink: 0 }}
          >
            <PencilSimple size={14} color={theme.dim} />
          </button>
        </div>
      </Section>

      {/* ── Folders ── */}
      <Section title="FOLDERS">
        {currentWorkspace.folders.length === 0 ? (
          <div style={{ ...fieldStyles.desc, padding: '4px 0 8px' }}>
            No folders yet. Add one to start scanning files.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {currentWorkspace.folders.map((folder) => {
              const parts = folder.split(/[/\\]/);
              const dirName = parts[parts.length - 1] || folder;

              return (
                <div
                  key={folder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: theme.bgDeep,
                    border: `1px solid ${theme.border}`,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{dirName}</span>
                    <span style={{ ...mono, fontSize: 11, color: theme.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {folder}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFolderFromWorkspace(folder)}
                    className="icon-btn-sm"
                    title="Remove folder"
                    style={{ flexShrink: 0, marginLeft: 12 }}
                  >
                    <Trash size={13} color={theme.dim} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={handleAddFolder}
          disabled={addingFolder}
          className="ghost-btn"
          style={{
            padding: '8px 14px',
            fontSize: 12.5,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            color: theme.accent,
            background: theme.bgDeep,
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
          }}
        >
          <Plus size={14} weight="bold" />
          {addingFolder ? 'Adding…' : 'Add folder'}
        </button>
      </Section>

      {/* ── New workspace ── */}
      <Section title="NEW WORKSPACE">
        <div style={fieldStyles.desc}>Create a fresh workspace with its own sessions, graph, and folders.</div>
        <form onSubmit={handleCreateWorkspace} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            type="text"
            placeholder="Name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            style={fieldStyles.input}
          />
          <button
            type="submit"
            disabled={!createName.trim()}
            style={{
              padding: '7px 16px',
              fontSize: 12.5,
              fontWeight: 500,
              background: createName.trim() ? theme.accent : theme.bgDeep,
              border: `1px solid ${createName.trim() ? theme.accent : theme.border}`,
              borderRadius: 6,
              color: createName.trim() ? '#fff' : theme.dim,
              cursor: createName.trim() ? 'pointer' : 'default',
            }}
          >
            Create
          </button>
        </form>
      </Section>

    </div>
  );
}