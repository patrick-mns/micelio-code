import React, { useEffect, useState, type CSSProperties } from 'react';
import { gitContextStyles } from '@/utils/theme-styles';
import { CaretDown, FolderOpen, GitBranch } from '@phosphor-icons/react';
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
  const { settings } = useStore();
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loading, setLoading] = useState(false);

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
  }, [settings?.workspace, refreshTick]);

  // Polling every 15 s.
  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [settings?.workspace]);

  if (!gitInfo && loading) {
    return null;
  }

  const repoName = settings?.workspace?.split('/').pop() || 'workspace';
  const hasChanges = gitInfo && (gitInfo.added > 0 || gitInfo.modified > 0 || gitInfo.deleted > 0);

  return (
    <div style={gitContextStyles.root}>
      <button
        className="repo-btn"
        style={gitContextStyles.repoBtn}
        onClick={onPickWorkspace}
        title="Switch workspace"
      >
        <FolderOpen size={14} />
        <span style={gitContextStyles.repoName}>{repoName}</span>
        <CaretDown size={12} />
      </button>

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

