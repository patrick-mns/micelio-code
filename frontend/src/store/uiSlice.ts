// UI state — tab, modals, sidebar.
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';

export type TabId = 'chat' | 'treemap' | 'usage';

export interface UiSlice {
  activeTab: TabId;
  showSettings: boolean;
  transcriptOpen: boolean;
  sidebarOpen: boolean;
  setActiveTab: (activeTab: TabId) => void;
  setShowSettings: (showSettings: boolean) => void;
  setTranscriptOpen: (transcriptOpen: boolean) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
}

const prefs = loadPrefs();

export const uiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  activeTab: 'chat',
  showSettings: false,
  transcriptOpen: false,
  sidebarOpen: prefs.sidebarOpen ?? true,

  setActiveTab: (activeTab) => set({ activeTab }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setTranscriptOpen: (transcriptOpen) => set({ transcriptOpen }),

  setSidebarOpen: (sidebarOpen) => {
    savePrefs({ ...loadPrefs(), sidebarOpen });
    set({ sidebarOpen });
  },
});
