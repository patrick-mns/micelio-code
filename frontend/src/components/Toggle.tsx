import React from 'react';
import { theme } from '@/theme';
import { toggleStyles } from '@/utils/theme-styles';

interface ToggleProps {
  label: string;
  desc: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

/** The switch on its own, for rows that aren't a label/desc pair. */
export function Switch({ value, ...rest }: { value: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        ...toggleStyles.switch,
        background: value ? theme.accent : theme.cardActive,
        ...rest.style,
      }}
    >
      <div style={{ ...toggleStyles.knob, transform: value ? 'translateX(16px)' : 'translateX(0)' }} />
    </div>
  );
}

export default function Toggle({ label, desc, value, onChange }: ToggleProps) {
  return (
    <div style={toggleStyles.row} onClick={() => onChange(!value)}>
      <div style={{ flex: 1 }}>
        <div style={toggleStyles.label}>{label}</div>
        <div style={toggleStyles.desc}>{desc}</div>
      </div>
      <Switch value={value} />
    </div>
  );
}
