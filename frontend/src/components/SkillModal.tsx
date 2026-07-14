import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X } from '@phosphor-icons/react';
import Modal from '@/components/Modal';
import { mdComponents } from '@/components/MdComponents';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import { theme } from '@/theme';
import { systemPromptModalStyles as styles, toggleStyles } from '@/utils/theme-styles';
import type { SkillDetail, SkillSummary } from '@/types';

interface SkillModalProps {
  skill: SkillSummary;
  onClose: () => void;
}

// Skill inspector: name, description, the SKILL.md body, and the enable
// toggle. Opened by clicking a dock icon. Reuses the system-prompt modal's
// head/body layout so it reads like the other document modals.
export default function SkillModal({ skill, onClose }: SkillModalProps) {
  const setSkills = useStore((s) => s.setSkills);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [enabled, setEnabled] = useState(skill.enabled);

  useEffect(() => {
    ipc.getSkill(skill.name).then(setDetail).catch(console.error);
  }, [skill.name]);

  // The skill can be toggled elsewhere while the modal is open (e.g. a sent
  // #mention auto-enabling it) — keep the switch in sync with the store.
  useEffect(() => setEnabled(skill.enabled), [skill.enabled]);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next); // optimistic
    try {
      await ipc.setSkillEnabled(skill.name, next);
      setSkills(await ipc.listSkills());
    } catch (e) {
      console.error(e);
      setEnabled(!next);
    }
  };

  return (
    <Modal onClose={onClose} animate cardStyle={{ background: theme.bg }}>
      <div style={styles.head}>
        <div style={styles.headLeft}>
          <span style={styles.title}>{skill.display_name}</span>
          <span style={styles.meta}>
            #{skill.name}
            {detail?.meta.license ? ` · ${detail.meta.license}` : ''}
            {skill.source && skill.source !== 'micelio' ? ` · from .${skill.source}` : ''}
          </span>
        </div>
        <div style={styles.headRight}>
          <div
            onClick={toggle}
            role="switch"
            aria-checked={enabled}
            title={enabled ? 'Disable skill' : 'Enable skill'}
            style={{
              ...toggleStyles.switch,
              background: enabled ? theme.accent : theme.cardActive,
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                ...toggleStyles.knob,
                transform: enabled ? 'translateX(16px)' : 'translateX(0)',
              }}
            />
          </div>
          <button className="close-btn" style={styles.close} onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>
      </div>

      <div style={{ ...styles.body, flexDirection: 'column' }}>
        {skill.description && (
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: theme.textSoft, marginBottom: 14 }}>
            {skill.description}
          </div>
        )}
        {detail ? (
          <div className="md" style={styles.mdWrap}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {detail.body}
            </ReactMarkdown>
          </div>
        ) : (
          <div style={styles.loading}>Loading…</div>
        )}
      </div>
    </Modal>
  );
}
