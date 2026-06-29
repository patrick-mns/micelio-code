import React, { useEffect, useState, type ReactNode } from 'react';
import { X, ArrowSquareOut, CaretRight, Copy, Check } from '@phosphor-icons/react';
import { theme } from '@/theme';
import { usePanelResize } from '@/hooks/usePanelResize';
import ProviderBadge from '@/components/ProviderBadge';
import { shortModel, fmtTsFull } from '@/utils/usageHelpers';
import { usageStyles as styles } from '@/utils/theme-styles';
import { ipc } from '@/ipc';
import type { UsageLogEntry, UsageRaw } from '@/types';
import JsonBlock from './JsonBlock';

interface LedgerDetailProps {
  entry: UsageLogEntry;
  onClose: () => void;
  onOpenSession: () => void;
}

// Internal right-side drawer with the full detail of one ledger turn.
export default function LedgerDetail({ entry, onClose, onOpenSession }: LedgerDetailProps) {
  const { width, handleProps } = usePanelResize({
    storageKey: 'turnDetailWidth', defaultWidth: 500, min: 300, side: 'right',
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Heavy request/response payloads are excluded from the ledger list query for
  // speed — fetch them on demand when this detail panel opens.
  const [raw, setRaw] = useState<UsageRaw | null>(null);
  useEffect(() => {
    setRaw(null);
    ipc.getUsageRaw(entry.id).then(setRaw).catch(() => setRaw(null));
  }, [entry.id]);

  const total = entry.prompt_tokens + entry.completion_tokens;
  const secs = entry.duration_ms / 1000;
  const tps = secs > 0 && entry.completion_tokens > 0 ? entry.completion_tokens / secs : null;
  const fmtDur = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div className="ledger-drawer" style={{ ...styles.drawer, width }}>
        <div {...handleProps} title="Drag to resize" />
      <div style={styles.drawerHead}>
        <span style={styles.drawerTitle}>Turn detail</span>
        <button className="close-btn" style={styles.drawerClose} onClick={onClose} title="Close (Esc)"><X size={15} /></button>
      </div>
      <div style={styles.drawerBody}>
        <DetailRow label="When" value={fmtTsFull(entry.ts)} />
        <DetailRow label="Model" value={<span style={{ display: 'flex', alignItems: 'center' }}>{shortModel(entry.model)}<ProviderBadge provider={entry.provider} /></span>} />

        <div style={styles.drawerDivider} />
        <DetailRow label="Latency" value={entry.duration_ms > 0 ? fmtDur(entry.duration_ms) : '—'} mono />
        {tps && <DetailRow label="Throughput" value={`${tps.toFixed(1)} tok/s`} mono />}

        <div style={styles.drawerDivider} />
        <DetailRow label="Prompt tokens" value={entry.prompt_tokens.toLocaleString()} mono />
        <DetailRow label="Completion tokens" value={entry.completion_tokens.toLocaleString()} mono />
        <DetailRow label="Total tokens" value={total.toLocaleString()} mono />
        {entry.prompt_cost != null && <DetailRow label="Input cost" value={`$${entry.prompt_cost.toFixed(6)}`} mono />}
        {entry.completion_cost != null && <DetailRow label="Output cost" value={`$${entry.completion_cost.toFixed(6)}`} mono />}
        <DetailRow label="Cost" value={entry.cost > 0 ? `$${entry.cost.toFixed(6)}` : 'Free'} mono accent={entry.cost > 0} />

        <div style={styles.drawerDivider} />
        <DetailRow label="Session" value={entry.session_title || '(untitled)'} />
        <button className="btn btn-lg btn-solid" style={{ width: '100%', marginTop: 12 }} onClick={onOpenSession} disabled={!entry.session_id}>
          <ArrowSquareOut size={15} />
          Open session
        </button>

        {raw && (raw.request_raw || raw.response_raw) && (
          <RawNetwork request={raw.request_raw} response={raw.response_raw} />
        )}
      </div>
      </div>
    </>
  );
}

// Single collapsible block with a Request/Response toggle, showing the raw
// network payloads with JSON syntax coloring. Collapsed by default.
interface RawNetworkProps {
  request: string;
  response: string;
}

function RawNetwork({ request, response }: RawNetworkProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('request');
  const [copied, setCopied] = useState(false);
  const text = tab === 'request' ? (request || '') : (response || '');
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const lines = text ? text.split('\n').length : 0;
  return (
    <div style={styles.rawBlock}>
      <div
        className="raw-header"
        style={{ ...styles.rawHeader, borderRadius: open ? '8px 8px 0 0' : 8 }}
      >
        <div style={styles.rawHeadLeft} onClick={() => setOpen((o) => !o)}>
          <CaretRight size={12} weight="bold" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
          <span style={styles.rawLabel}>Raw network</span>
        </div>
        {open ? (
          <div style={styles.rawHeadRight}>
            <div className="seg-track">
              <button
                className={tab === 'request' ? 'seg-btn is-active' : 'seg-btn'}
                onClick={() => setTab('request')}
                disabled={!request}
              >
                Request
              </button>
              <button
                className={tab === 'response' ? 'seg-btn is-active' : 'seg-btn'}
                onClick={() => setTab('response')}
                disabled={!response}
              >
                Response
              </button>
            </div>
            <button className="raw-copy" style={styles.rawCopy} onClick={copy} title="Copy">
              {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
            </button>
          </div>
        ) : (
          <CaretRight size={12} style={{ opacity: 0 }} />
        )}
      </div>
      {open && (
        <>
          <div style={styles.rawPreHead}>
            <span>{tab === 'request' ? 'POST → provider' : 'stream ← provider'}</span>
            <span style={styles.rawMeta}>{lines} lines</span>
          </div>
          <div style={styles.rawPre}>
            <JsonBlock content={text} className="raw-pre" />
          </div>
        </>
      )}
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
  accent?: boolean;
}

function DetailRow({ label, value, mono, accent }: DetailRowProps) {
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={{ ...styles.detailValue, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', color: accent ? theme.accent : theme.text }}>{value}</span>
    </div>
  );
}
