import React, { useEffect, useState, type ReactNode } from 'react';

interface AnimatedPanelProps {
  open: boolean;
  side?: 'left' | 'right' | 'bottom';
  /** Size along the panel's axis: width for left/right, height for bottom. */
  size: number;
  resizing?: boolean;
  children: ReactNode;
}

// Wraps a flex-sibling docked panel so it slides + grows in (and out) smoothly
// instead of snapping. Animates the wrapper's size along its axis (so the
// neighbouring content is pushed gently) while the inner panel is pinned to the
// wrapper's *inner* edge (the one that moves) — right edge for a left panel,
// left edge for a right panel, top edge for a bottom panel. This makes the
// panel slide in as a unit from its docked side, rather than being "revealed"
// by the clip.
//
// `resizing` suppresses the size transition during a drag — otherwise every
// per-pixel change kicks off a 400ms animation and the panel lags behind the
// cursor instead of tracking it.
export default function AnimatedPanel({ open, side = 'right', size, resizing = false, children }: AnimatedPanelProps) {
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
  const vertical = side === 'bottom';
  // The edge the inner panel is pinned to: the one that stays put while the
  // wrapper's size animates.
  const pinnedEdge = vertical ? 'top' : side === 'left' ? 'right' : 'left';

  return (
    <div
      style={{
        position: 'relative',
        width: vertical ? '100%' : show ? size : 0,
        height: vertical ? (show ? size : 0) : '100%',
        flexShrink: 0,
        overflow: 'hidden',
        transition: resizing ? 'none' : `${vertical ? 'height' : 'width'} 400ms ${ease}`,
      }}
    >
      {/* Inner panel pinned to the wrapper's moving edge — no opacity/transform
          animation, just the wrapper's size clip reveals it smoothly. */}
      <div
        style={{
          position: 'absolute',
          [pinnedEdge]: 0,
          ...(vertical ? { left: 0, width: '100%', height: size } : { top: 0, width: size, height: '100%' }),
        }}
      >
        {children}
      </div>
    </div>
  );
}
