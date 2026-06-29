// Backend settings + model configuration.
import type { StateCreator } from 'zustand';
import type { ModelOption, Settings } from '@/types';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';

const prefs = loadPrefs();

export interface SettingsSlice {
  settings: Settings | null;
  models: ModelOption[];
  chatModel: string;
  summarizeModel: string;
  setSettings: (settings: Settings | null) => void;
  setModels: (models: ModelOption[]) => void;
  setChatModel: (chatModel: string) => void;
  setSummarizeModel: (summarizeModel: string) => void;
}

export const settingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set) => ({
  settings: null,
  models: [],
  chatModel: prefs.chatModel || 'claude-sonnet-4-6',
  summarizeModel: prefs.summarizeModel || 'claude-haiku-4-6',

  setSettings: (settings) => set({ settings }),
  setModels: (models) => set({ models }),

  setChatModel: (chatModel) => {
    const next = { ...loadPrefs(), chatModel };
    savePrefs(next);
    set({ chatModel });
  },

  setSummarizeModel: (summarizeModel) => {
    const next = { ...loadPrefs(), summarizeModel };
    savePrefs(next);
    set({ summarizeModel });
  },
});
