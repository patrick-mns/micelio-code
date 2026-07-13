import React, { useEffect, useState } from 'react';
import { ChatCircle, Cloud, FolderOpen, Wrench, Palette, Plug, X, type Icon } from '@phosphor-icons/react';
import { theme } from '@/theme';
import { useI18n } from '@/i18n';
import AppearanceSettings from './AppearanceSettings';
import ChatSettings from './ChatSettings';
import ProviderSettings from './ProviderSettings';
import McpSettings from './McpSettings';
import WorkspaceSettings from './WorkspaceSettings';
import AdvancedSettings from './AdvancedSettings';
import { settingsModalStyles as modalStyles } from '@/utils/theme-styles';
import { ipc } from '@/ipc';

import { useStore } from '@/store';
import type { SettingsCategoryId } from '@/store/uiSlice';

const CATEGORIES: { id: SettingsCategoryId; Icon: Icon; Panel: React.ComponentType }[] = [
  { id: 'appearance', Icon: Palette, Panel: AppearanceSettings },
  { id: 'chat', Icon: ChatCircle, Panel: ChatSettings },
  { id: 'providers', Icon: Cloud, Panel: ProviderSettings },
  { id: 'mcp', Icon: Plug, Panel: McpSettings },
  { id: 'workspace', Icon: FolderOpen, Panel: WorkspaceSettings },
  { id: 'advanced', Icon: Wrench, Panel: AdvancedSettings },
];

interface SettingsProps {
  onClose: () => void;
}

export default function Settings({ onClose }: SettingsProps) {
  const { t } = useI18n();
  const { settingsCategory: category, setSettingsCategory: setCategory } = useStore();
  const [version, setVersion] = useState('');
  const active = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

  useEffect(() => {
    ipc.getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div style={modalStyles.backdrop} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Sidebar */}
        <div style={modalStyles.sidebar}>
          <div style={modalStyles.sidebarTitle}>{t('settings.title')}</div>
          {CATEGORIES.map(({ id, Icon }) => {
            const selected = category === id;
            return (
              <button
                key={id}
                onClick={() => setCategory(id)}
                className={selected ? 'menu-item is-active' : 'menu-item'}
              >
                <Icon size={15} color={selected ? theme.accent : theme.dim} />
                {t('settings.' + id)}
              </button>
            );
          })}
          {/* Version footer */}
          <div style={{ marginTop: 'auto', padding: '12px', fontSize: 11, color: theme.dim, textAlign: 'left' }}>
            {version ? `v${version}` : ''}
          </div>
        </div>

        {/* Content */}
        <div style={modalStyles.content}>
          <div style={modalStyles.header}>
            <span style={modalStyles.headerTitle}>{t('settings.' + active.id)}</span>
            <button onClick={onClose} className="close-btn" title={t('settings.close')}>
              <X size={15} />
            </button>
          </div>
          <div style={modalStyles.body}>
            <active.Panel />
          </div>
        </div>
      </div>
    </div>
  );
}