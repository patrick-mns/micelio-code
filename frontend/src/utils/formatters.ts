// Unified formatting helpers for tokens, currency, and duration.

/**
 * Format token count: 1000+ → "1.0k", 1000000+ → "1.0M"
 */
export const fmtTok = (n: number, options?: { includeM?: boolean }): string => {
  const includeM = options?.includeM !== false;
  if (includeM && n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
};

/**
 * Format USD currency: 0.0001 → "$0.00010", 1.5 → "$1.5000"
 */
export const fmtUsd = (n: number): string => `$${n < 0.01 ? n.toFixed(5) : n.toFixed(4)}`;

/**
 * Format duration in seconds to human-readable string.
 * Examples: 5 → "5s", 65 → "1m 5s", 3661 → "1h 1m", 86400 → "1d"
 */
export const fmtDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.round((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
};

/**
 * Format elapsed time for relative timestamps (like "8s ago", "2m 30s ago").
 * Similar to fmtDuration but adds "ago" suffix and simplified format.
 * Examples: 5 → "5s ago", 125 → "2m ago", 7325 → "2h ago"
 */
export const fmtElapsed = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

/**
 * Format uptime counter for processes: 5 → "5s", 125 → "2m 5s"
 * Used in background tasks panel.
 */
export const fmtUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
};

/**
 * Format count with abbreviation: 1500 → "1.5k", 1234567 → "1.2M"
 * Alias for fmtTok, used in different contexts.
 */
export const fmtCount = (n: number): string => fmtTok(n, { includeM: true });

/**
 * Format tokens with abbreviation (identical to fmtTok with M support).
 * Used in context window calculations.
 */
export const fmtTokens = (n: number): string => fmtTok(n, { includeM: true });
