import { useCallback, useRef, useMemo, type MutableRefObject, type WheelEvent, type MouseEvent } from 'react';
import { treemap, treemapSquarify, hierarchy } from 'd3-hierarchy';
import { drawTreemap, hitTest, rustNodesToD3, type LaidOutNode, type Point, type TreemapDatum } from '@/utils/treemapHelpers';
import type { TreemapNode } from '@/types';

export interface Dims {
  w: number;
  h: number;
}

interface View {
  zoom: number;
  pan: Point;
}

interface Layout {
  nodes: LaidOutNode[];
  totalLeafArea: number;
}

/**
 * Encapsulates treemap canvas rendering — zoom, pan, drag, hit-test.
 *
 * Returns everything the view needs to wire up events and paint the canvas.
 */
export default function useTreemapCanvas(graphNodes: TreemapNode[], dims: Dims) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const viewRef = useRef<View>({ zoom: 1, pan: { x: 0, y: 0 } });
  const isDragging = useRef(false);
  const lastMouse = useRef<Point>({ x: 0, y: 0 });

  // ── d3 layout ───────────────────────────────────────────────────────────────
  const layout = useMemo<Layout>(() => {
    const d3data = rustNodesToD3(graphNodes);
    if (!d3data) return { nodes: [], totalLeafArea: 0 };

    const root = hierarchy<TreemapDatum>(d3data)
      .sum((d) => (d.children && d.children.length ? 0 : d.value || 0))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const t = treemap<TreemapDatum>()
      .tile(treemapSquarify)
      .size([dims.w, dims.h])
      .paddingOuter(1)
      .paddingTop((n) => (n.y1 - n.y0) > 24 ? 15 : 1)
      .paddingLeft(1)
      .paddingRight(1)
      .paddingBottom(1)
      .paddingInner(1);

    const laidOut = t(root);

    const allNodes = laidOut.descendants();
    const leafArea = allNodes
      .filter((n) => !n.children)
      .reduce((s, n) => s + (n.x1 - n.x0) * (n.y1 - n.y0), 0);

    return { nodes: allNodes, totalLeafArea: leafArea };
  }, [graphNodes, dims]);

  // ── Draw ────────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { zoom: z, pan: p } = viewRef.current;
    drawTreemap(canvas, layout.nodes, layout.totalLeafArea, z, p, dims.w, dims.h);
  }, [layout, dims]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  // ── Events ──────────────────────────────────────────────────────────────────
  const onWheel = useCallback((e: WheelEvent<Element>) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const { zoom: z, pan: p } = viewRef.current;
    const nz = Math.max(0.2, z * factor);
    viewRef.current = {
      zoom: nz,
      pan: {
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z),
      },
    };
    scheduleDraw();
  }, [scheduleDraw]);

  const onMouseDown = useCallback((e: MouseEvent<Element>) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: MouseEvent<Element>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    viewRef.current = {
      ...viewRef.current,
      pan: {
        x: viewRef.current.pan.x + dx,
        y: viewRef.current.pan.y + dy,
      },
    };
    scheduleDraw();
  }, [scheduleDraw]);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const resetView = useCallback(() => {
    viewRef.current = { zoom: 1, pan: { x: 0, y: 0 } };
    scheduleDraw();
  }, [scheduleDraw]);

  // ── Hit test helper (used by the view on click/hover) ───────────────────────
  const hitTestNodes = useCallback((clientX: number, clientY: number): LaidOutNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { zoom: z, pan: p } = viewRef.current;
    return hitTest(layout.nodes, x, y, z, p);
  }, [layout.nodes]);

  return {
    canvasRef,
    layout,
    viewRef: viewRef as MutableRefObject<View>,
    isDragging,
    draw,
    scheduleDraw,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    resetView,
    hitTestNodes,
  };
}
