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

function ProviderKeyField({
  title,
  desc,
  placeholder,
  getKey,
  checkKey,
  providerName,
  models,
  onModelsUpdated,
}: {
  title: string;
  desc: string;
  placeholder: string;
  getKey: () => Promise<string>;
  checkKey: (key: string) => Promise<{ ok: boolean; count: number; error: string }>;
  providerName: string;
  models: { provider: string }[];
  onModelsUpdated: (m: any[]) => void;
}) {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getKey().then((k) => setKey(k)).catch(console.error);
  }, [getKey]);

  const save = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await checkKey(key);
      if (result.ok) {
        setStatus({ type: 'ok', text: `✓ Connected — ${result.count} models available` });
        const updated = await ipc.listModels();
        onModelsUpdated(updated);
      } else {
        setStatus({ type: 'err', text: `✗ ${result.error}` });
      }
    } catch (e) {
      setStatus({ type: 'err', text: `✗ ${String(e)}` });
    } finally {
      setLoading(false);
    }
  };

  const count = models.filter((m) => m.provider === providerName).length;

  return (
    <>
      <div style={fieldStyles.label}>API key</div>
      <div style={fieldStyles.desc}>{desc}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          type="password"
          value={key}
          onChange={(e) => { setKey(e.target.value); setStatus(null); }}
          placeholder={placeholder}
          style={fieldStyles.input}
        />
        <button onClick={save} disabled={loading} className="btn btn-md btn-solid">
          {loading ? 'Testing…' : 'Save'}
        </button>
      </div>
      {loading && <div style={fieldStyles.status}>Connecting to {title}…</div>}
      {status && (
        <div style={{ ...fieldStyles.status, color: status.type === 'ok' ? theme.success : theme.error }}>
          {status.text}
        </div>
      )}
      {!loading && count > 0 && (
        <div style={{ ...fieldStyles.status, color: theme.textSoft }}>
          {count} {providerName} model{count !== 1 ? 's' : ''} loaded
        </div>
      )}
    </>
  );
}

export default function ProviderSettings() {
  const { models, setModels } = useStore();
  const [litellmUrl, setLitellmUrl] = useState('');
  const [urlStatus, setUrlStatus] = useState<Status | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);

  useEffect(() => {
    ipc.getLitellmBaseUrl().then(setLitellmUrl).catch(console.error);
  }, []);

  const saveLitellmUrl = async () => {
    setUrlLoading(true);
    setUrlStatus(null);
    try {
      await ipc.saveLitellmBaseUrl(litellmUrl);
      // Re-check to validate
      const key = await ipc.getLitellmKey();
      if (key) {
        const result = await ipc.checkLitellmKey(key);
        if (result.ok) {
          setUrlStatus({ type: 'ok', text: `✓ URL saved — ${result.count} models` });
          const updated = await ipc.listModels();
          setModels(updated);
        } else {
          setUrlStatus({ type: 'err', text: `✗ ${result.error}` });
        }
      } else {
        setUrlStatus({ type: 'ok', text: '✓ URL saved' });
      }
    } catch (e) {
      setUrlStatus({ type: 'err', text: `✗ ${String(e)}` });
    } finally {
      setUrlLoading(false);
    }
  };

  return (
    <>
      <Section title="OPENROUTER">
        <ProviderKeyField
          title="OpenRouter"
          desc="Unlocks Claude, GPT, DeepSeek, Gemini… in the model selector"
          placeholder="sk-or-…"
          getKey={() => ipc.getOpenrouterKey()}
          checkKey={(k) => ipc.checkOpenrouterKey(k)}
          providerName="OpenRouter"
          models={models}
          onModelsUpdated={setModels}
        />
      </Section>

      <Section title="LITELLM">
        <ProviderKeyField
          title="LiteLLM"
          desc="Any OpenAI-compatible API (LiteLLM proxy, custom endpoint, etc.)"
          placeholder="sk-…"
          getKey={() => ipc.getLitellmKey()}
          checkKey={(k) => ipc.checkLitellmKey(k)}
          providerName="LiteLLM"
          models={models}
          onModelsUpdated={setModels}
        />

        <div style={{ marginTop: 16 }}>
          <div style={fieldStyles.label}>Base URL</div>
          <div style={fieldStyles.desc}>The API endpoint (e.g. https://litellm.example.com/v1)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={litellmUrl}
              onChange={(e) => { setLitellmUrl(e.target.value); setUrlStatus(null); }}
              placeholder="https://litellm.example.com/v1"
              style={fieldStyles.input}
            />
            <button onClick={saveLitellmUrl} disabled={urlLoading} className="btn btn-md btn-solid">
              {urlLoading ? 'Saving…' : 'Save'}
            </button>
          </div>
          {urlLoading && <div style={fieldStyles.status}>Testing with new URL…</div>}
          {urlStatus && (
            <div style={{ ...fieldStyles.status, color: urlStatus.type === 'ok' ? theme.success : theme.error }}>
              {urlStatus.text}
            </div>
          )}
        </div>
      </Section>
    </>
  );
}