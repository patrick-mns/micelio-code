import React, { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { scanOverlayStyles } from '@/utils/theme-styles';
import { theme } from '@/theme';
import { ipc } from '@/ipc';

// An animated force-directed knowledge graph shown while indexing: nodes float
// under gravity + repulsion, edges act as springs, and everything gently
// jiggles. Nodes pulse green (CSS) as if being discovered.
const W = 240, H = 160, N = 15, PAD = 14;

interface GraphNode { x: number; y: number; vx: number; vy: number; }
type Edge = [number, number];

function buildGraph(): { nodes: GraphNode[]; edges: Edge[] } {
  const cx = W / 2, cy = H / 2;
  const nodes: GraphNode[] = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2;
    return { x: cx + Math.cos(a) * 36 + (Math.random() - 0.5) * 10,
             y: cy + Math.sin(a) * 28 + (Math.random() - 0.5) * 10,
             vx: 0, vy: 0 };
  });
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push([a, b]);
  };
  for (let i = 0; i < N; i++) { add(i, (i + 1) % N); add(i, (i + 2) % N); } // ring + skip
  for (let i = 0; i < 7; i++) add((Math.random() * N) | 0, (Math.random() * N) | 0); // chords
  return { nodes, edges };
}

export default function ScanOverlay() {
  const { nodes, edges } = useMemo(buildGraph, []);
  const nodeRefs = useRef<(SVGCircleElement | null)[]>([]);
  const edgeRefs = useRef<(SVGLineElement | null)[]>([]);

  const handleCancel = useCallback(async () => {
    try {
      await ipc.cancelWorkspaceScan();
    } catch { /* Tauri not available in dev */ }
  }, []);

  // Escape key cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleCancel]);

  useEffect(() => {
    let raf = 0;
    const cx = W / 2, cy = H / 2;
    const step = () => {
      // Center gravity + pairwise repulsion.
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        a.vx += (cx - a.x) * 0.0009;
        a.vy += (cy - a.y) * 0.0009;
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          const f = 200 / d2;
          const fx = (f * dx) / d, fy = (f * dy) / d;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      // Edge springs.
      for (const [ai, bi] of edges) {
        const a = nodes[ai], b = nodes[bi];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - 44) * 0.012;
        const fx = (f * dx) / d, fy = (f * dy) / d;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      // Jitter, damping, integrate, soft bounds, write to SVG.
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        a.vx += (Math.random() - 0.5) * 0.05;
        a.vy += (Math.random() - 0.5) * 0.05;
        a.vx *= 0.9; a.vy *= 0.9;
        const sp = Math.hypot(a.vx, a.vy), max = 1.1;
        if (sp > max) { a.vx = (a.vx / sp) * max; a.vy = (a.vy / sp) * max; }
        a.x += a.vx; a.y += a.vy;
        if (a.x < PAD) { a.x = PAD; a.vx *= -0.5; }
        if (a.x > W - PAD) { a.x = W - PAD; a.vx *= -0.5; }
        if (a.y < PAD) { a.y = PAD; a.vy *= -0.5; }
        if (a.y > H - PAD) { a.y = H - PAD; a.vy *= -0.5; }
        const el = nodeRefs.current[i];
        if (el) { el.setAttribute('cx', String(a.x)); el.setAttribute('cy', String(a.y)); }
      }
      edges.forEach(([ai, bi], k) => {
        const el = edgeRefs.current[k];
        if (!el) return;
        el.setAttribute('x1', String(nodes[ai].x)); el.setAttribute('y1', String(nodes[ai].y));
        el.setAttribute('x2', String(nodes[bi].x)); el.setAttribute('y2', String(nodes[bi].y));
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  return (
    <div style={scanOverlayStyles.backdrop} onClick={handleCancel}>
      <div style={scanOverlayStyles.stack} onClick={(e) => e.stopPropagation()}>
        <svg viewBox={`0 0 ${W} ${H}`} width="230" height="153">
          {edges.map(([a, b], i) => (
            <line
              key={`e-${i}`}
              ref={(el) => { edgeRefs.current[i] = el; }}
              className="scan-edge"
              x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
              style={{ animationDelay: `${(i % 6) * 0.12}s` }}
            />
          ))}
          {nodes.map((n, i) => (
            <circle
              key={`n-${i}`}
              ref={(el) => { nodeRefs.current[i] = el; }}
              className="scan-node"
              cx={n.x} cy={n.y} r={5.5}
              style={{ animationDelay: `${i * 0.11}s` }}
            />
          ))}
        </svg>
        <div style={scanOverlayStyles.label}>Indexing workspace…</div>
        <div style={scanOverlayStyles.hint}>(esc) to cancel</div>
      </div>
    </div>
  );
}

