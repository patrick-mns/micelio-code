import React from 'react';
import { Cube } from '@phosphor-icons/react';
import { useStore } from '@/store';

// Composer shield: shows at a glance whether agent terminal commands are
// sandboxed. It's a global state (not a per-turn choice like the mode), so a
// click just jumps to the setting. Hidden entirely when this machine has no
// sandbox backend — an indicator for a capability that can't exist is noise.
export default function SandboxIndicator() {
  const { settings, setShowSettings, setSettingsCategory } = useStore();
  if (!settings?.sandbox_available) return null;
  const on = settings.sandbox_enabled;

  return (
    <button
      className="icon-btn"
      onClick={() => {
        setSettingsCategory('advanced');
        setShowSettings(true);
      }}
      title={
        on
          ? `Terminal sandboxed (${settings.sandbox_backend}) — writes limited to the workspace`
          : 'Terminal sandbox is off — commands run with full access'
      }
    >
      <Cube size={16} weight={on ? 'fill' : 'regular'} color={on ? '#8b5cf6' : undefined} />
    </button>
  );
}
