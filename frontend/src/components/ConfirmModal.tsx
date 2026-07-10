import React, { useState, useEffect, type CSSProperties } from 'react';
import { modalStyles } from '@/utils/theme-styles';
import { theme } from '@/theme';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;       // red accent for destructive actions
  onConfirm: () => void;
  onCancel: () => void;
}

// Compact, centered confirmation dialog built on top of Modal's visual
// primitives.  Matches the project aesthetics and exists because native
// window.confirm() is unstyled, blocking, and inconsistent across platforms.
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (open) {
      // Small delay so the DOM animation kicks in
      const r = requestAnimationFrame(() => setShow(true));
      return () => cancelAnimationFrame(r);
    } else {
      setShow(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      style={{
        ...modalStyles.backdrop,
        opacity: show ? 1 : 0,
        transition: 'opacity 160ms ease',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          position: 'relative',
          background: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 16px 24px -6px rgba(0,0,0,0.4)',
          width: 'min(420px, 90vw)',
          padding: 0,
          overflow: 'hidden',
          opacity: show ? 1 : 0,
          transform: show ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.96)',
          transition: 'opacity 160ms ease, transform 200ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '16px 20px 0',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: theme.text, lineHeight: 1.3 }}>
            {title}
          </span>
        </div>

        {/* ── Body ── */}
        <div
          style={{
            padding: '10px 20px 20px',
            fontSize: 13.5,
            color: theme.textSoft,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>

        {/* ── Actions ── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '0 20px 16px',
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12.5,
              fontWeight: 500,
              color: theme.textSoft,
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12.5,
              fontWeight: 600,
              color: '#fff',
              background: danger ? theme.error : theme.accent,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}