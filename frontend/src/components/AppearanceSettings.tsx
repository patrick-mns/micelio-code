import React from 'react';
import Section from './Section';
import ThemeSelect from './ThemeSelect';
import { useStore } from '@/store';
import { useI18n, type Locale } from '@/i18n';
import { toggleStyles } from '@/utils/theme-styles';

const LOCALE_OPTIONS: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
];

const ACCENT_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: 'default', label: 'Default (green)', color: '#3fb950' },
  { id: 'blue', label: 'Blue', color: '#58a6ff' },
  { id: 'purple', label: 'Purple', color: '#bc8cff' },
  { id: 'pink', label: 'Pink', color: '#f778ba' },
  { id: 'orange', label: 'Orange', color: '#f0883e' },
  { id: 'teal', label: 'Teal', color: '#56d4c9' },
];

const VARIANT_OPTIONS: { id: string; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'high-contrast', label: 'High Contrast' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
];

export default function AppearanceSettings() {
  const { t } = useI18n();
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const accentColor = useStore((s) => s.accentColor);
  const setAccentColor = useStore((s) => s.setAccentColor);
  const themeVariant = useStore((s) => s.themeVariant);
  const setThemeVariant = useStore((s) => s.setThemeVariant);

  return (
    <>
      {/* Theme selection */}
      <Section title={t('settings.theme')}>
        <div style={{ ...toggleStyles.row, borderBottom: 'none' }}>
          <div style={{ flex: 1 }}>
            <div style={toggleStyles.label}>{t('settings.themeLabel')}</div>
            <div style={toggleStyles.desc}>{t('settings.themeDesc')}</div>
          </div>
          <ThemeSelect />
        </div>
      </Section>

      {/* Language selection */}
      <Section title={t('settings.language')}>
        <div style={{ ...toggleStyles.row, borderBottom: 'none' }}>
          <div style={{ flex: 1 }}>
            <div style={toggleStyles.label}>{t('settings.languageLabel')}</div>
            <div style={toggleStyles.desc}>{t('settings.languageDesc')}</div>
          </div>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            style={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 24px 5px 10px',
              fontSize: 11.5,
              fontWeight: 500,
              color: 'var(--color-text)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              outline: 'none',
              appearance: 'none',
              WebkitAppearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238c8a82'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
            }}
          >
            {LOCALE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {/* Accent color selection */}
      <Section title={t('settings.accent')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {ACCENT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setAccentColor(opt.id as any)}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: accentColor === opt.id ? '2px solid var(--color-text)' : '2px solid transparent',
                background: opt.color,
                cursor: 'pointer',
                transition: 'transform 0.1s, border-color 0.1s',
                transform: accentColor === opt.id ? 'scale(1.15)' : 'scale(1)',
              }}
              title={opt.label}
              aria-label={opt.label}
            />
          ))}
        </div>
      </Section>

      {/* Theme variant */}
      <Section title={t('settings.themeVariant')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {VARIANT_OPTIONS.map((opt) => {
            const on = themeVariant === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setThemeVariant(opt.id as any)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid var(--color-border)`,
                  background: on ? 'var(--color-accent)' : 'transparent',
                  color: on ? '#fff' : 'var(--color-text-soft)',
                  fontSize: 11.5,
                  fontWeight: on ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 0.1s, color 0.1s',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}
