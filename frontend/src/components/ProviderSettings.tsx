import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { Switch } from './Toggle';
import { fieldStyles, providerSettingsStyles as styles } from '@/utils/theme-styles';
import type { ProviderInfo, ProviderInput } from '@/types';

// Quick-fill for well-known gateways. All of them speak the same wire format —
// the preset only seeds the base URL, so an unlisted gateway still works.
const PRESETS: { label: string; base_url: string; flavor: 'openai' | 'openrouter' }[] = [
  { label: 'Generic OpenAI-compatible', base_url: '', flavor: 'openai' },
  { label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', flavor: 'openrouter' },
  { label: 'LiteLLM', base_url: 'https://litellm.example.com/v1', flavor: 'openai' },
  { label: 'vLLM', base_url: 'http://localhost:8000/v1', flavor: 'openai' },
  { label: 'llama.cpp', base_url: 'http://localhost:8080/v1', flavor: 'openai' },
  { label: 'LM Studio', base_url: 'http://localhost:1234/v1', flavor: 'openai' },
  { label: 'Groq', base_url: 'https://api.groq.com/openai/v1', flavor: 'openai' },
];

interface Status {
  type: 'ok' | 'err';
  text: string;
}

const emptyDraft = (): ProviderInput => ({ name: '', base_url: '', api_key: '', flavor: 'openai' });

// Add/edit form. `existing` set = editing, so the key field starts blank and an
// untouched key is left alone (the backend never sends the raw key back).
function EndpointForm({
  existing,
  onDone,
  onCancel,
}: {
  existing?: ProviderInfo;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProviderInput>(
    existing
      ? { id: existing.id, name: existing.name, base_url: existing.base_url, flavor: existing.flavor }
      : emptyDraft(),
  );
  const [keyTouched, setKeyTouched] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<ProviderInput>) => {
    setDraft((d) => ({ ...d, ...p }));
    setStatus(null);
  };

  // Only send api_key when the user actually typed one, so editing a name
  // doesn't wipe the stored key.
  const payload = (): ProviderInput => ({
    ...draft,
    api_key: keyTouched ? draft.api_key : undefined,
  });

  const test = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await ipc.testProvider(payload());
      setStatus(
        r.ok
          ? { type: 'ok', text: `Connected — ${r.count} model${r.count === 1 ? '' : 's'} found` }
          : { type: 'err', text: r.error },
      );
    } catch (e) {
      setStatus({ type: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await ipc.upsertProvider(payload());
      onDone();
    } catch (e) {
      setStatus({ type: 'err', text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (label: string) => {
    const p = PRESETS.find((x) => x.label === label);
    if (!p) return;
    patch({
      flavor: p.flavor,
      base_url: p.base_url || draft.base_url,
      name: draft.name || (p.base_url ? p.label : draft.name),
    });
  };

  return (
    <div style={styles.form}>
      <div style={styles.formRow}>
        <div style={{ flex: 1 }}>
          <div style={fieldStyles.label}>Name</div>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Groq"
            style={{ ...fieldStyles.input, marginTop: 6, width: '100%' }}
          />
        </div>
        {!existing && (
          <div style={{ flex: 1 }}>
            <div style={fieldStyles.label}>Preset</div>
            <select
              onChange={(e) => applyPreset(e.target.value)}
              style={{ ...fieldStyles.input, ...styles.select, marginTop: 6, width: '100%' }}
              defaultValue={PRESETS[0].label}
            >
              {PRESETS.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={fieldStyles.label}>Base URL</div>
        <input
          type="text"
          value={draft.base_url}
          onChange={(e) => patch({ base_url: e.target.value })}
          placeholder="https://api.groq.com/openai/v1"
          style={{ ...fieldStyles.input, marginTop: 6, width: '100%' }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={fieldStyles.label}>
          API key <span style={{ color: theme.faint, fontSize: 11 }}>optional</span>
        </div>
        <div style={fieldStyles.desc}>
          {existing?.has_key && !keyTouched
            ? `Saved (${existing.key_hint}) — type to replace, or clear the field to remove it`
            : 'Leave empty for endpoints that need no auth, like a local vLLM'}
        </div>
        <input
          type="password"
          value={keyTouched ? draft.api_key ?? '' : ''}
          onChange={(e) => { setKeyTouched(true); patch({ api_key: e.target.value }); }}
          placeholder={existing?.has_key ? '••••••••' : 'sk-…'}
          style={{ ...fieldStyles.input, marginTop: 6, width: '100%' }}
        />
      </div>

      <div style={styles.formActions}>
        <button onClick={test} disabled={busy || !draft.base_url.trim()} className="btn btn-md btn-outline">
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        {status && (
          <span style={{ ...fieldStyles.status, marginTop: 0, color: status.type === 'ok' ? theme.success : theme.error }}>
            {status.text}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={onCancel} className="btn btn-md btn-ghost">Cancel</button>
        <button
          onClick={save}
          disabled={busy || !draft.name.trim() || !draft.base_url.trim()}
          className="btn btn-md btn-solid"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// Model count, or a neutral placeholder while the catalog is still loading —
// "no models" next to a working endpoint would read as broken.
function CountBadge({ count, loading }: { count: number; loading: boolean }) {
  if (loading) {
    return <span style={{ ...styles.badge, color: theme.faint }}>checking…</span>;
  }
  return (
    <span style={{ ...styles.badge, color: count > 0 ? theme.success : theme.faint }}>
      {count > 0 ? `${count} model${count === 1 ? '' : 's'}` : 'no models'}
    </span>
  );
}

function EndpointRow({
  p,
  modelCount,
  countsLoading,
  onEdit,
  onToggle,
  onRemove,
}: {
  p: ProviderInfo;
  modelCount: number;
  countsLoading: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div style={styles.row}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.rowName}>{p.name}</div>
        <div style={styles.rowUrl} title={p.base_url}>{p.base_url}</div>
      </div>
      {p.enabled && <CountBadge count={modelCount} loading={countsLoading} />}
      <Switch
        value={p.enabled}
        onClick={() => onToggle(!p.enabled)}
        title={p.enabled ? 'Disable' : 'Enable'}
        style={{ cursor: 'pointer' }}
      />
      <button onClick={onEdit} className="btn btn-sm btn-ghost">Edit</button>
      <button onClick={onRemove} className="btn btn-sm btn-ghost" style={{ color: theme.error }}>
        Remove
      </button>
    </div>
  );
}

export default function ProviderSettings() {
  const { models, setModels } = useStore();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [editing, setEditing] = useState<ProviderInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [countsLoading, setCountsLoading] = useState(false);

  // Reading the endpoint list is a local file read — fast.
  const loadProviders = useCallback(async () => {
    try {
      setProviders(await ipc.listProviders());
    } catch (e) {
      console.error('failed to load providers', e);
    }
  }, []);

  // The catalog costs a network round trip per endpoint, so it's kept off the
  // list's critical path: rows render immediately and counts fill in after.
  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    try {
      setModels(await ipc.listModels());
    } catch (e) {
      console.error('failed to load models', e);
    } finally {
      setCountsLoading(false);
    }
  }, [setModels]);

  useEffect(() => {
    loadProviders();
    // Reuse the catalog the app already fetched (same as ModelRolesSelector) —
    // opening settings shouldn't re-probe every endpoint.
    if (useStore.getState().models.length === 0) loadCounts();
  }, [loadProviders, loadCounts]);

  const countFor = (id: string) => models.filter((m) => m.provider_id === id).length;

  const closeForm = () => { setEditing(null); setAdding(false); };

  // Editing an endpoint changes which models exist, so the catalog is stale.
  const afterChange = async () => {
    await loadProviders();
    await loadCounts();
  };
  const afterSave = async () => { closeForm(); await afterChange(); };

  const toggle = async (id: string, enabled: boolean) => {
    await ipc.setProviderEnabled(id, enabled).catch(console.error);
    await afterChange();
  };

  const remove = async (id: string) => {
    await ipc.removeProvider(id).catch(console.error);
    await afterChange();
  };

  const ollamaCount = countFor('ollama');

  return (
    <>
      <Section title="BUILT-IN">
        <div style={styles.row}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.rowName}>Ollama</div>
            <div style={styles.rowUrl}>Local models — no configuration needed</div>
          </div>
          {countsLoading ? (
            <span style={{ ...styles.badge, color: theme.faint }}>checking…</span>
          ) : (
            <span style={{ ...styles.badge, color: ollamaCount > 0 ? theme.success : theme.faint }}>
              {ollamaCount > 0 ? `${ollamaCount} model${ollamaCount === 1 ? '' : 's'}` : 'not running'}
            </span>
          )}
        </div>
      </Section>

      <Section title="OPENAI-COMPATIBLE ENDPOINTS">
        <div style={fieldStyles.desc}>
          Any gateway that speaks the OpenAI API — OpenRouter, LiteLLM, vLLM, llama.cpp, Groq…
        </div>

        <div style={{ marginTop: 10 }}>
          {providers.length === 0 && !adding && (
            <div style={styles.empty}>No endpoints yet</div>
          )}
          {providers.map((p) =>
            editing?.id === p.id ? (
              <EndpointForm key={p.id} existing={p} onDone={afterSave} onCancel={closeForm} />
            ) : (
              <EndpointRow
                key={p.id}
                p={p}
                modelCount={countFor(p.id)}
                countsLoading={countsLoading}
                onEdit={() => { setAdding(false); setEditing(p); }}
                onToggle={(enabled) => toggle(p.id, enabled)}
                onRemove={() => remove(p.id)}
              />
            ),
          )}
        </div>

        {adding ? (
          <EndpointForm onDone={afterSave} onCancel={closeForm} />
        ) : (
          <button
            onClick={() => { setEditing(null); setAdding(true); }}
            className="btn btn-md btn-ghost"
            style={{ marginTop: 6 }}
          >
            <Plus size={13} weight="bold" />
            Add endpoint
          </button>
        )}
      </Section>
    </>
  );
}
