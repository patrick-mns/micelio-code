import React, { useEffect, useState, useRef } from 'react';
import { gitContextStyles } from '@/utils/theme-styles';
import { CaretUpDown, FolderOpen, GitBranch, Check } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import type { GitContext as GitInfo } from '@/types';
import ContextWindow from './ContextWindow';

interface GitContextProps {
  onPickWorkspace: () => void;
  /** Increment this to trigger an immediate git refresh (e.g. after sending a message). */
  refreshTick?: number;
}

export default function GitContext({ onPickWorkspace, refreshTick = 0 }: GitContextProps) {
  const { settings, currentWorkspace, setActiveRoot, activeRoot } = useStore();
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reset active folder when workspace changes
  useEffect(() => {
    setActiveFolder(null);
  }, [currentWorkspace?.id]);

  // Close menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const load = async () => {
    setLoading(true);
    try {
      const info = await ipc.getGitContext();
      setGitInfo(info);
    } catch (e) {
      console.error('failed to get git context', e);
    } finally {
      setLoading(false);
    }
  };

  // Reload when workspace changes or caller bumps refreshTick.
  useEffect(() => {
    load();
  }, [settings?.workspace, refreshTick, activeFolder]);

  // Polling every 15 s.
  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [settings?.workspace]);

  if (!gitInfo && loading) {
    return null;
  }

  // Folder selector: show all folders from the current workspace
  const folders = currentWorkspace?.folders || [];
  const currentFolder = activeFolder || folders[0] || '';
  const folderName = currentFolder.split('/').pop() || currentFolder.split('\\').pop() || 'workspace';
  const hasChanges = gitInfo && (gitInfo.added > 0 || gitInfo.modified > 0 || gitInfo.deleted > 0);

  const switchFolder = async (folder: string) => {
    setMenuOpen(false);
    try {
      await ipc.setWorkspaceRoot(folder);
      setActiveFolder(folder);
      // Refresh the graph FIRST so the treemap has fresh data for this folder,
      // then set activeRoot so the filter runs with accurate nodes.
      await useStore.getState().refreshGraph();
      setActiveRoot(folder);
    } catch (e) {
      console.error('failed to switch workspace root', e);
    }
  };

  return (
    <div style={gitContextStyles.root}>
      {/* Folder selector — only when workspace has folders */}
      {folders.length > 0 && (
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="btn btn-ghost"
            style={gitContextStyles.folderBtn}
            onClick={() => setMenuOpen(!menuOpen)}
            title={currentFolder}
          >
            <FolderOpen size={14} />
            <span style={gitContextStyles.folderName}>{folderName}</span>
            <CaretUpDown size={12} color={theme.dim} />
          </button>

          {menuOpen && (
            <div style={gitContextStyles.folderDropdown}>
              {folders.map((f) => {
                const name = f.split('/').pop() || f.split('\\').pop() || f;
                const isActive = f === currentFolder;
                return (
                  <button
                    key={f}
                    className={isActive ? 'role-item is-active' : 'role-item'}
                    onClick={() => switchFolder(f)}
                    style={gitContextStyles.folderItem}
                  >
                    <FolderOpen size={13} color={isActive ? theme.accent : theme.faint} style={{ flexShrink: 0 }} />
                    <span style={gitContextStyles.folderItemName}>{name}</span>
                    {isActive && <Check size={12} color={theme.accent} weight="bold" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {gitInfo && gitInfo.branch !== 'no git' && (
        <span style={gitContextStyles.branch}>
          <GitBranch size={12} />
          {gitInfo.branch}
        </span>
      )}

      {/* Right-aligned group: diff stats + context-window usage. */}
      <div style={gitContextStyles.right}>
        {hasChanges && (
          <span style={gitContextStyles.changes}>
            {gitInfo.added > 0 && (
              <span style={{ ...gitContextStyles.stat, color: theme.success }}>+{gitInfo.added}</span>
            )}
            {gitInfo.deleted > 0 && (
              <span style={{ ...gitContextStyles.stat, color: theme.error }}>-{gitInfo.deleted}</span>
            )}
          </span>
        )}
        <ContextWindow />
      </div>
    </div>
  );
}

