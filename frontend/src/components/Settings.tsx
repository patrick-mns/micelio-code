import React, { useEffect, useState } from 'react';
import { ChatCircle, Cloud, Wrench, X, type Icon } from '@phosphor-icons/react';
import { theme } from '@/theme';
import ChatSettings from './ChatSettings';
import ProviderSettings from './ProviderSettings';
import AdvancedSettings from './AdvancedSettings';
import { settingsModalStyles as modalStyles } from '@/utils/theme-styles';
import { ipc } from '@/ipc';

type CategoryId = 'chat' | 'providers' | 'advanced';

const CATEGORIES: { id: CategoryId; label: string; Icon: Icon }[] = [
  { id: 'chat', label: 'Chat', Icon: ChatCircle },
  { id: 'providers', label: 'Providers', Icon: Cloud },
  { id: 'advanced', label: 'Advanced', Icon: Wrench },
];

interface SettingsProps {
  onClose: () => void;
}

export default function Settings({ onClose }: SettingsProps) {
  const [category, setCategory] = useState<CategoryId>('chat');
  const [version, setVersion] = useState('');

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
          <button onClick={onClose} className="close-btn" style={modalStyles.closeBtn}>
            <X size={15} />
          </button>
          {category === 'chat' && <ChatSettings />}
          {category === 'providers' && <ProviderSettings />}
          {category === 'advanced' && <AdvancedSettings />}
        </div>
      </div>
    </div>
  );
}