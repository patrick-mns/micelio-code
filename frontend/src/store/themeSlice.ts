// Theme: 'system' | 'dark' | 'light'. Applied to <html data-theme> on boot
// (main.tsx) and whenever changed here; 'system' also tracks OS changes.
import type { StateCreator } from 'zustand';
import { applyTheme, applyAccent, applyVariant, watchSystemTheme, type ThemePref, type AccentColor, type ThemeVariant } from '@/theme';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';

export interface ThemeSlice {
  themePref: ThemePref;
  accentColor: AccentColor;
  themeVariant: ThemeVariant;
  _unwatchTheme: () => void;
  setThemePref: (themePref: ThemePref) => void;
  setAccentColor: (accent: AccentColor) => void;
  setThemeVariant: (variant: ThemeVariant) => void;
}

const prefs = loadPrefs();

export const themeSlice: StateCreator<AppState, [], [], ThemeSlice> = (set, get) => ({
  themePref: prefs.theme || 'system',
  accentColor: (prefs.accentColor as AccentColor) || 'default',
  themeVariant: (prefs.themeVariant as ThemeVariant) || 'default',
  _unwatchTheme: watchSystemTheme(prefs.theme || 'system', () => {}),

  setThemePref: (themePref) => {
    savePrefs({ ...loadPrefs(), theme: themePref });
    applyTheme(themePref);
    get()._unwatchTheme?.();
    set({ themePref, _unwatchTheme: watchSystemTheme(themePref, () => {}) });
  },

  setAccentColor: (accentColor) => {
    savePrefs({ ...loadPrefs(), accentColor });
    applyAccent(accentColor);
    set({ accentColor });
  },

  setThemeVariant: (themeVariant) => {
    savePrefs({ ...loadPrefs(), themeVariant });
    applyVariant(themeVariant);
    set({ themeVariant });
  },
});
