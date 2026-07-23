import React, { useEffect, useState, useCallback } from 'react';
import { ArrowsClockwise, CaretRight, CircleNotch, FloppyDisk, Plugs, PlugsConnected, SignIn, Warning } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { theme } from '@/theme';
import Section from './Section';
import CodeEditor from './CodeEditor';
import { fieldStyles } from '@/utils/theme-styles';
import type { McpServerStatus, McpToolInfo } from '@/types';

export default function McpSettings() {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [config, setConfig] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busyAction, setBusyAction] = useState<'save' | 'reload' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Server name currently mid-OAuth (waiting on the browser sign-in). */
  const [authorizing, setAuthorizing] = useState<string | null>(null);

  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const refreshLists = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([ipc.mcpListServers(), ipc.mcpListTools()]);
      setServers(s);
      setTools(t);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    ipc.mcpGetConfig().then(setConfig).catch((e) => setError(String(e)));
    refreshLists();
    // Startup connect happens off-thread in the backend; refresh when it lands.
    const unlisten = ipc.onMcpStatus((s) => {
      setServers(s);
      ipc.mcpListTools().then(setTools).catch(() => {});
    });
    return () => { unlisten.then((f) => f()); };
  }, [refreshLists]);

  const save = async () => {
    setBusy(true);
    setBusyAction('save');
    setError(null);
    setSaved(false);
    try {
      setServers(await ipc.mcpSaveConfig(config));
      setTools(await ipc.mcpListTools());
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const reload = async () => {
    setBusy(true);
    setBusyAction('reload');
    setError(null);
    try {
      setServers(await ipc.mcpReload());
      setTools(await ipc.mcpListTools());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const authorize = async (name: string) => {
    setAuthorizing(name);
    setError(null);
    try {
      // Blocks in the backend until the user finishes signing in in the browser.
      setServers(await ipc.mcpAuthorize(name));
      setTools(await ipc.mcpListTools());
    } catch (e) {
      setError(String(e));
    } finally {
      setAuthorizing(null);
    }
  };

  const toolsForServer = (name: string) => tools.filter((t) => t.server === name);
  const connectedCount = servers.filter((s) => s.connected).length;

  return (
    <>
      <Section title="MCP SERVERS">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ ...fieldStyles.desc, flex: 1 }}>
            Connect external MCP servers to expose their tools in chat. In Chat mode only
            read-only tools are offered.
          </div>
          <button onClick={reload} disabled={busy} className="btn btn-sm btn-ghost" title="Reconnect all servers">
            <ArrowsClockwise
              size={14}
              style={busyAction === 'reload' ? { animation: 'spin 0.8s linear infinite' } : undefined}
            />
            {busyAction === 'reload' ? 'Reloading…' : 'Reload'}
          </button>
        </div>

        {servers.length > 0 && (
          <div style={{ fontSize: 11.5, color: theme.dim, marginTop: 10 }}>
            {connectedCount} of {servers.length} connected · {tools.length} tool{tools.length !== 1 ? 's' : ''}
          </div>
        )}

        {servers.length === 0 && (
          <div
            style={{
              marginTop: 12,
              padding: '20px 16px',
              textAlign: 'center',
              border: `1px dashed ${theme.border}`,
              borderRadius: 'var(--radius-md)',
              color: theme.dim,
              fontSize: 12.5,
            }}
          >
            <Plugs size={22} weight="duotone" style={{ opacity: 0.7 }} />
            <div style={{ marginTop: 6 }}>No MCP servers yet — add one in the config below.</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {servers.map((s) => {
            const st = toolsForServer(s.name);
            const statusColor = s.connected ? theme.success : s.error ? theme.error : theme.dim;
            const StatusIcon = s.connected ? PlugsConnected : s.error ? Warning : Plugs;
            const isOpen = expanded.has(s.name);
            const canExpand = st.length > 0;
            return (
              <div
                key={s.name}
                style={{
                  border: `1px solid ${theme.border}`,
                  borderRadius: 'var(--radius-md)',
                  background: theme.card,
                  opacity: s.enabled ? 1 : 0.6,
                  overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => canExpand && toggleExpand(s.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    cursor: canExpand ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                >
                  <CaretRight
                    size={12}
                    weight="bold"
                    color={theme.dim}
                    style={{
                      flexShrink: 0,
                      opacity: canExpand ? 1 : 0,
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.12s ease',
                    }}
                  />
                  <StatusIcon size={16} weight="duotone" color={statusColor} style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: theme.text, fontSize: 13.5 }}>{s.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 0.4,
                      color: theme.dim,
                      textTransform: 'uppercase',
                      border: `1px solid ${theme.border}`,
                      borderRadius: 4,
                      padding: '1px 5px',
                    }}
                  >
                    {s.transport}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                    {s.needsAuth && (
                      <button
                        onClick={(e) => { e.stopPropagation(); authorize(s.name); }}
                        disabled={authorizing !== null}
                        className="btn btn-sm btn-solid"
                        title="Sign in to this server with OAuth"
                      >
                        {authorizing === s.name ? (
                          <>
                            <CircleNotch size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
                            Waiting for sign-in…
                          </>
                        ) : (
                          <>
                            <SignIn size={13} /> Authorize
                          </>
                        )}
                      </button>
                    )}
                    <span style={{ fontSize: 11.5, color: theme.dim }}>
                      {!s.enabled
                        ? 'disabled'
                        : s.connected
                          ? `${s.toolCount} tool${s.toolCount !== 1 ? 's' : ''}`
                          : s.needsAuth
                            ? 'sign-in required'
                            : s.error
                              ? 'error'
                              : 'connecting…'}
                    </span>
                  </span>
                </div>

                {s.error && (
                  <div style={{ padding: '0 12px 10px 32px' }}>
                    <div
                      title={s.errorDetail ?? s.error}
                      style={{
                        display: 'flex',
                        gap: 7,
                        alignItems: 'flex-start',
                        fontSize: 11.5,
                        color: s.needsAuth ? theme.dim : theme.error,
                        lineHeight: 1.45,
                        background: s.needsAuth
                          ? theme.cardActive
                          : 'color-mix(in srgb, var(--color-error) 9%, transparent)',
                        border: s.needsAuth
                          ? `1px solid ${theme.border}`
                          : `1px solid color-mix(in srgb, var(--color-error) 30%, transparent)`,
                        borderRadius: 'var(--radius-sm)',
                        padding: '7px 9px',
                      }}
                    >
                      {s.needsAuth
                        ? <SignIn size={13} weight="fill" style={{ flexShrink: 0, marginTop: 1 }} />
                        : <Warning size={13} weight="fill" style={{ flexShrink: 0, marginTop: 1 }} />}
                      <span>{s.error}</span>
                    </div>
                  </div>
                )}

                {canExpand && isOpen && (
                  <div style={{ borderTop: `1px solid ${theme.border}` }}>
                    {st.map((t) => (
                      <div
                        key={t.namespaced}
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 8,
                          padding: '7px 12px 7px 32px',
                          borderBottom: `1px solid ${theme.border}`,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontSize: 12,
                            color: theme.text,
                            flexShrink: 0,
                          }}
                        >
                          {t.name}
                        </span>
                        {t.readOnly && (
                          <span
                            title="read-only"
                            style={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                              color: theme.success,
                              border: `1px solid ${theme.success}`,
                              borderRadius: 4,
                              padding: '0 4px',
                              flexShrink: 0,
                              opacity: 0.85,
                            }}
                          >
                            read-only
                          </span>
                        )}
                        {t.description && (
                          <span
                            style={{
                              fontSize: 11.5,
                              color: theme.dim,
                              marginLeft: 'auto',
                              textAlign: 'right',
                              lineHeight: 1.4,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '55%',
                            }}
                            title={t.description}
                          >
                            {t.description}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="CONFIG (mcp.json)">
        <div style={fieldStyles.desc}>
          Stored at <code>~/.micelio/mcp.json</code>. A server has a <code>command</code> (stdio)
          or a <code>url</code> (HTTP). Set <code>"enabled": false</code> to keep an entry without
          connecting. For servers that need OAuth, add <code>"auth": {'{}'}</code> and click
          Authorize to sign in. If the provider rejects dynamic registration, add its issued{' '}
          <code>client_id</code> / <code>client_secret</code> inside <code>auth</code>.
        </div>

        <div style={{ marginTop: 10 }}>
          <CodeEditor value={config} onChange={(v) => { setConfig(v); setDirty(true); setSaved(false); setError(null); }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button onClick={save} disabled={busy || !dirty} className="btn btn-md btn-solid">
            {busyAction === 'save' ? (
              <>
                <CircleNotch size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                Connecting…
              </>
            ) : (
              <>
                <FloppyDisk size={14} /> Save &amp; connect
              </>
            )}
          </button>
          {saved && !dirty && busyAction !== 'save' && (
            <span style={{ fontSize: 11.5, color: theme.success }}>Saved ✓</span>
          )}
          {error && (
            <span style={{ fontSize: 11.5, color: theme.error, lineHeight: 1.4 }}>{error}</span>
          )}
        </div>
      </Section>
    </>
  );
}
