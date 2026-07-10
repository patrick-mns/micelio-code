// Theme: 'system' | 'dark' | 'light'. Applied to <html data-theme> on boot
// (main.tsx) and whenever changed here; 'system' also tracks OS changes.
import type { StateCreator } from 'zustand';
import { applyTheme, watchSystemTheme, type ThemePref } from '@/theme';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';

export interface ThemeSlice {
  themePref: ThemePref;
  _unwatchTheme: () => void;
  setThemePref: (themePref: ThemePref) => void;
}

const prefs = loadPrefs();

export const themeSlice: StateCreator<AppState, [], [], ThemeSlice> = (set, get) => ({
  themePref: prefs.theme || 'system',
  _unwatchTheme: watchSystemTheme(prefs.theme || 'system', () => {}),

  setThemePref: (themePref) => {
    savePrefs({ ...loadPrefs(), theme: themePref });
    applyTheme(themePref);
    get()._unwatchTheme?.();
    set({ themePref, _unwatchTheme: watchSystemTheme(themePref, () => {}) });
  },
});
