import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { modelRolesSelectorStyles } from '@/utils/theme-styles';
import { ChatCircle, FileText, Eye, MagnifyingGlass, Check, CaretRight, CaretDown, CaretUpDown, type Icon } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import type { ModelOption, ModelRole } from '@/types';

interface RoleMeta {
  label: string;
  Icon: Icon;
  visionOnly?: boolean;
  isNew?: boolean;
}

// Stable per-provider tag palette, theme-aware (mirrors ModelSelector).
const TAG_COLORS = [
  { dark: { bg: '#1a3a3a', fg: '#5fc9c9' }, light: { bg: '#cde9e9', fg: '#0a4a4a' } },
  { dark: { bg: '#3a1a3a', fg: '#c97fc9' }, light: { bg: '#e9cde9', fg: '#4a0a4a' } },
  { dark: { bg: '#2a2a1a', fg: '#c9c95f' }, light: { bg: '#e9e9cd', fg: '#4a4a0a' } },
  { dark: { bg: '#1a2a3a', fg: '#5f9fc9' }, light: { bg: '#cddef9', fg: '#0a2a4a' } },
  { dark: { bg: '#3a2a1a', fg: '#c99f5f' }, light: { bg: '#e9dfd5', fg: '#4a2a0a' } },
  { dark: { bg: '#2a1a2a', fg: '#c97f9f' }, light: { bg: '#e9cddf', fg: '#4a0a2a' } },
];
function tagStyle(i: number): CSSProperties {
  const isDark = document.documentElement.dataset.theme !== 'light';
  const c = TAG_COLORS[((i % TAG_COLORS.length) + TAG_COLORS.length) % TAG_COLORS.length];
  const p = isDark ? c.dark : c.light;
  return { background: p.bg, color: p.fg };
}

// Vivid, theme-independent dot colors per provider. The tag `fg` is tuned for
// text contrast (near-black in light mode) and reads as a muddy dot, so dots
// get their own saturated mid-tones that pop on both cream and dark surfaces.
const DOT_COLORS = ['#14b8a6', '#a855f7', '#eab308', '#3b82f6', '#f97316', '#ec4899'];
function dotColor(i: number): string {
  return DOT_COLORS[((i % DOT_COLORS.length) + DOT_COLORS.length) % DOT_COLORS.length];
}

// Role definitions. `visionOnly` filters the model list to image-capable
// models. `isNew` flags a not-yet-shipped role for a subtle badge.
const ROLE_META: Record<string, RoleMeta> = {
  chat:      { label: 'Chat',      Icon: ChatCircle },
  summarize: { label: 'Summarize', Icon: FileText },
  vision:    { label: 'Vision',    Icon: Eye, visionOnly: true },
};

const short = (name: string): string => (name || '').replace(/:latest$/, '');

// Single composer entry point ("Models") that opens a panel assigning a model
// to each role (Chat / Summarize / Vision). The models shown & changed are
// **per-session**: each chat remembers its own models. New chats inherit the
// global defaults until you change them.
export default function ModelRolesSelector() {
  const {
    models, setModels, setChatModel, setSummarizeModel,
    currentSession, sessionModels, setSessionModels,
    isLoading,
  } = useStore();
  const [roles, setRoles] = useState<ModelRole[]>([]);
  const [open, setOpen] = useState(false);
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement | null>(null);

  // Load models for the current session (or globals if no session / no pin).
  const loadRoles = useCallback(async () => {
    const [globalRoles, fetchedModels] = await Promise.all([
      ipc.getModelRoles(),
      models.length === 0 ? ipc.listModels() : Promise.resolve(null),
    ]);
    const allModels = fetchedModels ?? models;
    if (fetchedModels) setModels(fetchedModels);

    if (!currentSession) { setRoles(globalRoles); return; }

    // Use per-session values when available, otherwise keep global default.
    const pinned = sessionModels[currentSession];
    setRoles(
      globalRoles.map((r) => {
        const sessionVal = pinned?.[r.role as keyof typeof pinned];
        if (!sessionVal) return r;
        const provider = allModels.find((m) => m.name === sessionVal)?.provider || '';
        return { ...r, model: sessionVal, provider };
      }),
    );
  }, [currentSession, sessionModels, models, setModels]);

  // Load roles on mount and whenever the session changes.
  useEffect(() => { loadRoles(); }, [loadRoles]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setOpenRole(null); } };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Provider → stable color index (first-appearance order in the catalog).
  const providerIdx = useMemo(() => {
    const map: Record<string, number> = {};
    let n = 0;
    for (const m of models) if (!(m.provider in map)) map[m.provider] = n++;
    return map;
  }, [models]);

  const pick = (role: string, name: string) => {
    const provider = models.find((m) => m.name === name)?.provider || '';
    setRoles((rs) => rs.map((r) => (r.role === role ? { ...r, model: name, provider } : r)));
    setOpenRole(null);
    setFilter('');

    // Always persist to the current session (updates global if session not set)
    ipc.setSessionModel(currentSession || '', role, name).catch(console.error);
    if (currentSession) {
      setSessionModels(currentSession, {
        ...(sessionModels[currentSession] ?? { chat: '', summarize: '', vision: '' }),
        [role]: name,
      });
    }
    // Also update global store so the rest of the app uses this model
    if (role === 'chat') setChatModel(name);
    if (role === 'summarize') setSummarizeModel(name);
  };

  // Models for the currently-expanded role, filtered + grouped by provider.
  const groups = useMemo(() => {
    const meta = openRole ? ROLE_META[openRole] : undefined;
    const order: string[] = [];
    const map: Record<string, ModelOption[]> = {};
    for (const m of models) {
      if (meta?.visionOnly && !m.vision) continue;
      if (!m.name.toLowerCase().includes(filter.toLowerCase())) continue;
      if (!(m.provider in map)) { map[m.provider] = []; order.push(m.provider); }
      map[m.provider].push(m);
    }
    return order.map((p) => ({ provider: p, items: map[p] }));
  }, [models, openRole, filter]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-ghost" style={modelRolesSelectorStyles.trigger} onClick={() => setOpen((o) => !o)} disabled={isLoading} title={isLoading ? 'Wait for the current turn to finish' : 'Model assignments'}>
        <span style={modelRolesSelectorStyles.dots}>
          {roles.map((r) => (
            <span
              key={r.role}
              style={{ ...modelRolesSelectorStyles.dot, background: r.model ? dotColor(providerIdx[r.provider] ?? 0) : theme.faint }}
              title={`${r.role}${r.provider ? ` · ${r.provider}` : ''}`}
            >
            </span>
          ))}
        </span>
        <span style={modelRolesSelectorStyles.triggerLabel}>Models</span>
        <CaretUpDown size={12} color={theme.dim} />
      </button>

      {open && (
        <div style={modelRolesSelectorStyles.panel}>
          <div style={modelRolesSelectorStyles.panelHead}>
            <span style={modelRolesSelectorStyles.panelTitle}>Models</span>
            <span style={modelRolesSelectorStyles.panelHint}>per-role assignment</span>
          </div>

          {roles.map((r) => {
            const meta = ROLE_META[r.role] || { label: r.role, Icon: ChatCircle };
            const expanded = openRole === r.role;
            const Icon = meta.Icon;
            return (
              <div key={r.role} style={modelRolesSelectorStyles.roleCard}>
                <button
                  className="role-head"
                  style={modelRolesSelectorStyles.roleHead}
                  onClick={() => { setOpenRole(expanded ? null : r.role); setFilter(''); }}
                >
                  <Icon size={15} color={theme.dim} />
                  <span style={modelRolesSelectorStyles.roleLabel}>{meta.label}</span>
                  {meta.isNew && <span style={modelRolesSelectorStyles.newTag}>new</span>}
                  <span style={modelRolesSelectorStyles.roleRight}>
                    {r.model ? (
                      <>
                        <span
                          style={{ ...modelRolesSelectorStyles.providerDot, background: dotColor(providerIdx[r.provider] ?? 0) }}
                          title={r.provider}
                        />
                        <span style={modelRolesSelectorStyles.roleModel}>{short(r.model)}</span>
                      </>
                    ) : (
                      <span style={modelRolesSelectorStyles.unassigned}>Assign model</span>
                    )}
                  </span>
                  <CaretRight
                    size={12} weight="bold"
                    style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: theme.faint, flexShrink: 0 }}
                  />
                </button>

                {expanded && (
                  <div style={modelRolesSelectorStyles.picker}>
                    <div style={modelRolesSelectorStyles.searchRow}>
                      <MagnifyingGlass size={13} color={theme.faint} />
                      <input
                        autoFocus value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Search models…" style={modelRolesSelectorStyles.search}
                      />
                    </div>
                    <div style={modelRolesSelectorStyles.list}>
                      {groups.length === 0 ? (
                        <div style={modelRolesSelectorStyles.empty}>No models found</div>
                      ) : groups.map((g) => (
                        <div key={g.provider}>
                          <div style={modelRolesSelectorStyles.groupHead}>
                            <button
                              onClick={() => setCollapsed((c) => ({ ...c, [g.provider]: !c[g.provider] }))}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer', padding: 0, margin: 0,
                                display: 'flex', alignItems: 'center', color: theme.faint, fontSize: 10,
                                transform: collapsed[g.provider] ? 'rotate(-90deg)' : 'rotate(0deg)',
                                transition: 'transform .15s',
                              }}
                              title={collapsed[g.provider] ? 'Expand' : 'Collapse'}
                            >
                              <CaretDown size={11} weight="bold" />
                            </button>
                            <span style={{ ...modelRolesSelectorStyles.tag, ...tagStyle(providerIdx[g.provider] ?? 0) }}>{g.provider}</span>
                            <span style={modelRolesSelectorStyles.groupCount}>{g.items.length}</span>
                          </div>
                          {!collapsed[g.provider] && g.items.map((m) => {
                            const sel = m.name === r.model;
                            return (
                              <button
                                key={m.name}
                                className={sel ? 'role-item is-active' : 'role-item'}
                                onClick={() => pick(r.role, m.name)}
                                style={modelRolesSelectorStyles.item}
                              >
                                <span style={modelRolesSelectorStyles.itemText}>{short(m.name)}</span>
                                {sel && <Check size={13} color={theme.accent} />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

