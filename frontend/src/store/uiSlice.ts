// UI state — tab, modals, sidebar.
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';
import { ipc } from '@/ipc';

export type TabId = 'chat' | 'treemap';
export type SettingsCategoryId = 'appearance' | 'chat' | 'providers' | 'mcp' | 'workspace' | 'usage' | 'advanced';
// How the agent handles a turn (mirrors backend `AgentMode`):
//   chat   — conversation only, no tools
//   auto   — runs tools immediately, no approval
//   review — pauses file writes/edits for approval
export type AgentMode = 'chat' | 'auto' | 'review';

const isAgentMode = (v: unknown): v is AgentMode =>
  v === 'chat' || v === 'auto' || v === 'review';

export interface UiSlice {
  activeTab: TabId;
  showSettings: boolean;
  settingsCategory: SettingsCategoryId;
  transcriptOpen: boolean;
  sidebarOpen: boolean;
  activeRoot: string | null;
  agentMode: AgentMode;
  setActiveTab: (activeTab: TabId) => void;
  setShowSettings: (showSettings: boolean) => void;
  setSettingsCategory: (settingsCategory: SettingsCategoryId) => void;
  setTranscriptOpen: (transcriptOpen: boolean) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
  setActiveRoot: (root: string | null) => void;
  setAgentMode: (mode: AgentMode) => void;
  // Push the persisted mode to the backend (which resets to its default on
  // restart). Call once on app start.
  syncAgentMode: () => void;
}

const prefs = loadPrefs();

export const uiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  activeTab: 'chat',
  showSettings: false,
  settingsCategory: 'chat',
  transcriptOpen: false,
  sidebarOpen: prefs.sidebarOpen ?? true,
  activeRoot: null,
  agentMode: isAgentMode(prefs.agentMode) ? prefs.agentMode : 'review',

  setActiveTab: (activeTab) => set({ activeTab }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
  setTranscriptOpen: (transcriptOpen) => set({ transcriptOpen }),
  setActiveRoot: (activeRoot) => set({ activeRoot }),

  setSidebarOpen: (sidebarOpen) => {
    savePrefs({ ...loadPrefs(), sidebarOpen });
    set({ sidebarOpen });
  },

  setAgentMode: (agentMode) => {
    savePrefs({ ...loadPrefs(), agentMode });
    set({ agentMode });
    ipc.setAgentMode(agentMode).catch(console.error);
  },

  syncAgentMode: () => {
    ipc.setAgentMode(get().agentMode).catch(console.error);
  },
});
