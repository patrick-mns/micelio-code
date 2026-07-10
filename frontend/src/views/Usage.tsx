import React, { useEffect, useState } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import { Trash } from '@phosphor-icons/react';
import ProviderBadge from '@/components/ProviderBadge';
import { DonutChart, BarChart } from '@/components/UsageCharts';
import LedgerDetail from '@/components/LedgerDetail';
import { fmtUsd, fmtTok, shortModel, fmtTs, RANGES } from '@/utils/usageHelpers';
import { usageStyles as styles } from '@/utils/theme-styles';
import type { UsageLogEntry, UsageStats } from '@/types';
import ConfirmModal from '@/components/ConfirmModal';

// A ledger entry plus the global index of the row it was selected from.
type SelectedEntry = UsageLogEntry & { _i: number };

export default function Usage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [log, setLog] = useState<UsageLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState('all');
  const [modelFilter, setModelFilter] = useState<string | null>(null); // null = all models
  const [clearing, setClearing] = useState(false);
  const [selected, setSelected] = useState<SelectedEntry | null>(null); // ledger entry shown in the side panel
  const [page, setPage] = useState(0); // ledger pagination (0-indexed)
  const [confirmClear, setConfirmClear] = useState(false);
  const { setActiveTab, setCurrentSession, setMessages } = useStore();
  const PAGE_SIZE = 5;

  const openSession = async (id: string) => {
    if (!id) return;
    setCurrentSession(id);
    const msgs = await ipc.switchSession(id).catch(() => null);
    if (msgs) setMessages(id, msgs);
    setActiveTab('chat');
  };

  const load = (rangeId: string) => {
    const r = RANGES.find((x) => x.id === rangeId) ?? RANGES[0];
    const from = r.days == null ? null : Math.floor(Date.now() / 1000) - r.days * 86400;
    ipc.getUsageStats(from, null).then(setStats).catch((e) => setError(String(e)));
    ipc.getUsageLog(from, null).then(setLog).catch((e) => setError(String(e)));
  };

  useEffect(() => { load(range); }, [range]);
  useEffect(() => { setPage(0); }, [range, modelFilter]);

  const handleClearConfirm = async () => {
    setConfirmClear(false);
    setClearing(true);
    try {
      await ipc.clearUsage();
      setModelFilter(null);
      load(range);
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  };

  if (error) return <div style={styles.empty}>{error}</div>;
  if (!stats) return <div style={styles.empty}>Loading…</div>;

  // Apply the per-model filter client-side (the query already returns by_model).
  const byModel = modelFilter ? stats.by_model.filter((m) => m.model === modelFilter) : stats.by_model;
  const ledger = modelFilter ? log.filter((e) => e.model === modelFilter) : log;
  const pageCount = Math.max(1, Math.ceil(ledger.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedLedger = ledger.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const totals = byModel.reduce((acc, m) => ({
    cost: acc.cost + m.cost,
    prompt: acc.prompt + m.prompt_tokens,
    completion: acc.completion + m.completion_tokens,
    turns: acc.turns + m.turns,
  }), { cost: 0, prompt: 0, completion: 0, turns: 0 });

  const empty = stats.total_turns === 0;

  return (
    <div style={styles.root}>
      <div style={styles.inner}>
        <div style={styles.headRow}>
          <h2 style={styles.heading}>Usage</h2>
          <div style={styles.controls}>
            <div className="seg-track">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  className={range === r.id ? 'seg-btn is-active' : 'seg-btn'}
                  onClick={() => setRange(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button className="btn btn-md btn-outline" onClick={() => setConfirmClear(true)} disabled={clearing || empty}>
              <Trash size={14} weight="bold" />
              {clearing ? 'Clearing…' : 'Clear'}
            </button>
          </div>
        </div>

        {empty ? (
          <div style={styles.empty}>No usage data yet. Start chatting!</div>
        ) : (
          <>
            {/* Model filter pills */}
            {stats.by_model.length > 1 && (
              <div style={styles.modelPills}>
                <button
                  className={modelFilter == null ? 'chip is-active' : 'chip'}
                  onClick={() => setModelFilter(null)}
                >
                  All models
                </button>
                {stats.by_model.map((m) => (
                  <button
                    key={m.model}
                    className={modelFilter === m.model ? 'chip is-active' : 'chip'}
                    onClick={() => setModelFilter(modelFilter === m.model ? null : m.model)}
                    title={m.model}
                  >
                    {shortModel(m.model)}
                  </button>
                ))}
              </div>
            )}

            {/* Summary cards */}
            <div style={styles.cards}>
              <Card label="Total cost" value={fmtUsd(totals.cost)} />
              <Card label="Total tokens" value={fmtTok(totals.prompt + totals.completion)} />
              <Card label="Prompt tokens" value={fmtTok(totals.prompt)} />
              <Card label="Completion tokens" value={fmtTok(totals.completion)} />
              <Card label="Turns" value={String(totals.turns)} />
            </div>

            {/* By model */}
            {byModel.length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionTitle}>By model</div>
                <div style={styles.charts}>
                  <BarChart data={byModel} valueKey="cost" label="Cost (USD)" fmt={fmtUsd} />
                  <BarChart data={byModel} valueKey="prompt_tokens" label="Prompt tokens" fmt={fmtTok} />
                  <BarChart data={byModel} valueKey="completion_tokens" label="Completion tokens" fmt={fmtTok} />
                </div>

                {/* Table */}
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Model', 'Turns', 'Prompt', 'Completion', 'Cost'].map((h) => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {byModel.map((m) => (
                      <tr key={m.model} style={styles.tr}>
                        <td style={{ ...styles.td, color: theme.text }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }} title={m.model}>{m.model}</span>
                            <ProviderBadge provider={m.provider} />
                          </span>
                        </td>
                        <td style={styles.tdNum}>{m.turns}</td>
                        <td style={styles.tdNum}>{fmtTok(m.prompt_tokens)}</td>
                        <td style={styles.tdNum}>{fmtTok(m.completion_tokens)}</td>
                        <td style={{ ...styles.tdNum, color: theme.accent }}>{fmtUsd(m.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {!modelFilter && <DonutChart data={byModel} />}
              </div>
            )}

            {/* Ledger: per-turn rows, most recent first. */}
            {ledger.length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Ledger ({ledger.length})</div>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['When', 'Model', 'Prompt', 'Completion', 'Cost'].map((h, i) => (
                        <th key={h} style={i === 0 ? styles.th : styles.thNum}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedLedger.map((e, i) => {
                      const gi = safePage * PAGE_SIZE + i; // global index, stable selection key
                      const isSel = selected && selected._i === gi;
                      return (
                        <tr
                          key={`${e.ts}-${gi}`}
                          className={isSel ? 'ledger-row is-active' : 'ledger-row'}
                          style={styles.tr}
                          onClick={() => setSelected({ ...e, _i: gi })}
                        >
                          <td style={{ ...styles.td, color: theme.dim, whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</td>
                          <td style={{ ...styles.td, color: theme.textSoft }}>
                            <span style={{ display: 'flex', alignItems: 'center' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={e.model}>{shortModel(e.model)}</span>
                              <ProviderBadge provider={e.provider} />
                            </span>
                          </td>
                          <td style={styles.tdNum}>{fmtTok(e.prompt_tokens)}</td>
                          <td style={styles.tdNum}>{fmtTok(e.completion_tokens)}</td>
                          <td style={{ ...styles.tdNum, color: e.cost > 0 ? theme.accent : theme.dim }}>{fmtUsd(e.cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {pageCount > 1 && (
                  <div style={styles.pager}>
                    <button
                      className="btn btn-md btn-solid"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                    >
                      ‹ Prev
                    </button>
                    <span style={styles.pagerInfo}>
                      {safePage * PAGE_SIZE + 1}–{Math.min(ledger.length, (safePage + 1) * PAGE_SIZE)} of {ledger.length}
                    </span>
                    <button
                      className="btn btn-md btn-solid"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage >= pageCount - 1}
                    >
                      Next ›
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <LedgerDetail
          entry={selected}
          onClose={() => setSelected(null)}
          onOpenSession={() => { openSession(selected.session_id); setSelected(null); }}
        />
      )}

      <ConfirmModal
        open={confirmClear}
        title="Clear usage history"
        message="This will reset all Usage totals. Chat transcripts and per-message costs are kept — only the aggregated numbers reset."
        confirmLabel="Clear"
        danger
        onConfirm={handleClearConfirm}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

interface CardProps {
  label: string;
  value: string;
}

function Card({ label, value }: CardProps) {
  return (
    <div style={styles.card}>
      <div style={styles.cardValue}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
    </div>
  );
}
