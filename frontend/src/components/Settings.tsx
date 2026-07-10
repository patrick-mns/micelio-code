import React, { useEffect, useState } from 'react';
import { ChatCircle, Cloud, FolderOpen, Wrench, Palette, X, type Icon } from '@phosphor-icons/react';
import { theme } from '@/theme';
import AppearanceSettings from './AppearanceSettings';
import ChatSettings from './ChatSettings';
import ProviderSettings from './ProviderSettings';
import WorkspaceSettings from './WorkspaceSettings';
import AdvancedSettings from './AdvancedSettings';
import { settingsModalStyles as modalStyles } from '@/utils/theme-styles';
import { ipc } from '@/ipc';

import { useStore } from '@/store';
import type { SettingsCategoryId } from '@/store/uiSlice';

const CATEGORIES: { id: SettingsCategoryId; label: string; Icon: Icon; Panel: React.ComponentType }[] = [
  { id: 'appearance', label: 'Appearance', Icon: Palette, Panel: AppearanceSettings },
  { id: 'chat', label: 'Chat', Icon: ChatCircle, Panel: ChatSettings },
  { id: 'providers', label: 'Providers', Icon: Cloud, Panel: ProviderSettings },
  { id: 'workspace', label: 'Workspace', Icon: FolderOpen, Panel: WorkspaceSettings },
  { id: 'advanced', label: 'Advanced', Icon: Wrench, Panel: AdvancedSettings },
];

interface SettingsProps {
  onClose: () => void;
}

export default function Settings({ onClose }: SettingsProps) {
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
          <div style={modalStyles.sidebarTitle}>Settings</div>
          {CATEGORIES.map(({ id, label, Icon }) => {
            const selected = category === id;
            return (
              <button
                key={id}
                onClick={() => setCategory(id)}
                className={selected ? 'menu-item is-active' : 'menu-item'}
              >
                <Icon size={15} color={selected ? theme.accent : theme.dim} />
                {label}
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
            <span style={modalStyles.headerTitle}>{active.label}</span>
            <button onClick={onClose} className="close-btn" title="Close">
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