import { useState } from 'react';

export interface PlatformInfo {
  /** true on macOS (uses native traffic-light buttons) */
  isMac: boolean;
  /** true on Windows (draws custom title-bar buttons) */
  isWindows: boolean;
  /** true on Linux (draws custom title-bar buttons) */
  isLinux: boolean;
  /** true on any non-macOS platform — show custom window controls */
  showWindowControls: boolean;
}

function detectPlatform(): PlatformInfo {
  const p = typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '';
  const isMac = p.includes('mac');
  return {
    isMac,
    isWindows: p.includes('win'),
    isLinux: !isMac && p.includes('linux'),
    showWindowControls: !isMac,
  };
}

export function usePlatform(): PlatformInfo {
  const [info] = useState<PlatformInfo>(detectPlatform);
  return info;
}