import React, { type ReactNode } from 'react';
import { sectionStyles } from '@/utils/theme-styles';

interface SectionProps {
  title: string;
  children: ReactNode;
}

export default function Section({ title, children }: SectionProps) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={sectionStyles.title}>{title}</div>
      {children}
    </div>
  );
}
