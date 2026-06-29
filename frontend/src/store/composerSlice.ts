// Per-session composer state: the unsent draft (text) and a staged image
// attachment. Text drafts are persisted to localStorage so a half-written
// message survives an app restart (like Slack/Claude per-conversation drafts).
// Attachments are kept in memory only — we don't want base64 image blobs in
// localStorage.
import type { StateCreator } from 'zustand';
import type { Attachment } from '@/utils/chatHelpers';
import type { AppState } from './index';

const DRAFTS_KEY = 'micelio_drafts';

function loadDrafts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveDrafts(drafts: Record<string, string>): void {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {}
}

export interface ComposerSlice {
  draftsBySession: Record<string, string>;
  attachmentsBySession: Record<string, Attachment | null>;
  setDraft: (sessionId: string, text: string) => void;
  setDraftAttachment: (sessionId: string, attachment: Attachment | null) => void;
  clearDraft: (sessionId: string) => void;
}

export const composerSlice: StateCreator<AppState, [], [], ComposerSlice> = (set) => ({
  draftsBySession: loadDrafts(),
  attachmentsBySession: {},

  setDraft: (sessionId, text) =>
    set((s) => {
      const next = { ...s.draftsBySession };
      // Drop empty drafts so the persisted blob doesn't grow with blank entries.
      if (text) next[sessionId] = text;
      else delete next[sessionId];
      saveDrafts(next);
      return { draftsBySession: next };
    }),

  setDraftAttachment: (sessionId, attachment) =>
    set((s) => {
      const next = { ...s.attachmentsBySession };
      if (attachment) next[sessionId] = attachment;
      else delete next[sessionId];
      return { attachmentsBySession: next };
    }),

  clearDraft: (sessionId) =>
    set((s) => {
      const drafts = { ...s.draftsBySession };
      delete drafts[sessionId];
      const atts = { ...s.attachmentsBySession };
      delete atts[sessionId];
      saveDrafts(drafts);
      return { draftsBySession: drafts, attachmentsBySession: atts };
    }),
});
