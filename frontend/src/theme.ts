// Central palette. Values are CSS custom properties (defined in index.css), so
// inline `style={{ color: theme.text }}` is theme-aware automatically — flip
// `data-theme` on <html> and everything re-themes with no re-render.
export const theme = {
  bgDeep:     'var(--color-bg-deep)',     // input wells, deep surfaces
  bg:         'var(--color-bg)',          // main window/panel
  card:       'var(--color-card)',        // cards, bubbles, buttons
  cardActive: 'var(--color-card-active)', // hover/active surface
  border:     'var(--color-border)',

  textStrong: 'var(--color-text-strong)', // emphasized text
  text:       'var(--color-text)',        // primary
  textSoft:   'var(--color-text-soft)',   // secondary
  dim:        'var(--color-dim)',          // metadata, hints
  faint:      'var(--color-faint)',        // disabled, decorations

  accent:      'var(--color-accent)',
  accentHover: 'var(--color-accent-hover)',
  success:     'var(--color-success)',
  error:       'var(--color-error)',
  warn:        'var(--color-warn)',

  codeBg:      'var(--color-code-bg)',     // code/JSON surface (stays dark)
};

// Data-viz colors for treemap tiles / node kinds. Kept as literal hex (not
// tokens) — they're drawn on <canvas>, which needs real color values, and they
// read as a fixed categorical scale across themes.
export const KIND_COLORS: Record<string, string> = {
  Directory: '#0e7490',
  File:      '#2563eb',
  Function:  '#16a34a',
  Class:     '#9333ea',
  Concept:   '#f59e0b',
  Note:      '#e11d48',
};

export type ThemePref = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_OPTIONS: ThemePref[] = ['system', 'dark', 'light'];

// Resolve a preference ('system' | 'dark' | 'light') to the concrete theme and
// apply it to <html data-theme>. Returns the resolved theme.
export function applyTheme(pref: ThemePref): ResolvedTheme {
  const prefersLight =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  const resolved = pref === 'system' ? (prefersLight ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

// Re-apply on OS theme changes while following the system preference. Returns
// an unsubscribe fn. No-op for explicit dark/light.
export function watchSystemTheme(pref: ThemePref, onChange: (resolved: ResolvedTheme) => void): () => void {
  if (pref !== 'system' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => onChange(applyTheme('system'));
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
