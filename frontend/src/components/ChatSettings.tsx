import React from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import Section from './Section';
import Toggle from './Toggle';

export default function ChatSettings() {
  const { prefs, setPref, settings, setSettings } = useStore();

  const toggleAutoSummary = (v: boolean) => {
    setSettings({ ...settings!, auto_summarize: v });
    ipc.setAutoSummarize(v).catch(console.error);
  };

  const toggleShowCost = (v: boolean) => {
    setSettings({ ...settings!, show_cost: v });
    ipc.setShowCost(v).catch(console.error);
  };

  return (
    <Section title="CHAT">
      <Toggle label="Stream responses" desc="Show tokens as they arrive" value={prefs.streamEnabled} onChange={(v) => setPref('streamEnabled', v)} />
      <Toggle label="Auto-compact context" desc="Summarize old messages near the window limit" value={prefs.autoCompact} onChange={(v) => setPref('autoCompact', v)} />
      <Toggle
        label="Auto-summarize edited files"
        desc="After each turn, summarize files the agent created or changed (uses the summarize model)"
        value={settings?.auto_summarize ?? true}
        onChange={toggleAutoSummary}
      />
      <Toggle
        label="Show cost & tokens"
        desc="Show token usage and price under each reply (when the provider reports it, e.g. OpenRouter)"
        value={settings?.show_cost ?? false}
        onChange={toggleShowCost}
      />
      <Toggle label="Show thinking" desc="Display the model's reasoning blocks" value={prefs.showThinking} onChange={(v) => setPref('showThinking', v)} />
      <Toggle label="Show tool results" desc="Display tool call output in the transcript" value={prefs.showTools} onChange={(v) => setPref('showTools', v)} />
    </Section>
  );
}