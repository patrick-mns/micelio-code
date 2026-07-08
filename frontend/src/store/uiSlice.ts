// UI state — tab, modals, sidebar.
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';

export type TabId = 'chat' | 'treemap' | 'usage';
export type SettingsCategoryId = 'chat' | 'providers' | 'workspace' | 'advanced';

export interface UiSlice {
  activeTab: TabId;
  showSettings: boolean;
  settingsCategory: SettingsCategoryId;
  transcriptOpen: boolean;
  sidebarOpen: boolean;
  setActiveTab: (activeTab: TabId) => void;
  setShowSettings: (showSettings: boolean) => void;
  setSettingsCategory: (settingsCategory: SettingsCategoryId) => void;
  setTranscriptOpen: (transcriptOpen: boolean) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
}

const prefs = loadPrefs();

export const uiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  activeTab: 'chat',
  showSettings: false,
  settingsCategory: 'chat',
  transcriptOpen: false,
  sidebarOpen: prefs.sidebarOpen ?? true,

  setActiveTab: (activeTab) => set({ activeTab }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
  setTranscriptOpen: (transcriptOpen) => set({ transcriptOpen }),

  setSidebarOpen: (sidebarOpen) => {
    savePrefs({ ...loadPrefs(), sidebarOpen });
    set({ sidebarOpen });
  },
});
