import React, { useMemo } from 'react';
import { questionCardStyles, reviewPanelStyles } from '@/utils/theme-styles';
import { CheckCircle, X, FileText } from '@phosphor-icons/react';
import { theme } from '@/theme';
import { computeDiff } from '@/utils/diff';
import type { EditReviewRequest } from '@/types';

interface EditApprovalCardProps {
  request: EditReviewRequest;
  onAccept: () => void;
  onReject: () => void;
}

// Inline approval gate for a single file write/edit, shown in the chat
// footer the same way QuestionCard shows a pending `ask_user` — the agent
// turn is paused until the user accepts or rejects. Nothing is written to
// disk until "Accept" is pressed, so there's no separate in-memory staging
// area to reconcile with the workspace's git diff.
export default function EditApprovalCard({ request, onAccept, onReject }: EditApprovalCardProps) {
  const diff = useMemo(
    () => computeDiff(request.original_content, request.proposed_content),
    [request],
  );
  const isNew = request.original_content === '';
  const stats = useMemo(() => {
    let adds = 0, removes = 0;
    for (const l of diff) {
      if (l.kind === 'add') adds++;
      if (l.kind === 'remove') removes++;
    }
    return { adds, removes };
  }, [diff]);

  return (
    <div style={questionCardStyles.wrap}>
      <div style={questionCardStyles.card}>
        <div style={questionCardStyles.qHead}>
          <div style={questionCardStyles.qHeadLeft}>
            <FileText size={14} color={theme.dim} />
            <span style={{ fontSize: 13, color: theme.text, fontFamily: 'ui-monospace, monospace' }}>
              {request.path}
            </span>
          </div>
          <div>
            {stats.adds > 0 && <span style={{ color: theme.success, fontWeight: 600, fontSize: 11.5 }}>+{stats.adds}</span>}
            {stats.removes > 0 && <span style={{ color: theme.error, fontWeight: 600, fontSize: 11.5 }}> -{stats.removes}</span>}
          </div>
        </div>

        <div style={{ ...reviewPanelStyles.diffContainer, maxHeight: 260, overflowY: 'auto' }}>
          {isNew && (
            <div style={reviewPanelStyles.hunkHeader}>@@ -0,0 +1,{stats.adds} @@</div>
          )}
          {diff.map((line, i) => (
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

        <div style={questionCardStyles.actions}>
          <button onClick={onReject} className="btn btn-sm btn-ghost">
            <X size={12} weight="bold" /> Reject
          </button>
          <button onClick={onAccept} className="btn btn-sm btn-solid">
            <CheckCircle size={12} weight="bold" /> Accept
          </button>
        </div>
      </div>
    </div>
  );
}
