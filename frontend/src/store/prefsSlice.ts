// Display preferences (frontend-only, persisted to localStorage).
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';

export interface Prefs {
  streamEnabled: boolean;
  showThinking: boolean;
  showTools: boolean;
  autoCompact: boolean;
  debug: boolean;
}

export interface PrefsSlice {
  prefs: Prefs;
  setPref: (key: keyof Prefs, value: boolean) => void;
}

const prefs = loadPrefs();

export const prefsSlice: StateCreator<AppState, [], [], PrefsSlice> = (set) => ({
  prefs: {
    streamEnabled: prefs.streamEnabled ?? true,
    showThinking: prefs.showThinking ?? true,
    showTools: prefs.showTools ?? true,
    autoCompact: prefs.autoCompact ?? true,
    debug: prefs.debug ?? false,
  },

  setPref: (key, value) =>
    set((s) => {
      const next = { ...s.prefs, [key]: value };
      savePrefs({ ...loadPrefs(), [key]: value });
      return { prefs: next };
    }),
});
