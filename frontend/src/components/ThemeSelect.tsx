import React from 'react';
import { useStore } from '@/store';
import { useI18n } from '@/i18n';
import { type ThemePref } from '@/theme';

const opts: ThemePref[] = ['system', 'dark', 'light'];

export default function ThemeSelect() {
  const { t } = useI18n();
  const themePref = useStore((s) => s.themePref);
  const setThemePref = useStore((s) => s.setThemePref);

  return (
    <div className="seg-track">
      {opts.map((id) => {
        const on = themePref === id;
        return (
          <button
            key={id}
            className={on ? 'seg-btn is-active' : 'seg-btn'}
            onClick={() => setThemePref(id)}
          >
            {t('theme.' + id)}
          </button>
        );
      })}
    </div>
  );
}