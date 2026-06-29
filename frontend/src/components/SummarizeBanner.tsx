import React, { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { summarizeStyles } from '@/utils/theme-styles';
import { Stop } from '@phosphor-icons/react';
import { theme } from '@/theme';

interface SummarizeBannerProps {
  done: number;
  total: number;
  failed?: number;
  finished: boolean;
  hiding?: boolean;
  startedAt?: number | null;
  onCancel?: () => void;
}

// Elapsed time like the chat's activity line: "8s" then "1m 4s".
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

// GitHub-contribution-style heatmap that reads as a soft shade/cloud rather
// than a hard rectangle. A COLS×ROWS mesh fills left→right with progress, but:
//   • unlit cells are transparent (no background box — so there's no rigid rect)
//   • the leading edge is feathered + scattered, so green spills/dissolves ahead
//   • outer rows fade in density, so the top/bottom bleed out into a halo
// Filled cells run a green "heat" cycle with a per-cell delay, so waves of
// brighter green drift across as it fills. Fixed cell count → scales the same
// for 10 or 500 nodes. Non-blocking: sits above the composer while the bulk
// `/summarize` worker runs.
const COLS = 120;
const ROWS = 8;
const FEATHER = 9; // columns over which the leading edge dissolves
const CENTER = (ROWS - 1) / 2;

// Stable per-cell noise so the cloud looks organic, not a clean diagonal sweep.
const noise = (i: number): number => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
// Density falloff toward the top/bottom rows → soft vertical edges.
const rowWeight = (r: number): number => Math.max(0, 1 - Math.pow(Math.abs(r - CENTER) / (CENTER + 0.6), 1.5));

export default function SummarizeBanner({ done, total, failed = 0, finished, hiding, startedAt, onCancel }: SummarizeBannerProps) {
  const p = total > 0 ? done / total : 0;
  const frontier = p * COLS; // fractional column the fill has reached

  // Tick once a second so the elapsed time updates while running; freeze on done.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [finished]);
  const elapsed = startedAt ? fmtElapsed(Date.now() - startedAt) : null;

  // Optimistic feedback: clicking Stop shows "Stopping…" right away, even before
  // the backend's done event lands. Reset when the run finishes so the label
  // reverts to the "Summarized …" state immediately on `summarize_done`.
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (finished) setStopping(false); }, [finished]);
  const stop = () => { setStopping(true); onCancel?.(); };

  const cells: ReactNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      // Horizontal fill: ~1 behind the frontier, feathering to 0 ahead of it.
      const horiz = finished ? 1 : Math.max(0, Math.min(1, 0.5 - (c - frontier) / FEATHER));
      // Density at this cell = how far inside the cloud it is (frontier × rows).
      const base = horiz * rowWeight(r);
      // Solid body where base is high (no holes); dither ONLY the soft border so
      // edges dissolve organically; transparent well outside. Scatter is bound
      // to the cloud edge — it no longer sprinkles green across the whole width.
      let lit;
      if (base >= 0.55) lit = true;
      else if (base <= 0.05) lit = false;
      else lit = noise(i) < (base - 0.05) / 0.5;
      cells.push(
        <span
          key={i}
          className={lit ? 'sm-cell sm-cell--live' : 'sm-cell'}
          style={
            lit
              ? { opacity: Math.min(1, 0.45 + 0.55 * base), animationDelay: `${c * 0.02 + r * 0.04 + noise(i) * 0.5}s` }
              : { opacity: 0 }
          }
        />,
      );
    }
  }

  return (
    <div style={{ ...summarizeStyles.wrap, opacity: hiding ? 0 : 1, transition: 'opacity 0.35s ease' }}>
      <div style={summarizeStyles.head}>
        <span style={summarizeStyles.label}>
          {stopping ? 'Stopping…' : 'Summarizing nodes'}
          {failed > 0 && <span style={summarizeStyles.failed}> · {failed} failed</span>}
        </span>
        {!finished && (
          <button
            className="sm-stop"
            style={{ ...summarizeStyles.cancel, opacity: stopping ? 0.5 : 1 }}
            onClick={stop}
            disabled={stopping}
            title="Stop summarizing"
          >
            <Stop size={11} weight="fill" />
            {stopping ? 'Stopping' : 'Stop'}
          </button>
        )}
      </div>
      <div style={summarizeStyles.grid}>{cells}</div>
    </div>
  );
}

