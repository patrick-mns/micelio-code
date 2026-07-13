import React from 'react';
import { questionCardStyles } from '@/utils/theme-styles';
import { CheckCircle, X, Lightning, Terminal } from '@phosphor-icons/react';
import { theme } from '@/theme';
import type { ToolConfirmRequest } from '@/types';

interface ToolConfirmCardProps {
  request: ToolConfirmRequest;
  onDecision: (decision: 'reject' | 'once' | 'always') => void;
}

// Inline confirmation gate for a side-effecting non-file tool (terminal,
// bg-stop, context_node) in Review mode — shown in the chat footer the same
// way EditApprovalCard shows a pending file write. The agent turn is paused
// until the user rejects, allows once, or "always allows" the tool for the
// rest of the session. Unlike EditApprovalCard there's no diff: the card just
// names the action (`title`) and what it acts on (`detail`).
export default function ToolConfirmCard({ request, onDecision }: ToolConfirmCardProps) {
  return (
    <div style={questionCardStyles.wrap}>
      <div style={questionCardStyles.card}>
        <div style={questionCardStyles.qHead}>
          <div style={questionCardStyles.qHeadLeft}>
            <Terminal size={14} color={theme.dim} />
            <span style={{ fontSize: 13, color: theme.text, fontWeight: 600 }}>
              {request.title}
            </span>
          </div>
        </div>

        {request.detail && (
          <div
            style={{
              margin: '4px 0 2px',
              padding: '8px 10px',
              borderRadius: 6,
              background: 'rgba(127,127,127,0.08)',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12.5,
              color: theme.textSoft,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 160,
              overflowY: 'auto',
            }}
          >
            {request.detail}
          </div>
        )}

        <div style={questionCardStyles.actions}>
          <button onClick={() => onDecision('reject')} className="btn btn-sm btn-ghost">
            <X size={12} weight="bold" /> Reject
          </button>
          <button onClick={() => onDecision('always')} className="btn btn-sm btn-ghost">
            <Lightning size={12} weight="bold" /> Always allow
          </button>
          <button onClick={() => onDecision('once')} className="btn btn-sm btn-solid">
            <CheckCircle size={12} weight="bold" /> Allow
          </button>
        </div>
      </div>
    </div>
  );
}
