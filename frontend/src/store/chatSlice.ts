// Session messages + loading state.
import type { StateCreator } from 'zustand';
import { hydrateAttachments, type ChatMessageView } from '@/utils/chatHelpers';
import type { AppState } from './index';

export interface ChatSlice {
  messagesBySession: Record<string, ChatMessageView[]>;
  isLoading: boolean;
  addMessage: (sessionId: string, msg: ChatMessageView) => void;
  setMessages: (sessionId: string, messages: ChatMessageView[]) => void;
  setLoading: (isLoading: boolean) => void;
}

export const chatSlice: StateCreator<AppState, [], [], ChatSlice> = (set) => ({
  // Messages keyed by session id.
  messagesBySession: {},
  isLoading: false,

  addMessage: (sessionId, msg) =>
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] ?? []), msg],
      },
    })),

  setMessages: (sessionId, messages) =>
    set((s) => ({
      // Rebuild image-attachment tags from any persisted prompt note (no-op for
      // client-side messages that already carry an attachment / clean content).
      messagesBySession: { ...s.messagesBySession, [sessionId]: hydrateAttachments(messages) },
    })),

  setLoading: (isLoading) => set({ isLoading }),
});
