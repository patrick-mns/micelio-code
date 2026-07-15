import { ChatDots } from '@phosphor-icons/react';
import { useStore } from '@/store';
import { useI18n } from '@/i18n';

/** Pill no header mostrando qual sessão está ativa, ao lado do toggle do sidebar. */
export default function SessionBadge() {
  const { currentSession, sessions } = useStore();
  const { t } = useI18n();

  const activeId = currentSession ?? sessions.find((s) => s.active)?.id ?? null;
  if (!activeId) return null;

  const session = sessions.find((s) => s.id === activeId);
  const title = session?.title ?? '';

  return (
    <div
      className="btn btn-ghost"
      title={t('app.currentSession')}
      style={{
        gap: 6,
        padding: '0 10px',
        height: 28,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'default',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        maxWidth: 180,
      }}
    >
      <ChatDots size={15} weight="fill" style={{ flexShrink: 0, opacity: 0.7 }} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
    </div>
  );
}