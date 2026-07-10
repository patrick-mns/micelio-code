import React, { useEffect, useState } from 'react';
import { X, GithubLogo } from '@phosphor-icons/react';
import { theme } from '@/theme';
import { useI18n } from '@/i18n';
import { ipc } from '@/ipc';
import Modal from '@/components/Modal';

interface AboutModalProps {
  onClose: () => void;
}

// Small "About" modal — project info, creator credit and a link to the repo.
// Shown automatically on first launch, then dismissible via the header button.
const GITHUB = 'https://github.com/patrick-mns';
const REPO = 'https://github.com/patrick-mns/micelio-code';

// ── ASCII treemap animation frames ────────────────────────────────────
// Each frame is a squarified treemap that subtly changes partition.
// All frames are exactly 20 chars wide to prevent layout jitter.
const FRAMES = [
  [
    '  ┌──────┬────────┐',
    '  │ A    │ B      │',
    '  │      ├──┬─────┤',
    '  │      │C │  D  │',
    '  └──────┴──┴─────┘',
  ],
  [
    '  ┌──┬───┬────────┐',
    '  │A │ C │  D     │',
    '  ├──┤   ├────────┤',
    '  │B │   │  E     │',
    '  └──┴───┴────────┘',
  ],
  [
    '  ┌────┬──┬───────┐',
    '  │ A  │D │  E    │',
    '  ├──┬─┤  ├──┬────┤',
    '  │B │C│  │F │ G  │',
    '  └──┴─┴──┴──┴────┘',
  ],
  [
    '  ┌──┬──┬──┬──────┐',
    '  │A │B │C │  D   │',
    '  ├──┼──┼──┼──────┤',
    '  │E │F │G │  H   │',
    '  └──┴──┴──┴──────┘',
  ],
];

export default function AboutModal({ onClose }: AboutModalProps) {
  const { t } = useI18n();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((p) => (p + 1) % FRAMES.length), 280);
    return () => clearInterval(id);
  }, []);

  return (
    <Modal
      onClose={onClose}
      cardStyle={{
        width: 'min(440px, 88vw)',
        height: 'auto',
      }}
    >
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: theme.text }}>{t('about.title')}</span>
          <button className="close-btn" onClick={onClose} title={t('about.close')}>
            <X size={15} />
          </button>
        </div>

        {/* ASCII animation */}
        <pre
          style={{
            margin: 0,
            padding: '8px 12px',
            background: theme.bgDeep,
            border: `1px solid ${theme.border}`,
            borderRadius: 'var(--radius-md)',
            fontSize: 11.5,
            lineHeight: 1.3,
            color: theme.accent,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            overflow: 'hidden',
            textAlign: 'center',
          }}
        >
          {FRAMES[frame].join('\n')}
        </pre>

        {/* Experimental tag — code-style badge */}
        <div
          style={{
            alignSelf: 'center',
            padding: '3px 10px',
            borderRadius: 'var(--radius-sm)',
            background: theme.warn + '12',
            border: `1px solid ${theme.warn}22`,
            color: theme.warn,
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {t('about.badge')}
        </div>

        {/* Description */}
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: theme.textSoft }}>
          {t('about.description1')}
        </p>

        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: theme.textSoft }}>
          {t('about.description2')}
        </p>

        {/* Divider */}
        <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />

        {/* Creator + GitHub */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: theme.textSoft }}>
          <span>
            {t('about.createdBy')}{' '}
            <span
              onClick={() => ipc.openUrl(GITHUB)}
              style={{ color: theme.accent, textDecoration: 'none', fontWeight: 500, cursor: 'pointer' }}
            >
              Patrick
            </span>
          </span>
          <span
            onClick={() => ipc.openUrl(REPO)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: theme.textSoft,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <GithubLogo size={16} weight="fill" />
            patrick-mns/micelio-code
          </span>
        </div>
      </div>
    </Modal>
  );
}