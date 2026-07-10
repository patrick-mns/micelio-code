// Shared helpers — load/save prefs from localStorage.
// Used by prefsSlice, settingsSlice, themeSlice.
import type { ThemePref } from '@/theme';
import type { Locale } from '@/i18n';

// The persisted blob in localStorage. All fields optional — older installs may
// not have every key yet.
export interface StoredPrefs {
  chatModel?: string;
  summarizeModel?: string;
  theme?: ThemePref;
  locale?: Locale;
  accentColor?: string;
  themeVariant?: string;
  sidebarOpen?: boolean;
  streamEnabled?: boolean;
  showThinking?: boolean;
  showTools?: boolean;
  autoCompact?: boolean;
  debug?: boolean;
  agentMode?: string;
}

export const loadPrefs = (): StoredPrefs => {
  try {
    return JSON.parse(localStorage.getItem('micelio_prefs') || '{}');
  } catch {
    return {};
  }
};

export const savePrefs = (prefs: StoredPrefs): void => {
  try {
    localStorage.setItem('micelio_prefs', JSON.stringify(prefs));
  } catch {}
};
