import React, { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { Plus, Trash, FolderOpen, PencilSimple, Check } from '@phosphor-icons/react';

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

  useEffect(() => {
    loadAllWorkspaces();
  }, [loadAllWorkspaces]);

  useEffect(() => {
    if (currentWorkspace) {
      setNewName(currentWorkspace.name);
    }
  }, [currentWorkspace]);

  if (!currentWorkspace) {
    return <div style={{ color: theme.dim }}>Loading workspace...</div>;
  }

  const handleRename = async () => {
    if (!newName.trim() || newName === currentWorkspace.name) {
      setEditing(false);
      return;
    }
    try {
      await renameWorkspace(newName.trim());
      setEditing(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddFolder = async () => {
    setAddingFolder(true);
    try {
      // Pick logic via Tauri dialog
      // @ts-ignore
      const { dialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await dialog.open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        await addFolderToWorkspace(selected);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAddingFolder(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    try {
      await createWorkspace(createName.trim(), []);
      setCreateName('');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      {/* 1. Nome do Workspace */}
      <Section title="CURRENT WORKSPACE">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {editing ? (
            <div style={{ display: 'flex', gap: 8, flex: 1 }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.05)',
                  border: `1px solid ${theme.border}`,
                  borderRadius: 4,
                  padding: '6px 12px',
                  color: theme.text,
                  fontSize: 13,
                  outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setNewName(currentWorkspace.name);
                    setEditing(false);
                  }
                }}
                autoFocus
              />
              <button
                onClick={handleRename}
                style={{
                  background: theme.accent,
                  border: 'none',
                  borderRadius: 4,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#fff',
                }}
              >
                <Check size={14} weight="bold" />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ fontSize: 16, fontWeight: 550, color: theme.text }}>
                {currentWorkspace.name}
              </div>
              <button
                onClick={() => setEditing(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.dim,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4,
                }}
                title="Rename workspace"
              >
                <PencilSimple size={15} />
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* 2. Folders / Pastas inclusas no workspace */}
      <Section title="INCLUDED FOLDERS">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {currentWorkspace.folders.length === 0 ? (
            <div style={{ color: theme.dim, fontSize: 12, fontStyle: 'italic', padding: '4px 0' }}>
              No folders added yet. This workspace is empty.
            </div>
          ) : (
            currentWorkspace.folders.map((folder) => {
              const parts = folder.split(/[/\\]/);
              const dirName = parts[parts.length - 1] || folder;

              return (
                <div
                  key={folder}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${theme.border}`,
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 500, color: theme.text }}>{dirName}</div>
                    <div style={{ fontSize: 11, color: theme.dim, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {folder}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFolderFromWorkspace(folder)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255,69,58,0.7)',
                      cursor: 'pointer',
                      padding: 6,
                    }}
                    title="Remove folder from workspace"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              );
            })
          )}

          <button
            onClick={handleAddFolder}
            disabled={addingFolder}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '10px',
              border: `1px dashed ${theme.border}`,
              background: 'transparent',
              borderRadius: 6,
              color: theme.dim,
              fontSize: 12,
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            <Plus size={13} />
            {addingFolder ? 'Adding...' : 'Add Folder to Workspace'}
          </button>
        </div>
      </Section>

      {/* 3. Lista de outros workspaces / Trocar de workspace */}
      <Section title="ALL WORKSPACES">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allWorkspaces
            .filter((w) => w.id !== currentWorkspace.id)
            .map((ws) => (
              <div
                key={ws.id}
                onClick={() => switchWorkspace(ws.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'none',
                  border: `1px solid ${theme.border}`,
                  borderRadius: 6,
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
                className="workspace-item-hover"
              >
                <div>
                  <div style={{ fontWeight: 500, color: theme.text }}>{ws.name}</div>
                  <div style={{ fontSize: 11, color: theme.dim }}>
                    {ws.folders.length} folder{ws.folders.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <FolderOpen size={16} color={theme.dim} />
              </div>
            ))}

          {/* Form de criar Workspace */}
          <form
            onSubmit={handleCreateWorkspace}
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 4,
            }}
          >
            <input
              type="text"
              placeholder="New workspace name..."
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                padding: '6px 12px',
                color: theme.text,
                fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!createName.trim()}
              style={{
                background: createName.trim() ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                padding: '6px 12px',
                color: createName.trim() ? theme.text : theme.dim,
                fontSize: 12,
                cursor: createName.trim() ? 'pointer' : 'default',
              }}
            >
              Create
            </button>
          </form>
        </div>
      </Section>
    </div>
  );
}
