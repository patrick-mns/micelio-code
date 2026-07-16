import React from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import Section from './Section';
import Toggle from './Toggle';
import { theme } from '@/theme';
import { Cube, WarningCircle } from '@phosphor-icons/react';

// Sandbox controls for agent terminal commands. When no backend exists on
// this machine (Windows, missing bubblewrap) the toggles are hidden and the
// status line explains why — the terminal tool then runs commands unwrapped.
export default function SandboxSettings() {
  const { settings, setSettings } = useStore();
  if (!settings) return null;
  const available = settings.sandbox_available;

  const toggleEnabled = (v: boolean) => {
    setSettings({ ...settings, sandbox_enabled: v });
    ipc.setSandboxEnabled(v).catch(console.error);
  };
  const toggleNetwork = (v: boolean) => {
    setSettings({ ...settings, sandbox_network: v });
    ipc.setSandboxNetwork(v).catch(console.error);
  };

  return (
    <Section title="SANDBOX">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.dim }}>
        {available ? (
          <Cube size={14} color={theme.accent} />
        ) : (
          <WarningCircle size={14} color={theme.warn} />
        )}
        {available
          ? `Backend: ${settings.sandbox_backend}`
          : `Unavailable on this machine: ${settings.sandbox_backend}`}
      </div>
      {available && (
        <>
          <Toggle
            label="Sandbox terminal commands"
            desc="Agent commands run with writes limited to the workspace (plus temp and caches). Leaving the sandbox always asks for your approval."
            value={settings.sandbox_enabled}
            onChange={toggleEnabled}
          />
          {settings.sandbox_enabled && (
            <Toggle
              label="Allow network access"
              desc="Let sandboxed commands reach the network (npm install, git fetch…). Turn off to block all network from agent commands."
              value={settings.sandbox_network}
              onChange={toggleNetwork}
            />
          )}
        </>
      )}
    </Section>
  );
}
