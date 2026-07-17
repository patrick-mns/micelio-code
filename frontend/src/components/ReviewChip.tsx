import React, { useMemo, useState } from 'react';
import { reviewPanelStyles } from '@/utils/theme-styles';
import { CheckCircle, X, GitFork, CaretDown } from '@phosphor-icons/react';
import { theme } from '@/theme';
import type { ReviewFileInfo } from '@/hooks/useReview';
import { computeDiff } from '@/utils/diff';

// ── Header chip ───────────────────────────────────────────────────────────

interface ReviewChipProps {
  pendingCount: number;
  active: boolean;
  onClick: () => void;
}

export default function ReviewChip({ pendingCount, active, onClick }: ReviewChipProps) {
  return (
    <button
      className="btn btn-ghost"
      style={{
        ...reviewPanelStyles.chip,
        color: active || pendingCount > 0 ? theme.text : theme.dim,
      }}
      title={
        pendingCount > 0
          ? `${pendingCount} file${pendingCount === 1 ? '' : 's'} changed`
          : 'Workspace changes'
      }
      onClick={onClick}
    >
      <CheckCircle size={16} weight={pendingCount > 0 ? 'fill' : 'regular'} />
      {pendingCount > 0 && (
        <span style={reviewPanelStyles.badge}>{pendingCount}</span>
      )}
    </button>
  );
}

// ── Hunk header ────────────────────────────────────────────────────────────

function HunkHeader({
  origStart, origLen, newStart, newLen
}: { origStart: number; origLen: number; newStart: number; newLen: number }) {
  return (
    <div style={reviewPanelStyles.hunkHeader}>
      @@ -{origStart},{origLen} +{newStart},{newLen} @@
    </div>
  );
}

// ── File card ─────────────────────────────────────────────────────────────

interface FileCardProps {
  file: ReviewFileInfo;
  onRevert: (path: string) => void;
}

function FileCard({ file, onRevert }: FileCardProps) {
  const diff = useMemo(() => computeDiff(file.original_content, file.proposed_content), [file]);
  const [expanded, setExpanded] = useState(false);

  const stats = useMemo(() => {
    let adds = 0, removes = 0;
    for (const l of diff) {
      if (l.kind === 'add') adds++;
      if (l.kind === 'remove') removes++;
    }
    return { adds, removes };
  }, [diff]);

  const filename = file.path.split('/').pop() ?? file.path;
  const isNew = file.original_content === '';

  // Build hunk groups
  const hunkStart = (() => {
    for (let i = 0; i < diff.length; i++) {
      if (diff[i].kind !== 'same') return Math.max(0, i - 2);
    }
    return 0;
  })();
  const hunkLen = Math.min(diff.length, 45);
  const visibleDiff = diff.slice(hunkStart, hunkLen);

  return (
    <div style={reviewPanelStyles.card}>
      {/* Header — clickable to toggle diff */}
      <div style={reviewPanelStyles.cardHead}>
        <div style={reviewPanelStyles.cardHeadLeft} onClick={() => setExpanded(!expanded)}>
          <GitFork size={12} style={{ marginRight: 4, flexShrink: 0, color: theme.dim }} />
          <span style={reviewPanelStyles.filename} title={file.path}>{filename}</span>
        </div>
        <div style={reviewPanelStyles.cardHeadRight}>
          {stats.adds > 0 && <span style={{ color: theme.success, fontWeight: 600, fontSize: 11.5 }}>+{stats.adds}</span>}
          {stats.removes > 0 && <span style={{ color: theme.error, fontWeight: 600, fontSize: 11.5 }}> -{stats.removes}</span>}
          <button className="btn btn-ghost" onClick={() => onRevert(file.path)}
            style={{ ...reviewPanelStyles.actionBtn, color: theme.warn }}
            title="Revert file">
            <span>Revert</span>
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setExpanded(!expanded)}
            style={reviewPanelStyles.collapseBtn}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <CaretDown size={12} weight="bold"
              style={{
                transition: 'transform 0.15s',
                transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}
            />
          </button>
        </div>
      </div>

      {/* Diff (collapsed by default) */}
      {expanded && visibleDiff.length > 0 && (
        <div style={reviewPanelStyles.diffContainer}>
          {isNew && <HunkHeader origStart={0} origLen={0} newStart={1} newLen={stats.adds} />}
          {visibleDiff.map((line, i) => (
            <div
              key={i}
              style={{
                ...reviewPanelStyles.diffLine,
                background:
                  line.kind === 'add'
                    ? 'rgba(34,197,94,0.06)'
                    : line.kind === 'remove'
                      ? 'rgba(239,68,68,0.06)'
                      : 'transparent',
              }}
            >
              <span style={reviewPanelStyles.lineNum}>{line.lineA > 0 ? line.lineA : ''}</span>
              <span style={reviewPanelStyles.lineNum}>{line.lineB > 0 ? line.lineB : ''}</span>
              <span style={reviewPanelStyles.diffMarker}>
                {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
              </span>
              <span
                style={{
                  ...reviewPanelStyles.diffText,
                  color:
                    line.kind === 'add'
                      ? theme.success
                      : line.kind === 'remove'
                        ? theme.error
                        : theme.textSoft,
                }}
              >
                {line.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  gitFiles: ReviewFileInfo[];
  onClose: () => void;
  onRevert: (path: string) => void;
  onRevertAll: () => void;
}

export function ReviewPanel({
  gitFiles,
  onClose,
  onRevert,
  onRevertAll,
}: ReviewPanelProps) {
  return (
    <div style={reviewPanelStyles.panel}>
      {/* Header */}
      <div style={reviewPanelStyles.head}>
        <span style={{ ...reviewPanelStyles.headTitle, flex: '0 0 auto' }}>Changes</span>
        <span style={{ flex: 1 }} />
        <button className="close-btn" onClick={onClose} title="Close"><X size={15} /></button>
      </div>

      {/* File list */}
      <div style={reviewPanelStyles.body}>
        {gitFiles.length === 0 && (
          <div style={reviewPanelStyles.empty}>No changes</div>
        )}
        {gitFiles.map((f) => (
          <FileCard key={f.path} file={f} onRevert={onRevert} />
        ))}
      </div>

      {/* Bottom bar */}
      {gitFiles.length > 0 && (
        <div style={reviewPanelStyles.bottomBar}>
          <button className="btn btn-ghost" onClick={onRevertAll} style={{ ...reviewPanelStyles.bottomAction, color: theme.warn }}>
            Revert all
          </button>
        </div>
      )}
    </div>
  );
}
