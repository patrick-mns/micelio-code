// Shared helpers — load/save prefs from localStorage.
// Used by prefsSlice, settingsSlice, themeSlice.
import type { ThemePref } from '@/theme';
import type { Locale } from '@/i18n';

/** One remembered Terminal dock tab. The shell it held is long gone by the
 * time this is read — what's kept is where it was and what it was called, so
 * reopening the app puts the same terminals back in the same folders. */
export interface StoredTerminal {
  /** The chat session the tab belongs to. Tab ids repeat across sessions, so
   * this is the half of the key that makes a row identifiable. */
  sessionId: string;
  id: string;
  dock: 'bottom' | 'right';
  label: string;
  cwd: string | null;
}

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
  terminals?: StoredTerminal[];
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
