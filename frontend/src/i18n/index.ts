// Lightweight i18n system — provides a hook and a raw `t()` lookup.
// Locale is stored in localStorage under 'micelio_prefs' (field: 'locale').

import { useStore } from '@/store';
import en from './en';
import ptBR from './pt-BR';
import type { Translations } from './en';

export type Locale = 'en' | 'pt-BR';

const LOCALES: Record<Locale, Translations> = {
  en,
  'pt-BR': ptBR,
};

export const LOCALE_OPTIONS: { id: Locale; label: string; nativeLabel: string }[] = [
  { id: 'en', label: 'English', nativeLabel: 'English' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)' },
];

/** Apply the given locale to <html lang> and update the store. */
export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
}

/** Look up a dot-path key in the current locale. Falls back to English. */
export function t(
  path: string,
  locale?: Locale,
): string {
  const l = locale ?? (useStore.getState() as { locale?: Locale }).locale ?? 'en';
  const dict = LOCALES[l] ?? en;
  const keys = path.split('.');
  let result: unknown = dict;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in (result as Record<string, unknown>)) {
      result = (result as Record<string, unknown>)[key];
    } else {
      // Fallback to English
      let fallback: unknown = en;
      for (const fk of keys) {
        if (fallback && typeof fallback === 'object' && fk in (fallback as Record<string, unknown>)) {
          fallback = (fallback as Record<string, unknown>)[fk];
        } else {
          return path;
        }
      }
      return typeof fallback === 'string' ? fallback : path;
    }
  }
  return typeof result === 'string' ? result : path;
}

/** React hook — returns a `t()` function scoped to the current locale. */
export function useI18n(): { t: (path: string) => string; locale: Locale } {
  const locale = useStore((s) => (s as { locale?: Locale }).locale ?? 'en');
  return {
    t: (path: string) => t(path, locale),
    locale,
  };
}
