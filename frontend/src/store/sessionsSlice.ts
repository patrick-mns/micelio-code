// Session management — list, current, streaming.
import type { StateCreator } from 'zustand';
import type { AgentStatus, SessionInfo, SessionModels } from '@/types';
import type { AgentMode } from './uiSlice';
import type { AppState } from './index';
import { ipc } from '@/ipc';

export interface SessionsSlice {
  sessions: SessionInfo[];
  currentSession: string | null;
  streamingSession: string | null;
  /** Per-session agent status (idle | running | awaiting_input | error | complete) */
  agentStatus: Record<string, AgentStatus>;
  /** Per-session model pins: sessionId → { chat, summarize, vision } */
  sessionModels: Record<string, SessionModels>;
  /** Per-session effective agent mode: sessionId → chat | auto | review */
  sessionModes: Record<string, AgentMode>;
  setSessions: (sessions: SessionInfo[] | ((prev: SessionInfo[]) => SessionInfo[])) => void;
  setCurrentSession: (currentSession: string | null) => void;
  setStreamingSession: (streamingSession: string | null) => void;
  setAgentStatus: (sessionId: string, status: AgentStatus) => void;
  /** Update the model pins for one session. */
  setSessionModels: (sessionId: string, models: SessionModels) => void;
  /** Cache the effective mode for one session (does not hit the backend). */
  setSessionModeLocal: (sessionId: string, mode: AgentMode) => void;
  loadSessions: () => Promise<void>;
}

export const sessionsSlice: StateCreator<AppState, [], [], SessionsSlice> = (set) => ({
  sessions: [],
  currentSession: null,
  // The session that owns the in-flight stream (single stream at a time). The
  // streaming overlay only renders when currentSession === streamingSession, so
  // a turn started in one session doesn't leak into another you switched to.
  streamingSession: null,
  agentStatus: {},
  sessionModels: {},
  sessionModes: {},

  setSessions: (sessions) =>
    set((s) => ({ sessions: typeof sessions === 'function' ? sessions(s.sessions) : sessions })),

  setCurrentSession: (currentSession) => set({ currentSession }),

  setStreamingSession: (streamingSession) => set({ streamingSession }),

  setAgentStatus: (sessionId, status) =>
    set((s) => ({
      agentStatus: { ...s.agentStatus, [sessionId]: status },
    })),

  setSessionModels: (sessionId, models) =>
    set((s) => ({
      sessionModels: { ...s.sessionModels, [sessionId]: models },
    })),

  setSessionModeLocal: (sessionId, mode) =>
    set((s) => ({
      sessionModes: { ...s.sessionModes, [sessionId]: mode },
    })),

  loadSessions: async () => {
    try {
      const sess = await ipc.listSessions();
      set({ sessions: sess });
    } catch (e) {
      console.error('Failed to load sessions', e);
    }
  },
});
