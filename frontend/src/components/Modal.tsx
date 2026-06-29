import React, { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { modalStyles } from '@/utils/theme-styles';
import { theme } from '@/theme';

interface ModalProps {
  onClose: () => void;
  onEscape?: () => void;
  closeOnBackdrop?: boolean;
  animate?: boolean;
  backdropStyle?: CSSProperties;
  cardStyle?: CSSProperties;
  children: ReactNode;
}

// Centered modal primitive: a backdrop + a centered card, with Escape-to-close
// and click-outside-to-close. Callers render the head/body as children and can
// tune the rest via props:
//   - onEscape:        override the Esc handler (defaults to onClose). Used when
//                      Esc should do something else first (e.g. exit edit mode).
//   - closeOnBackdrop: false to disable click-outside (e.g. while editing).
//   - animate:         fade + scale-in on mount (the graph node inspector).
//   - backdropStyle / cardStyle: per-modal overrides (zIndex, background, …).
export default function Modal({
  onClose,
  onEscape,
  closeOnBackdrop = true,
  animate = false,
  backdropStyle,
  cardStyle,
  children,
}: ModalProps) {
  const [show, setShow] = useState(!animate);

  useEffect(() => {
    const r = animate ? requestAnimationFrame(() => setShow(true)) : null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (onEscape ?? onClose)(); };
    document.addEventListener('keydown', onKey);
    return () => {
      if (r) cancelAnimationFrame(r);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, onEscape, animate]);

  return (
    <div
      style={{ ...modalStyles.backdrop, ...backdropStyle, ...(animate ? { opacity: show ? 1 : 0, transition: 'opacity 160ms ease' } : {}) }}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          ...modalStyles.card,
          ...cardStyle,
          ...(animate
            ? {
                opacity: show ? 1 : 0,
                transform: show ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)',
                transition: 'opacity 180ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              }
            : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}

