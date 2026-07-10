// Locale preference — 'en' | 'pt-BR'. Applied to <html lang> on boot
// (main.tsx) and whenever changed here.
import type { StateCreator } from 'zustand';
import { applyLocale, type Locale } from '@/i18n';
import type { AppState } from './index';
import { loadPrefs, savePrefs } from './_persist';

export interface LocaleSlice {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const prefs = loadPrefs();

export const localeSlice: StateCreator<AppState, [], [], LocaleSlice> = (set) => ({
  locale: prefs.locale || 'en',

  setLocale: (locale) => {
    savePrefs({ ...loadPrefs(), locale });
    applyLocale(locale);
    set({ locale });
  },
});
