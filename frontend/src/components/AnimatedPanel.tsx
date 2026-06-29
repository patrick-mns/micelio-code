import React, { useEffect, useState, type ReactNode } from 'react';

interface AnimatedPanelProps {
  open: boolean;
  side?: 'left' | 'right';
  width: number;
  resizing?: boolean;
  children: ReactNode;
}

// Wraps a flex-sibling side panel so it slides + grows in (and out) smoothly
// instead of snapping. Animates the wrapper width (so the neighbouring content
// is pushed gently) plus the inner opacity/translate (so the panel itself
// eases in). Keeps the child mounted through the close transition.
//
// `resizing` suppresses the width transition during a drag — otherwise every
// per-pixel width change kicks off a 400ms animation and the panel lags behind
// the cursor instead of tracking it.
export default function AnimatedPanel({ open, side = 'right', width, resizing = false, children }: AnimatedPanelProps) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (open) {
      setRender(true);
      const t = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(t);
    }
    setShow(false);
    const t = setTimeout(() => setRender(false), 400);
    return () => clearTimeout(t);
  }, [open]);

  if (!render) return null;

  const dx = side === 'left' ? -30 : 30;
  const ease = 'cubic-bezier(0.16, 1, 0.3, 1)';

  return (
    <div
      style={{
        width: show ? width : 0,
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
        transition: resizing ? 'none' : `width 400ms ${ease}`,
      }}
    >
      <div
        style={{
          width,
          height: '100%',
          opacity: show ? 1 : 0,
          transform: show ? 'translateX(0)' : `translateX(${dx}px)`,
          transition: `opacity 250ms ease, transform 400ms ${ease}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
