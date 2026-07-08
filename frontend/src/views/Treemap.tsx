import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import type { TreemapNode } from '@/types';
import NodeModal from '@/components/NodeModal';
import ScanOverlay from '@/components/ScanOverlay';
import useTreemapCanvas, { type Dims } from '@/hooks/useTreemapCanvas';
import { MIN_SCAN_MS } from '@/utils/treemapHelpers';

// Minimum time the scan sweep stays visible, so even an instant re-index
// shows one complete animation pass instead of a flicker.

export default function TreemapView() {
  const { graphNodes, setGraphNodes, selectedNode, setSelectedNode, scanning, setScanning, activeRoot } = useStore();

  // Filter graph nodes by active root prefix
  const filteredNodes = React.useMemo(() => {
    if (!activeRoot) return graphNodes;
    const prefix = (activeRoot.split('/').pop() || activeRoot.split('\\').pop() || '').toLowerCase();
    if (!prefix) return graphNodes;
    return graphNodes.filter((n) => {
      const label = (n.name || '').toLowerCase();
      return label === prefix || label.startsWith(prefix + '/');
    });
  }, [graphNodes, activeRoot]);

  const [hovered, setHovered] = useState<TreemapNode | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<Dims>({ w: window.innerWidth, h: window.innerHeight - 52 });

  // ── Canvas hook ─────────────────────────────────────────────────────────────
  const {
    canvasRef,
    layout,
    isDragging,
    scheduleDraw,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    hitTestNodes,
  } = useTreemapCanvas(filteredNodes, dims);

  // ── Fetch graph on mount ────────────────────────────────────────────────────
  useEffect(() => {
    ipc.getGraph().then(setGraphNodes).catch(console.error);
  }, []);

  // ── ResizeObserver ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      if (w > 0 && h > 0) {
        setDims((d) => (d.w === w && d.h === h ? d : { w, h }));
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [graphNodes.length]);

  // ── Sync canvas size & paint on layout/dims change ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    canvas.style.width = `${dims.w}px`;
    canvas.style.height = `${dims.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    scheduleDraw();
  }, [layout, dims]);

  // ── Mouse handlers ──────────────────────────────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging.current) return;
    const hit = hitTestNodes(e.clientX, e.clientY);
    if (hit && hit.data) {
      setSelectedNode(hit.data as TreemapNode);
      setHovered(null);
    }
  }, [hitTestNodes, setSelectedNode]);

  const handleMouseMoveForHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    onMouseMove(e);
    if (isDragging.current) return;
    const hit = hitTestNodes(e.clientX, e.clientY);
    if (hit && hit.data) {
      setHovered(hit.data as TreemapNode);
    } else {
      setHovered(null);
    }
  }, [onMouseMove, hitTestNodes]);

  // ── Scan sweep ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scanning) return;
    const t = setTimeout(() => {
      ipc.getGraph().then(setGraphNodes).catch(console.error);
      setScanning(false);
    }, MIN_SCAN_MS);
    return () => clearTimeout(t);
  }, [scanning]);

  // ── Hover tooltip content ───────────────────────────────────────────────────
  const selected = useStore((s) => s.selectedNode);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      // While the node modal is open, ignore wheel/drag so scrolling inside the
      // modal doesn't pan or zoom the treemap behind it.
      onWheel={selectedNode ? undefined : onWheel}
      onMouseDown={selectedNode ? undefined : onMouseDown}
      onMouseMove={selectedNode ? undefined : handleMouseMoveForHover}
      onMouseUp={selectedNode ? undefined : onMouseUp}
      onMouseLeave={selectedNode ? undefined : onMouseUp}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ display: 'block', cursor: 'grab' }}
      />

      {/* Scan overlay */}
      {scanning && <ScanOverlay />}

      {/* Hover tooltip */}
      {hovered && !isDragging.current && (
        <div style={{
          position: 'absolute', bottom: 16, left: 16,
          background: theme.card, border: `1px solid ${theme.border}`,
          borderRadius: 8, padding: '8px 12px',
          color: theme.text, fontSize: 12, maxWidth: 320,
          pointerEvents: 'none',
        }}>
          <div style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: 600, marginBottom: 2,
          }}>
            {hovered.name}
          </div>
          <div>
            <span style={{ color: theme.dim }}>{hovered.kind}</span>
            {hovered.value > 0 && (
              <span style={{ color: theme.faint, marginLeft: 8 }}>
                {hovered.value.toLocaleString()} bytes
              </span>
            )}
          </div>
        </div>
      )}

      {/* Node detail modal */}
      {selected && <NodeModal node={selected} onClose={() => setSelectedNode(null)} />}
    </div>
  );
}