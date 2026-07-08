import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { Plus, Trash, PencilSimple, FolderOpen } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { fieldStyles, workspaceSettingsStyles } from '@/utils/theme-styles';

export default function WorkspaceSettings() {
  const {
    currentWorkspace,
    allWorkspaces,
    workspaceLoading,
    loadAllWorkspaces,
    createWorkspace,
    switchWorkspace,
    addFolderToWorkspace,
    removeFolderFromWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useStore();

  const [editingName, setEditingName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [createName, setCreateName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadAllWorkspaces(); }, [loadAllWorkspaces]);

  // Sync editing name when current workspace changes (and when not actively editing)
  useEffect(() => {
    if (currentWorkspace) setEditingName(currentWorkspace.name);
  }, [currentWorkspace]);

  // Select all text when entering edit mode
  useEffect(() => {
    if (isEditing) {
      const t = setTimeout(() => nameInputRef.current?.select(), 10);
      return () => clearTimeout(t);
    }
  }, [isEditing]);

  if (!currentWorkspace) {
    return (
      <div style={{ padding: '24px 0', color: theme.dim, fontSize: 13 }}>
        Loading workspace…
      </div>
    );
  }

  const commitRename = async () => {
    if (!isEditing) return;
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === currentWorkspace.name) {
      setEditingName(currentWorkspace.name);
      setIsEditing(false);
      return;
    }
    try { await renameWorkspace(trimmed); } catch (e) { console.error(e); }
    setIsEditing(false);
  };

  const startEditing = () => {
    setEditingName(currentWorkspace.name);
    setIsEditing(true);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>

      {/* ── Current workspace name ── */}
      <Section title="WORKSPACE">
        <div style={workspaceSettingsStyles.listCard}>
          <input
            ref={nameInputRef}
            type="text"
            value={isEditing ? editingName : currentWorkspace.name}
            onChange={(e) => setEditingName(e.target.value)}
            onFocus={() => { if (!isEditing) startEditing(); }}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitRename(); nameInputRef.current?.blur(); }
              if (e.key === 'Escape') { setEditingName(currentWorkspace.name); setIsEditing(false); nameInputRef.current?.blur(); }
            }}
            style={workspaceSettingsStyles.nameInput}
          />
          <button
            onClick={startEditing}
            className="icon-btn-sm"
            title="Rename workspace"
            style={{ flexShrink: 0 }}
          >
            <PencilSimple size={13} color={theme.dim} />
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
                <div key={folder} style={workspaceSettingsStyles.listCard}>
                  <div style={workspaceSettingsStyles.listCardColumn}>
                    <span style={workspaceSettingsStyles.dirName}>{dirName}</span>
                    <span style={workspaceSettingsStyles.dirPath}>
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
          className="btn btn-sm btn-outline"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4 }}
        >
          <Plus size={14} weight="bold" />
          {addingFolder ? 'Adding…' : 'Add folder'}
        </button>
      </Section>

      {/* ── All workspaces ── */}
      <Section title="ALL WORKSPACES">
        {allWorkspaces.length === 0 ? (
          <div style={fieldStyles.desc}>No workspaces found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {allWorkspaces.map((ws) => {
              const isCurrent = ws.id === currentWorkspace.id;
              return (
                <div
                  key={ws.id}
                  onClick={() => { if (!isCurrent && !workspaceLoading) switchWorkspace(ws.id); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 6,
                    background: isCurrent ? theme.bgDeep : 'transparent',
                    border: `1px solid ${isCurrent ? theme.border : 'transparent'}`,
                    cursor: !isCurrent && !workspaceLoading ? 'pointer' : 'default',
                    transition: 'background 0.1s, border-color 0.1s',
                    opacity: workspaceLoading && !isCurrent ? 0.5 : 1,
                    pointerEvents: workspaceLoading && !isCurrent ? 'none' : 'auto',
                  }}
                >
                  <FolderOpen size={16} color={isCurrent ? theme.accent : theme.dim} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={workspaceSettingsStyles.wsName}>{ws.name}</span>
                    <span style={workspaceSettingsStyles.wsPath}>
                      {ws.folders.length} folder{ws.folders.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {isCurrent && (
                    <span style={workspaceSettingsStyles.activeBadge}>Active</span>
                  )}
                  {!isCurrent && (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete workspace "${ws.name}"?`)) deleteWorkspace(ws.id); }}
                      className="icon-btn-sm"
                      title="Delete workspace"
                      style={{ flexShrink: 0, color: theme.dim, opacity: 0.5 }}
                    >
                      <Trash size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── New workspace ── */}
      <Section title="NEW WORKSPACE">
        <div style={fieldStyles.desc}>Create a fresh workspace with its own sessions, graph, and folders.</div>
        <form onSubmit={handleCreateWorkspace} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            type="text"
            placeholder="Workspace name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            style={fieldStyles.input}
          />
          <button
            type="submit"
            disabled={!createName.trim()}
            className="btn btn-sm btn-primary"
          >
            Create
          </button>
        </form>
      </Section>

    </div>
  );
}