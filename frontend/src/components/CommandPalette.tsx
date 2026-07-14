import React from 'react';
import SuggestPalette from '@/components/SuggestPalette';
import type { SlashCommand } from '@/utils/chatHelpers';

interface CommandPaletteProps {
  commands: SlashCommand[];
  selected: number;
  onPick: (command: SlashCommand) => void;
}

// "/" command list — a thin wrapper over the generic SuggestPalette.
export default function CommandPalette({ commands, selected, onPick }: CommandPaletteProps) {
  return (
    <SuggestPalette
      items={commands}
      selected={selected}
      onPick={onPick}
      getKey={(c) => c.cmd}
      getLabel={(c) => c.cmd}
      getDesc={(c) => c.desc}
    />
  );
}
