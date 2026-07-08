import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { Plus, Trash, FolderOpen, PencilSimple } from '@phosphor-icons/react';
import { ipc } from '@/ipc';

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FolderOpen size={18} color={theme.accent} style={{ flexShrink: 0, opacity: 0.9 }} />

          {isEditing ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditingName(currentWorkspace.name); setIsEditing(false); }
              }}
              className="inline-input"
              style={{ flex: 1 }}
            />
          ) : (
            <span
              onClick={() => setIsEditing(true)}
              title="Click to rename"
              style={{
                fontSize: 15,
                fontWeight: 550,
                color: theme.text,
                cursor: 'text',
                flex: 1,
                borderRadius: 4,
                padding: '2px 4px',
                margin: '-2px -4px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {currentWorkspace.name}
            </span>
          )}

          <button
            onClick={() => { setEditingName(currentWorkspace.name); setIsEditing(true); }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {currentWorkspace.folders.length === 0 ? (
            <div style={{ color: theme.dim, fontSize: 13, padding: '2px 0' }}>
              No folders yet — add one to get started.
            </div>
          ) : (
            currentWorkspace.folders.map((folder) => {
              const parts = folder.split(/[/\\]/);
              const dirName = parts[parts.length - 1] || folder;

              return (
                <div
                  key={folder}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: theme.text, whiteSpace: 'nowrap' }}>{dirName}</span>
                    <span style={{ ...mono, fontSize: 11, color: theme.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {folder}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFolderFromWorkspace(folder)}
                    className="icon-btn-sm"
                    style={{ color: theme.dim, flexShrink: 0, marginLeft: 8 }}
                    title="Remove folder"
                  >
                    <Trash size={13} />
                  </button>
                </div>
              );
            })
          )}

          <button
            onClick={handleAddFolder}
            disabled={addingFolder}
            className="ghost-btn"
            style={{
              marginTop: 8, padding: '8px 0', fontSize: 12.5, fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 7, color: theme.accent,
              alignSelf: 'flex-start',
            }}
          >
            <Plus size={14} weight="bold" />
            {addingFolder ? 'Adding…' : 'Add folder'}
          </button>
        </div>
      </Section>

      {/* ── New workspace ── */}
      <Section title="NEW WORKSPACE">
        <form onSubmit={handleCreateWorkspace} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className="inline-input"
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            disabled={!createName.trim()}
            className="ghost-btn"
            style={{
              fontSize: 12.5, fontWeight: 500, padding: '7px 14px',
              color: createName.trim() ? theme.accent : theme.dim,
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