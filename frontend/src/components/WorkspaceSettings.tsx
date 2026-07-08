import React, { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { Plus, Trash, FolderOpen, PencilSimple, Check } from '@phosphor-icons/react';
import { ipc } from '@/ipc';

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

export default function WorkspaceSettings() {
  const {
    currentWorkspace,
    allWorkspaces,
    loadAllWorkspaces,
    createWorkspace,
    switchWorkspace,
    addFolderToWorkspace,
    removeFolderFromWorkspace,
    renameWorkspace,
  } = useStore();

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(false);
  const [createName, setCreateName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);

  useEffect(() => { loadAllWorkspaces(); }, [loadAllWorkspaces]);
  useEffect(() => {
    if (currentWorkspace) setNewName(currentWorkspace.name);
  }, [currentWorkspace]);

  if (!currentWorkspace) {
    return <div style={{ color: theme.dim, fontSize: 13 }}>Loading workspace…</div>;
  }

  const handleRename = async () => {
    if (!newName.trim() || newName === currentWorkspace.name) {
      setEditing(false);
      return;
    }
    try { await renameWorkspace(newName.trim()); setEditing(false); } catch (e) { console.error(e); }
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
      <Section title="WORKSPACE NAME">
        {editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="inline-input"
              style={{ flex: 1, fontSize: 15, fontWeight: 500 }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setNewName(currentWorkspace.name); setEditing(false); } }}
              autoFocus
            />
            <button onClick={handleRename} className="icon-btn-sm" style={{ color: theme.accent }} title="Save">
              <Check size={15} weight="bold" />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FolderOpen size={18} color={theme.accent} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 550, color: theme.text }}>{currentWorkspace.name}</span>
            <button onClick={() => setEditing(true)} className="icon-btn-sm" title="Rename">
              <PencilSimple size={14} color={theme.dim} />
            </button>
          </div>
        )}
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

      {/* ── Switch workspace ── */}
      <Section title="SWITCH WORKSPACE">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {allWorkspaces
            .filter((w) => w.id !== currentWorkspace.id)
            .map((ws) => (
              <button
                key={ws.id}
                onClick={() => switchWorkspace(ws.id)}
                className="menu-item"
                style={{ justifyContent: 'space-between', width: '100%' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{ws.name}</span>
                  <span style={{ fontSize: 11, color: theme.dim }}>
                    {ws.folders.length} folder{ws.folders.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <FolderOpen size={15} color={theme.dim} />
              </button>
            ))}
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