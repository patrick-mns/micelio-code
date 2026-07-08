import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ReviewFileInfo {
  path: string;
  original_content: string;
  proposed_content: string;
}

export interface WorkspaceChanges {
  git_files: ReviewFileInfo[];
}

export interface ReviewStatus {
  pending_count: number;
  changes: WorkspaceChanges;
}

// Unstaged workspace changes (git diff), shown as a revertable list. File
// edit/write approval itself is handled inline in the chat (see
// EditApprovalCard) — approved edits land on disk immediately and show up
// here as a normal git diff, so there's only one source of truth.
// Auto-refreshes on `review_changed` and `stream_done` events.
export function useReview() {
  const [status, setStatus] = useState<ReviewStatus>({ pending_count: 0, changes: { git_files: [] } });

  const refresh = useCallback(
    () => invoke<ReviewStatus>('get_review_status').then(setStatus).catch(console.error),
    [],
  );

  useEffect(() => {
    refresh();
    let un1: UnlistenFn | undefined;
    let un2: UnlistenFn | undefined;
    listen<unknown>('review_changed', () => refresh()).then((u) => { un1 = u; });
    listen<unknown>('stream_done', () => refresh()).then((u) => { un2 = u; });
    return () => { if (un1) un1(); if (un2) un2(); };
  }, [refresh]);

  const gitRevertFile = (path: string) =>
    invoke('git_revert_review_file', { path }).then(refresh).catch(console.error);
  const gitRevertAll = () =>
    invoke<string[]>('git_revert_all_review').then(refresh).catch(console.error);

  return {
    status,
    gitRevertFile, gitRevertAll,
    refresh,
  };
}
