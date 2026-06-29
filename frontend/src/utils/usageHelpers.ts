// ── Formatting helpers ────────────────────────────────────────────────────────
/**
 * Format USD with high precision for small amounts.
 * For costs display: 0.0001 → "$0.00010", 1.5 → "$1.50"
 */
export const fmtUsd = (v: number): string => {
  if (v === 0) return '$0.00';
  if (v < 0.0001) return `$${v.toExponential(1)}`;
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
};

export { fmtTok, fmtDuration, fmtElapsed, fmtUptime, fmtCount, fmtTokens } from '@/utils/formatters';

export const shortModel = (m: string): string => m.includes('/') ? m.split('/').pop()! : m;
export const fmtTs = (sec: number): string => {
  const d = new Date(sec * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};
export const fmtTsFull = (sec: number): string =>
  new Date(sec * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });


// ── Palettes & constants ──────────────────────────────────────────────────────
export const PROVIDER_COLORS: Record<string, string> = {
  openrouter: '#a78bfa',
  ollama:     '#3fb950',
  unknown:    '#8c8a82',
};

// Distinct palette for the donut slices / legend (cycles if there are more
// models than colors).
export const MODEL_PALETTE: string[] = ['#a78bfa', '#3fb950', '#58a6ff', '#f0883e', '#db61a2', '#e3b341', '#56d4dd', '#ff7b72'];

// Date-range presets. `days` null = all time. `from` is computed at query time.
export interface Range {
  id: string;
  label: string;
  days: number | null;
}

export const RANGES: Range[] = [
  { id: 'all', label: 'All time', days: null },
  { id: '24h', label: '24h', days: 1 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
];
