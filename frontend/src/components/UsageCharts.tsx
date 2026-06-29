import React from 'react';
import { theme } from '@/theme';
import ProviderBadge from '@/components/ProviderBadge';
import { fmtTok, shortModel, MODEL_PALETTE } from '@/utils/usageHelpers';
import { usageStyles as styles } from '@/utils/theme-styles';
import type { ModelStat } from '@/types';

type NumericStatKey = 'cost' | 'prompt_tokens' | 'completion_tokens';

interface DonutChartProps {
  data: ModelStat[];
}

// Donut chart of each model's share of total tokens (prompt + completion).
// Tokens — not cost — because free providers (Ollama) would otherwise vanish.
export function DonutChart({ data }: DonutChartProps) {
  const sized = data.map((d, i) => ({
    ...d,
    total: d.prompt_tokens + d.completion_tokens,
    color: MODEL_PALETTE[i % MODEL_PALETTE.length],
  })).filter((d) => d.total > 0);

  const grand = sized.reduce((n, d) => n + d.total, 0);
  if (grand === 0) return null;

  const R = 56, STROKE = 22, C = 2 * Math.PI * R, CX = 70, CY = 70;
  let offset = 0;
  const arcs = sized.map((d) => {
    const frac = d.total / grand;
    const arc = { ...d, frac, dash: frac * C, gap: C - frac * C, off: offset };
    offset += frac * C;
    return arc;
  });

  return (
    <div style={styles.donutWrap}>
      <svg width={140} height={140} viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke={theme.cardActive} strokeWidth={STROKE} />
        {arcs.map((a) => (
          <circle
            key={a.model}
            cx={CX} cy={CY} r={R} fill="none"
            stroke={a.color} strokeWidth={STROKE}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={-a.off}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
        <text x={CX} y={CY - 4} textAnchor="middle" style={styles.donutCenterNum}>{fmtTok(grand)}</text>
        <text x={CX} y={CY + 12} textAnchor="middle" style={styles.donutCenterLbl}>tokens</text>
      </svg>
      <div style={styles.legend}>
        {arcs.map((a) => (
          <div key={a.model} style={styles.legendRow}>
            <span style={{ ...styles.legendDot, background: a.color }} />
            <span style={styles.legendName} title={a.model}>{shortModel(a.model)}</span>
            <span style={styles.legendPct}>{(a.frac * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BarChartProps {
  data: ModelStat[];
  valueKey: NumericStatKey;
  label: string;
  fmt: (value: number) => string;
}

export function BarChart({ data, valueKey, label, fmt }: BarChartProps) {
  const max = Math.max(...data.map((d) => d[valueKey]), 0.0001);
  return (
    <div style={styles.chart}>
      <div style={styles.chartLabel}>{label}</div>
      {data.map((d) => (
        <div key={d.model} style={styles.barRow}>
          <div style={styles.barName} title={d.model}>
            {shortModel(d.model)}
            <ProviderBadge provider={d.provider} />
          </div>
          <div style={styles.barTrack}>
            <div
              style={{
                ...styles.barFill,
                width: `${(d[valueKey] / max) * 100}%`,
              }}
            />
          </div>
          <div style={styles.barValue}>{fmt(d[valueKey])}</div>
        </div>
      ))}
    </div>
  );
}
