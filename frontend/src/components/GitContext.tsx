import React, { useEffect, useState, useRef } from 'react';
import { gitContextStyles } from '@/utils/theme-styles';
import { CaretDown, FolderOpen, GitBranch, Check } from '@phosphor-icons/react';
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
  const { settings, currentWorkspace } = useStore();
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    setActiveFolder(folder);
    setMenuOpen(false);
    try {
      await ipc.setWorkspaceRoot(folder);
    } catch (e) {
      console.error('failed to switch workspace root', e);
    }
  };

  return (
    <div style={gitContextStyles.root}>
      {/* Folder selector dropdown */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          className="repo-btn"
          style={gitContextStyles.repoBtn}
          onClick={() => setMenuOpen(!menuOpen)}
          title={currentFolder}
        >
          <FolderOpen size={14} />
          <span style={gitContextStyles.repoName}>{folderName}</span>
          <CaretDown size={12} />
        </button>

        {menuOpen && folders.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: theme.bgDeep,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            padding: 4,
            minWidth: 180,
            zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          }}>
            {folders.map((f) => {
              const name = f.split('/').pop() || f.split('\\').pop() || f;
              const isActive = f === currentFolder;
              return (
                <div
                  key={f}
                  onClick={() => switchFolder(f)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: isActive ? theme.cardActive : 'transparent',
                    color: theme.text,
                    fontSize: 12.5,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = theme.cardActive; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <FolderOpen size={13} color={isActive ? theme.accent : theme.faint} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                  {isActive && <Check size={12} color={theme.accent} weight="bold" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

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

