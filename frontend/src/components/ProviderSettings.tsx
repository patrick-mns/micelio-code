import React, { useEffect, useState } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import Section from './Section';
import { fieldStyles } from '@/utils/theme-styles';

interface Status {
  type: 'ok' | 'err';
  text: string;
}

export default function ProviderSettings() {
  const { models, setModels } = useStore();
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ipc.getOpenrouterKey().then((k) => setKey(k)).catch(console.error);
  }, []);

  const save = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await ipc.checkOpenrouterKey(key);
      if (result.ok) {
        setStatus({ type: 'ok', text: `✓ Connected — ${result.count} models available` });
        const updated = await ipc.listModels();
        setModels(updated);
      } else {
        setStatus({ type: 'err', text: `✗ ${result.error}` });
      }
    } catch (e) {
      setStatus({ type: 'err', text: `✗ ${String(e)}` });
    } finally {
      setLoading(false);
    }
  };

  const orCount = models.filter((m) => m.provider === 'OpenRouter').length;

  return (
    <Section title="OPENROUTER">
      <div style={fieldStyles.label}>API key</div>
      <div style={fieldStyles.desc}>Unlocks Claude, GPT, DeepSeek, Gemini… in the model selector</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          type="password"
          value={key}
          onChange={(e) => { setKey(e.target.value); setStatus(null); }}
          placeholder="sk-or-…"
          style={fieldStyles.input}
        />
        <button onClick={save} disabled={loading} className="btn btn-md btn-solid">
          {loading ? 'Testing…' : 'Save'}
        </button>
      </div>
      {loading && <div style={fieldStyles.status}>Connecting to OpenRouter…</div>}
      {status && (
        <div style={{ ...fieldStyles.status, color: status.type === 'ok' ? theme.success : theme.error }}>
          {status.text}
        </div>
      )}
      {!loading && orCount > 0 && (
        <div style={{ ...fieldStyles.status, color: theme.textSoft }}>
          {orCount} OpenRouter model{orCount !== 1 ? 's' : ''} loaded
        </div>
      )}
    </Section>
  );
}