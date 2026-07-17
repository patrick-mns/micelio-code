import React, { useEffect, useRef } from 'react';
import { commandPaletteStyles } from '@/utils/theme-styles';

interface SuggestPaletteProps<T> {
  items: T[];
  selected: number;
  onPick: (item: T) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getDesc?: (item: T) => string;
}

// Floating suggestion list shown above the composer — the generic base for
// trigger-char autocompletes (/commands, #skills, @files...). Purely
// presentational: the parent owns filtering, the selected index, and what
// picking an item does.
export default function SuggestPalette<T>({
  items,
  selected,
  onPick,
  getKey,
  getLabel,
  getDesc,
}: SuggestPaletteProps<T>) {
  const activeRef = useRef<HTMLButtonElement>(null);
  // Keep the keyboard-selected row visible: when arrowing past the visible
  // range, scroll just enough to bring it into view (no jump if already shown).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  if (items.length === 0) return null;
  return (
    <div style={commandPaletteStyles.wrap}>
      {items.map((item, i) => (
        <button
          key={getKey(item)}
          ref={i === selected ? activeRef : undefined}
          className={i === selected ? 'cmd-row is-active' : 'cmd-row'}
          onMouseDown={(e) => { e.preventDefault(); onPick(item); }}
          style={commandPaletteStyles.row}
        >
          <span style={commandPaletteStyles.cmd}>{getLabel(item)}</span>
          {getDesc && <span style={commandPaletteStyles.desc}>{getDesc(item)}</span>}
        </button>
      ))}
    </div>
  );
}
