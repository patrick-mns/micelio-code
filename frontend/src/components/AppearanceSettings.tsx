import React from 'react';
import Section from './Section';
import ThemeSelect from './ThemeSelect';
import { toggleStyles } from '@/utils/theme-styles';

export default function AppearanceSettings() {
  return (
    <Section title="THEME">
      <div style={{ ...toggleStyles.row, borderBottom: 'none' }}>
        <div style={{ flex: 1 }}>
          <div style={toggleStyles.label}>Theme</div>
          <div style={toggleStyles.desc}>Follow the system, or force dark / light</div>
        </div>
        <ThemeSelect />
      </div>
    </Section>
  );
}
