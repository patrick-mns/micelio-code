import React from 'react';
import { useStore } from '@/store';
import { type ThemePref } from '@/theme';

const opts: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

export default function ThemeSelect() {
  const themePref = useStore((s) => s.themePref);
  const setThemePref = useStore((s) => s.setThemePref);

  return (
    <div className="seg-track">
      {opts.map((o) => {
        const on = themePref === o.id;
        return (
          <button
            key={o.id}
            className={on ? 'seg-btn is-active' : 'seg-btn'}
            onClick={() => setThemePref(o.id)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}