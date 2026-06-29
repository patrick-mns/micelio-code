import React from 'react';
import { PROVIDER_COLORS } from '@/utils/usageHelpers';

interface ProviderBadgeProps {
  provider: string;
}

export default function ProviderBadge({ provider }: ProviderBadgeProps) {
  const color = PROVIDER_COLORS[provider] ?? PROVIDER_COLORS.unknown;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, background: color + '22', borderRadius: 4, padding: '1px 5px', marginLeft: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {provider}
    </span>
  );
}
