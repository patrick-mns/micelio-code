// Pure helpers for the treemap canvas renderer — no React dependency.

import type { HierarchyRectangularNode } from 'd3-hierarchy';
import { KIND_COLORS } from '@/theme';
import type { TreemapNode } from '@/types';

// d3 lays out either the single root node or a synthetic wrapper; both expose
// the fields the renderer reads.
export type TreemapDatum = Pick<TreemapNode, 'name' | 'kind' | 'value'> & {
  children?: TreemapDatum[];
} & Partial<TreemapNode>;
export type LaidOutNode = HierarchyRectangularNode<TreemapDatum>;

export interface Point {
  x: number;
  y: number;
}

// ── Kind → color map ──────────────────────────────────────────────────────────
export function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? '#2563eb';
}

// ── Colour helpers ────────────────────────────────────────────────────────────
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbA(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Text / label helpers ──────────────────────────────────────────────────────
export function fitLabel(text: string, widthPx: number, fontSize: number): string {
  const maxChars = Math.max(1, Math.floor((widthPx - 10) / (fontSize * 0.6)));
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + '…';
}

export function shortName(label: string): string {
  return label.split('/').pop()!.split('::').pop()!;
}

// `lock` is the padlock glyph. It carries no backing plate, so it has to
// contrast against the card itself — which flips with the theme. It is fully
// opaque: the glyph lands on card seams and percentage text, and any alpha lets
// those ghost through it.
type TextVariant = 'container' | 'label' | 'pct' | 'lock';

export function getTextColor(variant: TextVariant): string {
  const isLight = document.documentElement.dataset.theme === 'light';
  if (isLight) {
    if (variant === 'container') return 'rgba(26,25,22,0.6)';
    if (variant === 'label') return 'rgba(26,25,22,0.9)';
    if (variant === 'pct') return 'rgba(26,25,22,0.55)';
    if (variant === 'lock') return '#1a1916';
  } else {
    if (variant === 'container') return 'rgba(255,255,255,0.5)';
    if (variant === 'label') return 'rgba(255,255,255,0.92)';
    if (variant === 'pct') return 'rgba(255,255,255,0.55)';
    if (variant === 'lock') return '#f5f5f4';
  }
  return 'rgba(255,255,255,0.5)';
}

// ── Canvas drawing ────────────────────────────────────────────────────────────
// Appends a rounded rect to the current path, clockwise. Split out from
// `roundRect` so the padlock can combine it with other subpaths in one fill.
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
}

export function drawTreemap(
  canvas: HTMLCanvasElement | null,
  nodes: LaidOutNode[],
  totalLeafArea: number,
  zoom: number,
  pan: Point,
  vpW: number,
  vpH: number,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gap = Math.max(0.5, Math.min(4.0, 1.5 * zoom));

  const sorted = [...nodes].sort((a, b) => {
    if (!!a.data.children !== !!b.data.children)
      return a.data.children ? -1 : 1;
    return a.depth - b.depth;
  });

  // Padlocks are collected here and drawn after every tile: a locked directory
  // is painted before its children, so a badge drawn inline would be buried
  // under them. Drawing last also keeps the lock crisp over the dimmed card.
  const padlocks: { cx: number; cy: number; size: number }[] = [];

  for (const node of sorted) {
    const rw = (node.x1 - node.x0) * zoom;
    const rh = (node.y1 - node.y0) * zoom;
    const isContainer = node.data.children && node.data.children.length > 0;
    if (isContainer && (rw < 4 || rh < 4)) continue;
    if (!isContainer && (rw < 1 || rh < 1)) continue;

    const rx = node.x0 * zoom + pan.x;
    const ry = node.y0 * zoom + pan.y;
    if (rx + rw < 0 || ry + rh < 0 || rx > vpW || ry > vpH) continue;

    const ix = rx + gap;
    const iy = ry + gap;
    const iw = Math.max(0, Math.max(2, rw) - gap * 2);
    const ih = Math.max(0, Math.max(2, rh) - gap * 2);
    const color = kindColor(node.data.kind);
    const corner = (iw > 20 && ih > 20) ? 5 : 2;

    ctx.save();
    if (node.data.locked) ctx.globalAlpha = 0.5;
    roundRect(ctx, ix, iy, iw, ih, corner);

    if (isContainer) {
      ctx.fillStyle = rgbA(color, 0.12);
      ctx.fill();
      ctx.strokeStyle = rgbA(color, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      const stripUnits = (node.y1 - node.y0) > 24 ? 15 : 1;
      const headerH = stripUnits * zoom - gap;
      if (iw > 30 && headerH >= 9) {
        const fontSize = Math.min(13, Math.max(8, headerH - 3));
        ctx.save();
        ctx.beginPath();
        ctx.rect(ix, iy, iw, headerH);
        ctx.clip();
        ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
        ctx.fillStyle = getTextColor('container');
        ctx.textBaseline = 'middle';
        ctx.fillText(fitLabel(shortName(node.data.name), iw - 4, fontSize), ix + 6, iy + headerH / 2);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }
    } else {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (iw > 34 && ih > 16) {
        const fontSize = Math.min(14, Math.max(9, Math.min(ih * 0.28, iw * 0.16)));
        ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
        ctx.fillStyle = getTextColor('label');
        const label = fitLabel(shortName(node.data.name), iw, fontSize);
        const pct = totalLeafArea > 0
          ? ((node.x1 - node.x0) * (node.y1 - node.y0)) / totalLeafArea * 100
          : 0;
        const pctStr = pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
        const tok = node.data.tokens ?? 0;
        const tokStr = tok >= 1000 ? `~${(tok/1000).toFixed(1)}k tok` : `${tok} tok`;
        if (ih > 58 && tok > 0) {
          // Three lines: label + tokens (just above %) + BIG percentage
          ctx.fillText(label, ix + 5, iy + 4 + fontSize);
          const pctSize = Math.max(16, Math.min(Math.floor(iw * 0.20), Math.floor((ih - fontSize - 14) * 0.75)));
          const tokSize = Math.max(10, Math.min(13, Math.floor(pctSize * 0.38)));
          ctx.font = `500 ${tokSize}px -apple-system, sans-serif`;
          ctx.fillStyle = getTextColor('pct');
          ctx.textBaseline = 'bottom';
          ctx.fillText(tokStr, ix + 5, iy + ih - 4 - pctSize - 4);
          ctx.textBaseline = 'alphabetic';
          ctx.font = `700 ${pctSize}px -apple-system, sans-serif`;
          ctx.fillStyle = getTextColor('label');
          ctx.textBaseline = 'bottom';
          ctx.fillText(pctStr, ix + 5, iy + ih - 4);
          ctx.textBaseline = 'alphabetic';
        } else if (ih > 42) {
          // Two lines: label on top, BIG percentage below
          ctx.fillText(label, ix + 5, iy + 4 + fontSize);
          const pctSize = Math.max(16, Math.min(Math.floor(iw * 0.22), Math.floor((ih - fontSize - 14) * 0.85)));
          ctx.font = `700 ${pctSize}px -apple-system, sans-serif`;
          ctx.fillStyle = getTextColor('label');
          ctx.textBaseline = 'bottom';
          ctx.fillText(pctStr, ix + 5, iy + ih - 4);
          ctx.textBaseline = 'alphabetic';
        } else {
          // Tight fit — big % centered, no label
          const pctSize = Math.max(14, Math.min(Math.floor(iw * 0.20), Math.floor(ih * 0.5)));
          ctx.font = `700 ${pctSize}px -apple-system, sans-serif`;
          ctx.fillStyle = getTextColor('label');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pctStr, ix + iw / 2, iy + ih / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        }
      }
    }

    // One padlock per lock, not per tile: a locked directory cascades to
    // everything inside it, and a lock on every child would read as many
    // separate locks instead of one. The outermost locked node owns the badge
    // and its descendants just stay dimmed.
    if (node.data.locked && !hasLockedAncestor(node) && iw > 14 && ih > 14) {
      const size = Math.max(12, Math.min(52, Math.min(iw, ih) * 0.3));
      // A container has no text of its own, so the lock sits dead center and
      // reads as covering the whole group. A leaf's label, tokens and
      // percentage are all left-aligned, so its lock hugs the right edge
      // instead — centered there it would land on top of the percentage.
      const cx = isContainer
        ? ix + iw / 2
        : Math.max(ix + iw / 2, ix + iw - size * 0.36 - 8);
      padlocks.push({ cx, cy: iy + ih / 2, size });
    }

    ctx.restore();
  }

  for (const p of padlocks) drawPadlock(ctx, p.cx, p.cy, p.size);
}

// Whether some ancestor is already locked, which means this node is locked only
// by inheritance and shouldn't draw its own badge.
function hasLockedAncestor(node: LaidOutNode): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.data.locked) return true;
  }
  return false;
}

// How much of the card bleeds through the padlock. Slight, so the lock sits in
// the card rather than on top of it, but the glyph still has to survive landing
// on percentage text and on the seams between child cards.
const LOCK_ALPHA = 0.88;

// Padlock marking a locked card (the agent knows the file is there but can't
// read it). Drawn as paths because the canvas renderer can't use the icon font.
// `size` is the glyph's height budget; it's centered on (cx, cy).
//
// Shackle, body and keyhole go into a single path filled once, which is what
// makes LOCK_ALPHA work: stroking the shackle and then filling the body over it
// would composite the overlap twice and leave the leg bases brighter than the
// rest of the glyph. One fill also means the shackle and body abut seamlessly,
// and the keyhole — wound backwards so the nonzero rule cancels it out — is a
// real hole showing the card, not a dot painted in some colour that could never
// match every card.
function drawPadlock(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const bodyW = size * 0.72;
  const bodyH = size * 0.52;
  const shackleR = size * 0.22;
  const lw = Math.max(1, size * 0.1);
  const outerR = shackleR + lw / 2;
  const innerR = shackleR - lw / 2;

  // Center the whole glyph — shackle top to body bottom — on cy.
  const glyphH = shackleR + lw / 2 + bodyH;
  const bodyTop = cy - glyphH / 2 + shackleR + lw / 2;

  ctx.save();
  ctx.globalAlpha = LOCK_ALPHA;
  ctx.fillStyle = getTextColor('lock');
  ctx.beginPath();

  // Shackle: a filled arch that stops exactly at the body's top edge, so it
  // meets the body without overlapping it.
  ctx.arc(cx, bodyTop, outerR, Math.PI, 0, false);
  ctx.lineTo(cx + innerR, bodyTop);
  ctx.arc(cx, bodyTop, innerR, 0, Math.PI, true);
  ctx.closePath();

  roundRectPath(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, size * 0.11);

  const holeR = size * 0.1;
  const holeY = bodyTop + bodyH / 2;
  ctx.moveTo(cx + holeR, holeY);
  ctx.arc(cx, holeY, holeR, 0, Math.PI * 2, true); // reverse-wound: punches out

  ctx.fill();
  ctx.restore();
}

// ── Hit testing ───────────────────────────────────────────────────────────────
export function hitTest(nodes: LaidOutNode[], x: number, y: number, zoom: number, pan: Point): LaidOutNode | null {
  let best: LaidOutNode | null = null;
  for (const node of nodes) {
    const rx = node.x0 * zoom + pan.x;
    const ry = node.y0 * zoom + pan.y;
    const rw = (node.x1 - node.x0) * zoom;
    const rh = (node.y1 - node.y0) * zoom;
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
      if (!best || node.depth >= best.depth) best = node;
    }
  }
  return best;
}

// ── Data conversion ───────────────────────────────────────────────────────────
export function rustNodesToD3(nodes: TreemapNode[]): TreemapDatum | null {
  if (!nodes || nodes.length === 0) return null;
  const root: TreemapDatum = nodes.length === 1
    ? nodes[0]
    : { name: 'root', kind: 'Directory', value: 0, children: nodes };
  return root;
}

// Minimum time the scan sweep stays visible, so even an instant re-index
// shows one complete animation pass instead of a flicker.
export const MIN_SCAN_MS = 1200;
