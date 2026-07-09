import React, { type ComponentType, type CSSProperties, type RefObject } from 'react';
import Message from '@/components/Message';
import Thinking from '@/components/Thinking';
import { ToolGroup } from '@/components/ToolEntry';
import { chatStyles as styles } from '@/utils/theme-styles';
import type { ChatMessageView, RenderedItem } from '@/utils/chatHelpers';
import type { StreamState } from '@/components/StreamStatus';
import type { Prefs } from '@/store/prefsSlice';

interface StreamStatusComponentProps {
  streaming: StreamState | null;
  elapsed: number;
  liveTokens: number;
  liveContentLen: number;
  prefs: Prefs;
}

interface MessageListProps {
  messages: ChatMessageView[];
  renderedMessages: RenderedItem[];
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
  bottomRef: RefObject<HTMLDivElement | null>;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  streaming: StreamState | null;
  elapsed: number;
  liveTokens: number;
  liveContentLen: number;
  prefs: Prefs;
  StreamStatus: ComponentType<StreamStatusComponentProps>;
}

export default function MessageList({ messages, renderedMessages, hoveredKey, setHoveredKey, bottomRef, scrollRef, onScroll, streaming, elapsed, liveTokens, liveContentLen, prefs, StreamStatus }: MessageListProps) {
  // Determine which column width to use for the "no messages" state
  const colStyle: CSSProperties = { ...styles.col, width: '100%', maxWidth: 760, flex: 1, padding: '24px 24px 0', gap: 16 };

  return (
    <div
      ref={scrollRef}
      style={styles.scroll}
      onScroll={onScroll}
      onMouseMove={(e) => {
        const msgEl = (e.target as HTMLElement).closest('[data-msg-key]');
        setHoveredKey(msgEl ? (msgEl as HTMLElement).dataset.msgKey ?? null : null);
      }}
    >
      <div style={colStyle}>
        {messages.length === 0 && !streaming && (
          <div style={styles.empty}>
            <div style={{ ...styles.emptyText, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div>How can I help you today?</div>
              <span style={{ fontSize: 12, opacity: 0.65, fontWeight: 'normal' }}>
                Type below or click New Session to begin.
              </span>
            </div>
          </div>
        )}

        {renderedMessages.map((item) => {
          if (item.type === 'tools') {
            return <ToolGroup key={item.key} tools={item.tools} />;
          } else if (item.type === 'thinking') {
            if (!prefs.showThinking) return null;
            return <Thinking key={item.key} content={item.msg.content} duration={item.msg.duration} />;
          } else if (item.type === 'canceled') {
            return (
              <div key={item.key} style={{ ...styles.msgRow, justifyContent: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontStyle: 'italic' }}>
                  Canceled by user
                </span>
              </div>
            );
          } else {
            return (
              <Message
                key={item.key}
                msg={item.msg}
                msgKey={item.key}
                hovered={hoveredKey === item.key}
              />
            );
          }
        })}

        {/* Live streaming content */}
        {streaming && (
          <div style={styles.msgRow}>
            <div style={{ width: '100%' }}>
              <StreamStatus streaming={streaming} elapsed={elapsed} liveTokens={liveTokens} liveContentLen={liveContentLen} prefs={prefs} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}