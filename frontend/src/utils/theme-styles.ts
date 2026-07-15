import type { CSSProperties } from 'react';
import { theme } from '@/theme';

// ── App.tsx ──────────────────────────────────────────────────────────────
export const appStyles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: theme.bg,
    color: theme.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflow: 'hidden',
    userSelect: 'none',
  },
  header: {
    height: 52,
    display: 'flex',
    alignItems: 'center',
    background: theme.bg,
    flexShrink: 0,
    paddingInline: 12,
  },
  trafficGap: { width: 72, flexShrink: 0 },
  // Left and right columns share the leftover space equally (flex:1 1 0) so the
  // center tabs group (flex:0 0 auto, natural width) stays truly centred in the
  // window regardless of the asymmetric widths of the side controls.
  headerLeft: { flex: '1 1 0', display: 'flex', alignItems: 'center', gap: 8 },
  headerRight: { flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  center: { flex: '0 0 auto', display: 'flex', justifyContent: 'center' },
  // Tabs (.seg-track/.seg-btn) and the sidebar toggle (.icon-btn) are styled
  // via the unified button classes in buttons.css.
  body: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'row' },
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 },
  view: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 },
};

// ── Modal.tsx ────────────────────────────────────────────────────────────
export const modalStyles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(2px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  card: {
    position: 'relative',
    background: theme.card,
    border: `1px solid ${theme.border}`,
    borderRadius: "var(--radius-lg)",
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
    // Fixed size so modals (node inspector, system prompt) don't resize to
    // their content — the box stays put and the body scrolls internally.
    width: 'min(860px, 92vw)',
    height: 'min(78vh, 700px)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: "var(--radius-sm)",
    cursor: 'pointer',
    color: theme.dim,
    zIndex: 1001,
  },
};

// ── SummarizeBanner.tsx ──────────────────────────────────────────────────
export const summarizeStyles: Record<string, CSSProperties> = {
  wrap: {
    background: theme.card,
    border: `1px solid ${theme.border}`,
    borderRadius: "var(--radius-lg)",
    padding: '10px 12px',
  },
  head: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 },
  label: { flex: 1, color: theme.text, fontSize: 12.5, fontWeight: 500 },
  count: {
    color: theme.dim,
    fontSize: 11.5,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  },
  time: { color: theme.faint },
  failed: { color: theme.error, fontWeight: 400 },
  cancel: {
    display: 'flex', alignItems: 'center', gap: 4,
    height: 24, padding: '0 9px',
    background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: "var(--radius-sm)",
    cursor: 'pointer', color: theme.textSoft, fontSize: 11.5, fontWeight: 500,
    fontFamily: 'inherit',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: `repeat(120, 1fr)`,
    gap: 1.5,
    overflow: 'visible',
  },
};

// ── TranscriptView.tsx ───────────────────────────────────────────────────
export const transcriptStyles: Record<string, CSSProperties> = {
  root: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: theme.bg },
  bar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0,
  },
  barLeft: { display: 'flex', alignItems: 'baseline', gap: 8 },
  title: { fontSize: 13, fontWeight: 600, color: theme.text },
  sub: { fontSize: 11.5, color: theme.dim },
  barRight: { display: 'flex', alignItems: 'center', gap: 12 },
  usage: { fontSize: 11, color: theme.dim, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
  close: { flexShrink: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '16px 0 40px' },
  col: { width: '100%', maxWidth: 720, margin: '0 auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 },
  loading: { color: theme.dim, fontSize: 13, textAlign: 'center', padding: 40 },
  err: { color: theme.error, fontSize: 12.5, fontFamily: 'ui-monospace, monospace', padding: 12 },
  item: { border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)", overflow: 'hidden', background: theme.card },
  head: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
  },
  role: { fontSize: 12, fontWeight: 600 },
  toolName: { fontSize: 11, color: theme.dim, fontFamily: 'ui-monospace, monospace' },
  tok: { marginLeft: 'auto', fontSize: 10.5, color: theme.faint, fontFamily: 'ui-monospace, monospace' },
};

// ── ToolEntry.tsx ───────────────────────────────────────────────────────
// MONO inlined (const MONO below is in TDZ at this point in module init).
export const toolEntryStyles: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column' },
  groupWrap: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    background: 'transparent', border: 'none', padding: '5px 4px',
    borderRadius: "var(--radius-sm)", fontFamily: 'inherit', textAlign: 'left',
  },
  name: { color: theme.textSoft, fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, monospace', flexShrink: 0 },
  groupName: { color: theme.dim, fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
  breadcrumb: {
    fontSize: 11.5, color: theme.dim, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  stats: { display: 'flex', gap: 5, flexShrink: 0, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 },
  added: { color: theme.success },
  removed: { color: theme.error },
  spinner: {
    width: 9, height: 9, borderRadius: '50%',
    border: `1.5px solid ${theme.accent}`, borderTopColor: 'transparent',
    display: 'inline-block', animation: 'spin 0.7s linear infinite',
  },
  // Detail: rounded connector comes from the `.tool-detail` CSS class.
  detail: { display: 'flex', flexDirection: 'column', overflowX: 'auto', paddingBlock: 2 },
  lineRemoved: { display: 'flex', alignItems: 'flex-start', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11.5, lineHeight: 1.5 },
  lineAdded: { display: 'flex', alignItems: 'flex-start', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11.5, lineHeight: 1.5 },
  lineContext: { display: 'flex', alignItems: 'flex-start', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11.5, lineHeight: 1.5, color: theme.faint },
  markerMinus: { width: 12, textAlign: 'center', color: theme.error, flexShrink: 0 },
  markerPlus: { width: 12, textAlign: 'center', color: theme.success, flexShrink: 0 },
  markerCtx: { width: 12, textAlign: 'center', color: theme.faint, flexShrink: 0 },
  lineBody: { flex: 1, paddingRight: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: theme.textSoft },
  plainLine: { fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11.5, lineHeight: 1.55, color: theme.dim, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  // Grouped rows: tree connectors come from the `.tool-tree*` CSS classes.
  groupBody: { marginLeft: 8, display: 'flex', flexDirection: 'column', marginTop: 1 },
};

// ── BgTasksChip.tsx ──────────────────────────────────────────────────────
export const bgTasksChipStyles: Record<string, CSSProperties> = {
  chip: {
    // Icon-only collapses to a 28×28 square (matches the adjacent .btn-icon
    // buttons); padding only kicks in to fit the running-count badge.
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    minWidth: 28, height: 28, padding: '0 6px',
    borderRadius: "var(--radius-md)",
    fontSize: 12.5, fontFamily: 'inherit',
  },
  badge: {
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11.5, fontWeight: 600,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  },
  panel: {
    width: 'calc(100% - 8px)', flexShrink: 0,
    margin: '8px 8px 8px 0',
    height: 'calc(100% - 16px)',
    background: theme.card, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)",
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 10px 16px',
    flexShrink: 0,
  },
  headTitle: { flex: 1, color: theme.text, fontSize: 13, fontWeight: 600 },
  body: { flex: 1, overflowY: 'auto', padding: '4px 8px 8px' },
  empty: { color: theme.faint, fontSize: 12, padding: '12px 8px', textAlign: 'center' },
  section: { color: theme.dim, fontSize: 11, padding: '6px 6px 2px' },
  sectionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 6px 2px 6px' },
  card: {
    background: theme.bg, borderRadius: "var(--radius-md)",
    padding: '8px 10px', marginBottom: 4,
  },
  cardTop: { display: 'flex', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: '50%', background: theme.success, flexShrink: 0 },
  cmd: {
    flex: 1, minWidth: 0, color: theme.text, fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: { color: theme.dim, fontSize: 10.5, marginTop: 3, marginLeft: 24 },
  log: {
    margin: '8px 0 0', maxHeight: 240, overflow: 'auto',
    borderRadius: "var(--radius-sm)", padding: '8px 10px',
    fontSize: 11, lineHeight: 1.5,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    border: `1px solid ${theme.border}`,
  },
  // close button uses .close-btn (primitives.css)
};

// ── ReviewPanel.tsx ────────────────────────────────────────────────────────
export const reviewPanelStyles: Record<string, CSSProperties> = {
  chip: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    minWidth: 28, height: 28, padding: '0 6px',
    borderRadius: "var(--radius-md)",
    fontSize: 12.5, fontFamily: 'inherit',
  },
  badge: {
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 11.5, fontWeight: 600,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    color: theme.text,
  },
  panel: {
    width: 'calc(100% - 8px)', flexShrink: 0,
    margin: '8px 8px 8px 0',
    height: 'calc(100% - 16px)',
    background: theme.card, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)",
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 10px 16px',
    flexShrink: 0,
  },
  headTitle: { flex: 1, color: theme.text, fontSize: 13, fontWeight: 600 },
  headFolder: {
    display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
    color: theme.dim, fontSize: 11.5,
  },
  headFolderName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  closeBtn: {
    // Uses .close-btn from primitives.css — same as BgTasks
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '4px 10px 4px',
  },
  empty: { color: theme.faint, fontSize: 12.5, padding: '24px 8px', textAlign: 'center' },
  card: {
    background: theme.bg, borderRadius: "var(--radius-md)",
    padding: '8px 10px', marginBottom: 4,
    border: `1px solid ${theme.border}`,
  },
  cardHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  cardHeadLeft: {
    display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1,
  },
  cardHeadRight: {
    display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
  },
  filename: {
    fontSize: 13, fontWeight: 500,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    color: theme.text,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  diffContainer: {
    marginTop: 6,
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${theme.border}`,
    overflow: 'hidden',
    maxHeight: 300, overflowY: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: 11, lineHeight: 1.45,
  },
  hunkHeader: {
    padding: '4px 8px',
    fontSize: 10.5,
    fontWeight: 600,
    color: theme.dim,
    background: theme.card,
    borderBottom: `1px solid ${theme.border}`,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  },
  diffLine: {
    display: 'flex', alignItems: 'flex-start', gap: 0,
    padding: '0 4px 0 0',
    minHeight: 18,
  },
  lineNum: {
    width: 30, flexShrink: 0, textAlign: 'right',
    paddingRight: 6,
    fontSize: 10, fontWeight: 400,
    color: theme.dim,
    userSelect: 'none',
    opacity: 0.6,
  },
  diffMarker: {
    width: 12, flexShrink: 0, textAlign: 'center',
    fontWeight: 600, fontSize: 10,
    color: theme.dim,
    userSelect: 'none',
  },
  diffText: {
    flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    paddingLeft: 2,
  },
  actionBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 8px',
    fontSize: 11.5, fontWeight: 500,
    color: theme.textSoft,
    borderRadius: "var(--radius-sm)",
    fontFamily: 'inherit',
  },
  collapseBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 20, height: 20,
    color: theme.dim,
    borderRadius: "var(--radius-sm)",
  },
  bottomBar: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '6px 12px',
    borderTop: `1px solid ${theme.border}`,
    flexShrink: 0,
  },
  bottomAction: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 10px',
    fontSize: 12, fontWeight: 500,
    color: theme.textSoft,
    borderRadius: "var(--radius-sm)",
    fontFamily: 'inherit',
  },
};

// ── CommandPalette.tsx ───────────────────────────────────────────────────
export const commandPaletteStyles: Record<string, CSSProperties> = {
  wrap: {
    background: theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: "var(--radius-lg)",
    padding: 4,
    marginBottom: 8,
    maxHeight: 280,
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    width: '100%',
    border: 'none',
    borderRadius: "var(--radius-md)",
    padding: '8px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  cmd: {
    color: theme.accent,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    flexShrink: 0,
  },
  desc: {
    color: theme.dim,
    fontSize: 12.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};

// ── GitContext.tsx ───────────────────────────────────────────────────────
export const gitContextStyles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    fontSize: 11.5,
    color: theme.textSoft,
    background: theme.card,
    borderRadius: "var(--radius-lg)",
  },
  // Trigger + dropdown mirror the model selector (ModelRolesSelector) for a
  // consistent "selector" language across the app.
  folderBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    height: 26, padding: '0 8px',
    borderRadius: 'var(--radius-md)',
    color: theme.textSoft, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
  },
  folderName: {
    maxWidth: 140, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500,
  },
  folderDropdown: {
    position: 'absolute', bottom: '100%', left: 0,
    marginBottom: 6, background: theme.bg,
    border: `1px solid ${theme.border}`, borderRadius: 'var(--radius-lg)',
    padding: 6, minWidth: 200, zIndex: 100,
  },
  folderItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '6px 9px', borderRadius: 'var(--radius-sm)',
    cursor: 'pointer', fontSize: 12.5, textAlign: 'left', border: 'none',
  },
  folderItemName: {
    flex: 1, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  branch: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    color: theme.dim,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: 11,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginLeft: 'auto',
  },
  changes: {
    display: 'flex',
    gap: 6,
  },
  stat: {
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: 11,
    fontWeight: 500,
  },
};

// ── ModelRolesSelector.tsx ───────────────────────────────────────────────
export const modelRolesSelectorStyles: Record<string, CSSProperties> = {
  trigger: {
    display: 'flex', alignItems: 'center', gap: 6,
    height: 30, padding: '0 10px',
    borderRadius: "var(--radius-md)",
    color: theme.textSoft, cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit',
  },
  dots: { display: 'flex', gap: 3 },
  dot: { width: 7, height: 7, borderRadius: '50%' },
  triggerLabel: { fontWeight: 500 },
  panel: {
    position: 'absolute', bottom: '100%', right: 0, marginBottom: 8,
    width: 420, background: theme.bg, border: `1px solid ${theme.border}`,
    borderRadius: "var(--radius-lg)", padding: 10, zIndex: 100,
  },
  panelHead: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 4px 8px' },
  panelTitle: { fontSize: 13, fontWeight: 600, color: theme.text },
  panelHint: { fontSize: 11, color: theme.dim },
  roleCard: {
    border: `1px solid ${theme.border}`, borderRadius: "var(--radius-md)", overflow: 'hidden',
    background: theme.card, marginBottom: 6,
  },
  roleHead: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
    padding: '9px 10px', background: 'transparent', border: 'none',
    cursor: 'pointer', textAlign: 'left',
  },
  roleLabel: { fontSize: 12.5, fontWeight: 500, color: theme.text, flexShrink: 0 },
  newTag: {
    fontSize: 9, fontWeight: 600, color: theme.warn, background: `${theme.warn}22`,
    borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
  },
  roleRight: { flex: 1, display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end', minWidth: 0 },
  roleModel: {
    fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: theme.textSoft,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  unassigned: { fontSize: 11.5, color: theme.faint },
  tag: { fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, letterSpacing: '0.02em', flexShrink: 0 },
  providerDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  picker: { borderTop: `1px solid ${theme.border}`, padding: 6 },
  searchRow: { display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px 8px' },
  search: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: theme.text, fontSize: 12.5, fontFamily: 'inherit' },
  list: { maxHeight: 240, overflowY: 'auto' },
  groupHead: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 7px 3px' },
  groupCount: { fontSize: 10.5, color: theme.faint },
  item: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    width: '100%', border: 'none', borderRadius: "var(--radius-sm)", padding: '6px 9px',
    cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit', textAlign: 'left',
  },
  itemText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  empty: { padding: 12, color: theme.faint, fontSize: 12, textAlign: 'center' },
};

// ── ModeSelector.tsx ─────────────────────────────────────────────────────
export const modeSelectorStyles: Record<string, CSSProperties> = {
  trigger: {
    display: 'flex', alignItems: 'center', gap: 6,
    height: 30, padding: '0 10px',
    borderRadius: 'var(--radius-md)',
    color: theme.textSoft, cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit',
  },
  triggerLabel: { fontWeight: 500 },
  panel: {
    position: 'absolute', bottom: '100%', left: 0, marginBottom: 8,
    width: 420, background: theme.bg, border: `1px solid ${theme.border}`,
    borderRadius: 'var(--radius-lg)', padding: 10, zIndex: 100,
  },
  item: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    width: '100%', border: 'none',
    borderRadius: 'var(--radius-md)', padding: '10px 10px',
    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
  },
  itemIcon: { marginTop: 2, flexShrink: 0 },
  itemBody: { flex: 1, minWidth: 0 },
  itemLabelRow: { display: 'flex', alignItems: 'center', gap: 6 },
  itemLabel: { fontSize: 13, fontWeight: 600, color: theme.text },
  itemDesc: { fontSize: 11.5, color: theme.dim, lineHeight: 1.4, marginTop: 3 },
};

// ── NodeModal.tsx ────────────────────────────────────────────────────────
export const nodeModalStyles: Record<string, CSSProperties> = {
  head: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '12px 12px 0 16px', flexShrink: 0,
  },
  title: {
    minWidth: 0, color: theme.text, fontSize: 14, fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  kindChip: {
    flexShrink: 0, color: theme.dim, fontSize: 11, padding: '2px 8px',
    background: theme.bg, borderRadius: 20,
  },
  close: { flexShrink: 0 },
  meta: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    padding: '6px 16px 12px', flexShrink: 0,
  },
  path: { color: theme.textSoft, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, monospace', wordBreak: 'break-all' },
  size: { color: theme.dim, fontSize: 11.5, flexShrink: 0 },
  body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16 },
  codeWrap: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: 10 },
  mdWrap: {
    flex: 1,
    background: theme.bgDeep, border: `1px solid ${theme.border}`,
    borderRadius: "var(--radius-lg)", padding: '14px 18px',
    overflowY: 'auto', minHeight: 0,
  },
  hint: { color: theme.faint, fontSize: 12.5, padding: '24px 8px', textAlign: 'center' },
  summary: {
    background: theme.bg, borderRadius: 9, padding: 12, fontSize: 12.5,
    color: theme.textSoft, lineHeight: 1.55, border: `1px solid ${theme.border}`,
    overflowY: 'auto', maxHeight: 150,
  },
  summaryErr: { marginTop: 8, color: theme.error, fontSize: 12, lineHeight: 1.5 },
  tooLarge: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center', padding: 24 },
  tooLargeTitle: { fontSize: 14, fontWeight: 600, color: theme.text },
  tooLargeText: { fontSize: 12.5, color: theme.dim, maxWidth: 380, lineHeight: 1.55 },
};

// ── OpenInButton.tsx ─────────────────────────────────────────────────────
export const openInButtonStyles: Record<string, CSSProperties> = {
  wrap: { position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 },
  main: {
    display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px 0 10px',
    border: `1px solid ${theme.border}`, borderRight: 'none',
    borderRadius: '8px 0 0 8px', color: theme.text, cursor: 'pointer',
    fontSize: 12.5, fontFamily: 'inherit',
  },
  name: { maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  caret: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28, width: 24,
    border: `1px solid ${theme.border}`,
    borderRadius: '0 8px 8px 0', color: theme.dim, cursor: 'pointer',
  },
  menu: {
    position: 'absolute', top: 34, right: 0, minWidth: 180,
    background: theme.card, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)",
    padding: 6, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 100,
  },
  // menu items use .menu-item (buttons.css)
};

// ── QuestionCard.tsx ─────────────────────────────────────────────────────
const MONO = 'ui-monospace, SFMono-Regular, monospace';
export const questionCardStyles: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 0 },
  card: {
    background: theme.card, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)", padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 10,
    transition: 'opacity 0.12s, border-color 0.12s',
  },
  cardSkipped: { opacity: 0.55, borderStyle: 'dashed' },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' },
  title: { fontSize: 13, fontWeight: 600, color: theme.text },
  counter: { fontSize: 11.5, color: theme.dim, fontFamily: MONO },
  qHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  qHeadLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  qIndex: {
    width: 18, height: 18, borderRadius: '50%', background: theme.bgDeep,
    border: `1px solid ${theme.border}`, color: theme.dim, fontSize: 11, fontFamily: MONO,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  header: {
    fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5,
    color: theme.dim, fontFamily: MONO,
  },
  // skip toggle (.skip-btn) and options (.q-option) live in primitives.css
  question: { fontSize: 14, color: theme.text, lineHeight: 1.4 },
  questionSkipped: { textDecoration: 'line-through', color: theme.dim },
  options: { display: 'flex', flexDirection: 'column', gap: 4 },
  tick: {
    width: 16, height: 16, borderRadius: 5, border: `1px solid ${theme.dim}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  tickOn: { background: theme.accent, borderColor: theme.accent },
  optLabel: { flex: 1 },
  input: {
    background: theme.bgDeep, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-md)",
    padding: '7px 10px', fontSize: 13, color: theme.text, fontFamily: 'inherit', outline: 'none',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '2px 0' },
  pageLabel: { fontSize: 12, color: theme.dim, fontFamily: MONO, minWidth: 32, textAlign: 'center' },
};

// ── ScanOverlay.tsx ──────────────────────────────────────────────────────
export const scanOverlayStyles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0, zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(12,12,11,0.78)',
    backdropFilter: 'blur(2px)',
  },
  stack: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
  },
  label: {
    color: theme.dim,
    fontSize: 11.5,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    letterSpacing: 0.3,
  },
  cancelBtn: {
    marginTop: 16,
    padding: '8px 24px',
    fontSize: 11.5,
    fontFamily: 'inherit',
    background: theme.card,
    color: theme.textStrong,
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    cursor: 'pointer',
    opacity: 0.85,
    transition: 'opacity 0.15s',
    userSelect: 'none',
  },
  hint: {
    color: theme.faint,
    fontSize: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    letterSpacing: 0.3,
    marginTop: 2,
  },
};

// ── Sidebar.tsx ──────────────────────────────────────────────────────────
export const sidebarStyles: Record<string, CSSProperties> = {
  root: {
    width: 'calc(100% - 8px)', flexShrink: 0,
    margin: '8px 0 8px 8px', height: 'calc(100% - 16px)',
    background: theme.card, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)",
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  trafficGap: { height: 38, flexShrink: 0 },
  newBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', margin: '0 6px 8px 6px',
    borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
    color: theme.faint, border: 'none', fontFamily: 'inherit',
  },
  list: { flex: 1, overflowY: 'auto', padding: '0 6px 8px' },
  empty: { color: theme.faint, fontSize: 12, padding: '12px 10px' },
  row: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
    height: 34, borderRadius: 9, cursor: 'pointer', marginBottom: 1,
  },
  title: {
    flex: 1, fontSize: 13,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  // delete button uses .icon-btn-sm (buttons.css)
  footer: {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4,
    padding: '8px 8px',
  },
  workspaceBtn: {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7,
    height: 32, padding: '0 8px', background: 'transparent', border: 'none',
    borderRadius: "var(--radius-md)", color: theme.textSoft, cursor: 'pointer',
    fontSize: 12.5, fontFamily: 'inherit',
  },
  workspaceName: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  gearBtn: {
    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: "var(--radius-md)", cursor: 'pointer', flexShrink: 0,
  },
  wsHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', margin: '0 6px', borderRadius: 8, cursor: 'pointer',
  },
  wsName: {
    flex: 1, fontSize: 12.5,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  wsChevron: {
    flexShrink: 0, display: 'flex', alignItems: 'center', color: theme.faint,
  },
  wsCount: {
    marginLeft: 'auto', fontSize: 11, color: theme.faint,
  },
  sessionList: {
    flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0',
  },
  sessionRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 14px', margin: '0 6px', borderRadius: 8, cursor: 'pointer',
    fontSize: 12.5,
  },
  updateBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 10px', margin: '0 6px 4px 6px', height: 34,
    borderRadius: 9, cursor: 'pointer', transition: 'all 0.15s ease-in-out', userSelect: 'none',
  },
  updateLabel: {
    flex: 1, fontSize: 13, fontWeight: 400,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  updateDot: {
    width: 5, height: 5, borderRadius: '50%',
    background: theme.accent, boxShadow: `0 0 6px ${theme.accent}`,
  },
};

// ── SystemPromptModal.tsx ────────────────────────────────────────────────
export const systemPromptModalStyles: Record<string, CSSProperties> = {
  head: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '12px 12px 8px 16px', flexShrink: 0,
  },
  headLeft: { display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 },
  title: { fontSize: 14, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap', flexShrink: 0 },
  customTag: {
    fontSize: 10, fontWeight: 600, color: theme.accent, background: `${theme.accent}22`,
    borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
    flexShrink: 0,
  },
  meta: {
    fontSize: 11.5, color: theme.dim, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    whiteSpace: 'nowrap', flexShrink: 0,
  },
  headRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  close: {},
  body: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex' },
  loading: { color: theme.dim, fontSize: 13, textAlign: 'center', padding: 40 },
  err: { color: theme.error, fontSize: 12.5, fontFamily: 'ui-monospace, monospace' },
  mdWrap: {
    fontSize: 13.5, lineHeight: 1.7, color: theme.text,
  },
  textarea: {
    flex: 1, width: '100%', resize: 'none',
    background: 'transparent', border: 'none', outline: 'none',
    color: theme.text, fontSize: 12.5, lineHeight: 1.6,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    paddingBottom: 24,
  },
};

// ── Thinking.tsx ─────────────────────────────────────────────────────────
export const thinkingStyles: Record<string, CSSProperties> = {
  wrap: { marginBlock: 2 },
  header: {
    display: 'flex', alignItems: 'center', gap: 7,
    background: 'transparent', border: 'none', fontFamily: 'inherit', padding: '2px 0',
  },
  asterisk: { color: theme.accent, fontSize: 14, lineHeight: 1 },
  label: { color: theme.dim, fontSize: 13, fontStyle: 'italic' },
  dots: { color: theme.dim, fontSize: 13, fontStyle: 'italic', minWidth: 14 },
  body: {
    marginTop: 6, marginLeft: 6, paddingLeft: 12,
    borderLeft: `2px solid ${theme.cardActive}`,
  },
};

// ── Toasts.tsx ───────────────────────────────────────────────────────────
export const toastsStyles: Record<string, CSSProperties> = {
  wrap: {
    position: 'fixed', bottom: 16, right: 16, zIndex: 200,
    display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360,
  },
  toast: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    background: theme.card, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)",
    padding: '10px 12px',
  },
  body: { minWidth: 0, flex: 1 },
  title: { color: theme.text, fontSize: 12.5, fontWeight: 600 },
  cmd: {
    color: theme.dim, fontSize: 11.5, marginTop: 2,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  close: { flexShrink: 0, marginTop: -1 },
};

// ── Chat / Message / Composer ────────────────────────────────────────────
export const chatStyles: Record<string, CSSProperties> = {
  root: { width: '100%', flex: 1, display: 'flex', flexDirection: 'column', background: theme.bg, position: 'relative', minHeight: 0 },
  // No margin: rows live inside Virtuoso items, whose heights are measured by
  // ResizeObserver — margins are invisible to it. Spacing comes from padding.
  msgRow: { display: 'flex', padding: '3px 0' },
  userBubble: { background: theme.card, borderRadius: "var(--radius-lg)", padding: '7px 12px', color: theme.text, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  msgAttach: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: theme.bgDeep, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-md)", width: 'fit-content' },
  msgAttachThumb: { width: 26, height: 26, borderRadius: 5, objectFit: 'cover', display: 'block', flexShrink: 0 },
  msgAttachName: { fontSize: 12, color: theme.textSoft, fontFamily: 'ui-monospace, SFMono-Regular, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 },
  copyRow: { display: 'flex', alignItems: 'center', gap: 8, height: 22, marginTop: 3 },
  usage: { color: theme.dim, fontSize: 10.5, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
  copyBtn: { width: 24, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.card, border: 'none', borderRadius: 5, cursor: 'pointer', transition: 'opacity 0.1s, background-color 0.15s' },
  statusBanner: { display: 'flex', alignItems: 'center', gap: 14, color: theme.faint, fontSize: 12, fontStyle: 'italic', padding: '8px 0' },
  statusLine: { flex: 1, height: 1, background: theme.border },
  empty: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: theme.faint },
  emptyText: { fontSize: 17 },
  activity: { display: 'flex', alignItems: 'center', gap: 7 },
  star: { color: theme.accent, fontSize: 14, animation: 'pulse-star 1.4s ease-in-out infinite' },
  activityText: { color: theme.dim, fontSize: 13, fontStyle: 'italic' },
  composerWrap: { position: 'relative', display: 'flex', justifyContent: 'center', padding: '0 0 28px', background: theme.bg },
  composerFade: { position: 'absolute', left: 0, right: 0, top: -32, height: 32, pointerEvents: 'none', background: `linear-gradient(to bottom, transparent, ${theme.bg})` },
  card: { background: theme.card, borderRadius: 16, padding: '14px 16px' },
  textarea: { width: '100%', background: 'transparent', border: 'none', outline: 'none', color: theme.text, fontSize: 14, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 200 },
  attachRow: { display: 'flex', marginBottom: 8 },
  attachChip: { display: 'flex', alignItems: 'center', gap: 8, background: theme.bgDeep, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-md)", padding: '4px 8px 4px 4px' },
  attachThumb: { width: 32, height: 32, borderRadius: 5, objectFit: 'cover', display: 'block' },
  attachName: { fontSize: 11.5, color: theme.dim },
  // attach-remove + action icons use .icon-btn-sm / .icon-btn (buttons.css)
  actionRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 },
  sendBtn: { width: 30, height: 30, borderRadius: "var(--radius-md)", border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
};

// ── ContextWindow ────────────────────────────────────────────────────────
export const contextWindowStyles: Record<string, CSSProperties> = {
  root: { position: 'relative', display: 'flex', alignItems: 'center' },
  trigger: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', marginRight: -6, background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' },
  pct: { fontSize: 10, color: theme.dim, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
  popover: { position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, width: 280, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)", padding: 12, zIndex: 100 },
  popHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  popTitle: { color: theme.text, fontSize: 12.5, fontWeight: 600 },
  popTotal: { color: theme.dim, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
  stackBar: { display: 'flex', width: '100%', height: 6, borderRadius: 4, overflow: 'hidden', background: theme.border, marginBottom: 10 },
  legend: { display: 'flex', flexDirection: 'column', gap: 6 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 2, flexShrink: 0 },
  legendLabel: { flex: 1, color: theme.textSoft, fontSize: 12 },
  legendTokens: { color: theme.dim, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace', minWidth: 42, textAlign: 'right' },
  legendPct: { color: theme.dim, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace', minWidth: 42, textAlign: 'right' },
  summarizeBtn: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 12, padding: '8px 11px', border: `1px solid ${theme.border}`, borderRadius: "var(--radius-md)", color: theme.textSoft, fontSize: 12, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer', background: theme.bg },
  cmpText: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.3, minWidth: 0 },
  cmpBy: { color: theme.dim, fontSize: 10.5, fontWeight: 400, fontFamily: 'ui-monospace, SFMono-Regular, monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  flash: { marginTop: 7, fontSize: 11.5, textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
};

// ── Settings panels ──────────────────────────────────────────────────────
export const sectionStyles: Record<string, CSSProperties> = {
  title: { fontSize: 11, fontWeight: 600, color: theme.dim, letterSpacing: '0.06em', marginBottom: 10 },
};

export const toggleStyles: Record<string, CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', cursor: 'pointer', borderBottom: `1px solid ${theme.card}` },
  label: { fontSize: 13.5, color: theme.text },
  desc: { fontSize: 11.5, color: theme.faint, marginTop: 2 },
  switch: { width: 34, height: 18, borderRadius: 9, padding: 2, flexShrink: 0, transition: 'background 0.15s' },
  knob: { width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'transform 0.15s' },
};

export const fieldStyles: Record<string, CSSProperties> = {
  label: { fontSize: 13, color: theme.text },
  desc: { fontSize: 11, color: theme.faint, marginTop: 2 },
  status: { fontSize: 11.5, marginTop: 8, lineHeight: 1.4 },
  input: { flex: 1, background: theme.bgDeep, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-sm)", padding: '7px 10px', color: theme.text, fontSize: 12.5, outline: 'none', fontFamily: 'inherit' },
};

export const providerSettingsStyles: Record<string, CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 11px', marginBottom: 5,
    background: theme.card, borderRadius: 'var(--radius-md)',
  },
  rowName: { fontSize: 13, color: theme.text },
  rowUrl: {
    fontSize: 11, color: theme.dim, marginTop: 3,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  badge: { fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' },
  empty: { fontSize: 12, color: theme.faint, padding: '10px 2px' },
  form: {
    padding: 14, marginBottom: 5,
    background: theme.card, border: `1px solid ${theme.border}`,
    borderRadius: 'var(--radius-md)',
  },
  formRow: { display: 'flex', gap: 12 },
  formActions: {
    display: 'flex', alignItems: 'center', gap: 8, marginTop: 16,
    paddingTop: 12, borderTop: `1px solid ${theme.border}`,
  },
  // Native select chrome ignores our palette, so draw our own arrow.
  select: {
    appearance: 'none', WebkitAppearance: 'none',
    padding: '7px 26px 7px 10px', cursor: 'pointer',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238c8a82'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 9px center',
  },
};

export const settingsModalStyles: Record<string, CSSProperties> = {
  backdrop: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { display: 'flex', width: 'min(840px, 92vw)', height: 'min(640px, 86vh)', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden' },
  sidebar: { width: 176, background: theme.bgDeep, padding: '16px 8px 12px 14px', display: 'flex', flexDirection: 'column', gap: 2, borderRight: `1px solid ${theme.card}` },
  sidebarTitle: { fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 14, paddingLeft: 4 },
  // nav items use .menu-item (buttons.css)
  content: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    height: 48, padding: '0 12px 0 20px', flexShrink: 0,
    borderBottom: `1px solid ${theme.card}`,
  },
  headerTitle: { fontSize: 14, fontWeight: 600, color: theme.text },
  body: { flex: 1, overflowY: 'auto', padding: '18px 20px' },
};

// ThemeSelect uses .seg-track/.seg-btn (buttons.css).

// ── Usage / Ledger ───────────────────────────────────────────────────────
export const usageStyles: Record<string, CSSProperties> = {
  root: { flex: 1, overflowY: 'auto', padding: '0 24px 40px', position: 'relative' },
  inner: { maxWidth: 820, margin: '0 auto' },
  backdrop: { position: 'fixed', inset: 0, top: 52, zIndex: 49, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(1.5px)' },
  drawer: { position: 'fixed', top: 52, right: 0, bottom: 0, width: 360, zIndex: 50, background: theme.bg, borderLeft: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column' },
  drawerHead: { display: 'flex', alignItems: 'center', height: 44, padding: '0 10px 0 16px', flexShrink: 0, borderBottom: `1px solid ${theme.card}` },
  drawerTitle: { flex: 1, color: theme.text, fontSize: 13, fontWeight: 600 },
  drawerClose: {},
  drawerBody: { flex: 1, overflowY: 'auto', padding: '8px 16px 20px' },
  drawerDivider: { height: 1, background: theme.border, margin: '12px 0' },
  detailRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '7px 0' },
  detailLabel: { fontSize: 12, color: theme.dim, flexShrink: 0 },
  detailValue: { fontSize: 12.5, color: theme.text, textAlign: 'right', wordBreak: 'break-word' },
  rawBlock: { marginTop: 18 },
  rawHeader: { width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: theme.card, border: `1px solid ${theme.border}`, color: theme.textSoft, cursor: 'pointer', textAlign: 'left' },
  rawHeadLeft: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0 },
  rawHeadRight: { display: 'flex', alignItems: 'center', gap: 8 },
  rawLabel: { fontSize: 12, fontWeight: 600, color: theme.text },
  rawMeta: { fontSize: 11, color: theme.dim, fontFamily: 'ui-monospace, monospace' },
  rawCopy: { display: 'flex', alignItems: 'center', padding: 4, borderRadius: "var(--radius-sm)", border: 'none', background: 'transparent', color: theme.dim, cursor: 'pointer', transition: 'background 0.15s, color 0.15s' },
  rawPreHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 12px', background: theme.bg, borderLeft: `1px solid ${theme.border}`, borderRight: `1px solid ${theme.border}`, fontSize: 10.5, color: theme.faint, fontFamily: 'ui-monospace, monospace', textTransform: 'uppercase', letterSpacing: '0.04em' },
  rawPre: { margin: 0, border: `1px solid ${theme.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', background: theme.codeBg, padding: 0, overflow: 'auto', maxHeight: 320 },
  heading: { fontSize: 18, fontWeight: 600, color: theme.text, margin: 0 },
  headRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, margin: '28px 0 20px', flexWrap: 'wrap' },
  controls: { display: 'flex', alignItems: 'center', gap: 10 },
  // Range filter uses .seg-track/.seg-btn; Clear uses .btn; model filters use .chip.
  modelPills: { display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 20, paddingBottom: 4 },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.dim, fontSize: 13 },
  cards: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 },
  card: { flex: '1 1 140px', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: "var(--radius-lg)", padding: '14px 16px' },
  cardValue: { fontSize: 22, fontWeight: 700, color: theme.text, fontFamily: 'ui-monospace, monospace', marginBottom: 4 },
  cardLabel: { fontSize: 11.5, color: theme.dim },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 12, color: theme.dim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 },
  donutWrap: { display: 'flex', alignItems: 'center', gap: 28, marginTop: 28, flexWrap: 'wrap' },
  donutCenterNum: { fill: theme.text, fontSize: 17, fontWeight: 700, fontFamily: 'ui-monospace, monospace' },
  donutCenterLbl: { fill: theme.dim, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em' },
  legend: { display: 'flex', flexDirection: 'column', gap: 7, minWidth: 200, flex: 1 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 12 },
  legendDot: { width: 9, height: 9, borderRadius: 3, flexShrink: 0 },
  legendName: { flex: 1, color: theme.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  legendPct: { color: theme.dim, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, flexShrink: 0 },
  charts: { display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 24 },
  chart: {},
  chartLabel: { fontSize: 11.5, color: theme.dim, marginBottom: 8 },
  barRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 },
  barName: { width: 220, fontSize: 12, color: theme.textSoft, display: 'flex', alignItems: 'center', flexShrink: 0, overflow: 'hidden' },
  barTrack: { flex: 1, height: 6, background: theme.cardActive, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', background: theme.accent, borderRadius: 3, transition: 'width 0.4s ease' },
  barValue: { width: 70, fontSize: 11.5, color: theme.dim, fontFamily: 'ui-monospace, monospace', textAlign: 'right', flexShrink: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', color: theme.dim, fontWeight: 500, padding: '6px 10px', borderBottom: `1px solid ${theme.border}` },
  thNum: { textAlign: 'right', color: theme.dim, fontWeight: 500, padding: '6px 10px', borderBottom: `1px solid ${theme.border}` },
  pager: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 14 },
  pagerInfo: { fontSize: 11.5, color: theme.dim, fontFamily: 'ui-monospace, monospace', minWidth: 120, textAlign: 'center' },
  tr: {},
  td: { padding: '7px 10px', borderBottom: `1px solid ${theme.border}22`, color: theme.textSoft },
  tdNum: { padding: '7px 10px', borderBottom: `1px solid ${theme.border}22`, color: theme.textSoft, fontFamily: 'ui-monospace, monospace', textAlign: 'right' },
};
