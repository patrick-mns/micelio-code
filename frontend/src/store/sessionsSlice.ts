// Session management — list, current, streaming.
import type { StateCreator } from 'zustand';
import type { SessionInfo, SessionModels } from '@/types';
import type { AppState } from './index';

export interface SessionsSlice {
  sessions: SessionInfo[];
  currentSession: string | null;
  streamingSession: string | null;
  /** Per-session model pins: sessionId → { chat, summarize, vision } */
  sessionModels: Record<string, SessionModels>;
  setSessions: (sessions: SessionInfo[] | ((prev: SessionInfo[]) => SessionInfo[])) => void;
  setCurrentSession: (currentSession: string | null) => void;
  setStreamingSession: (streamingSession: string | null) => void;
  /** Update the model pins for one session. */
  setSessionModels: (sessionId: string, models: SessionModels) => void;
}

export const sessionsSlice: StateCreator<AppState, [], [], SessionsSlice> = (set) => ({
  sessions: [],
  currentSession: null,
  // The session that owns the in-flight stream (single stream at a time). The
  // streaming overlay only renders when currentSession === streamingSession, so
  // a turn started in one session doesn't leak into another you switched to.
  streamingSession: null,
  sessionModels: {},

  setSessions: (sessions) =>
    set((s) => ({ sessions: typeof sessions === 'function' ? sessions(s.sessions) : sessions })),

  setCurrentSession: (currentSession) => set({ currentSession }),

  setStreamingSession: (streamingSession) => set({ streamingSession }),

  setSessionModels: (sessionId, models) =>
    set((s) => ({
      sessionModels: { ...s.sessionModels, [sessionId]: models },
    })),
});
