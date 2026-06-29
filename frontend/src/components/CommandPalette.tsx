import React, { type CSSProperties } from 'react';
import { commandPaletteStyles } from '@/utils/theme-styles';
import type { SlashCommand } from '@/utils/chatHelpers';

interface CommandPaletteProps {
  commands: SlashCommand[];
  selected: number;
  onPick: (command: SlashCommand) => void;
}

// Floating command list shown above the composer while the input starts
// with "/". Purely presentational — the parent owns filtering, the selected
// index, and what each command does on run.
export default function CommandPalette({ commands, selected, onPick }: CommandPaletteProps) {
  if (commands.length === 0) return null;
  return (
    <div style={commandPaletteStyles.wrap}>
      {commands.map((c, i) => (
        <button
          key={c.cmd}
          className={i === selected ? 'cmd-row is-active' : 'cmd-row'}
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          style={commandPaletteStyles.row}
        >
          <span style={commandPaletteStyles.cmd}>{c.cmd}</span>
          <span style={commandPaletteStyles.desc}>{c.desc}</span>
        </button>
      ))}
    </div>
  );
}

