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
// is pushed gently) while the inner panel is pinned to the wrapper's *inner*
// edge (the one that moves) — right edge for a left panel, left edge for a
// right panel. This makes both panels slide in as a unit from their docked
// side, rather than one being "revealed" by the clip.
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

  const ease = 'cubic-bezier(0.16, 1, 0.3, 1)';

  return (
    <div
      style={{
        position: 'relative',
        width: show ? width : 0,
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
        transition: resizing ? 'none' : `width 400ms ${ease}`,
      }}
    >
      {/* Inner panel pinned to the wrapper's moving edge — no opacity/transform
          animation, just the wrapper's width clip reveals it smoothly. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          [side === 'left' ? 'right' : 'left']: 0,
          width,
          height: '100%',
        }}
      >
        {children}
      </div>
    </div>
  );
}
