import { type ComponentType, type CSSProperties, useEffect, useMemo, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import Message from '@/components/Message';
import Thinking from '@/components/Thinking';
import { ToolGroup } from '@/components/ToolEntry';
import { chatStyles as styles } from '@/utils/theme-styles';
import type { RenderedItem } from '@/utils/chatHelpers';
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
  renderedMessages: RenderedItem[];
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
  streaming: StreamState | null;
  elapsed: number;
  liveTokens: number;
  liveContentLen: number;
  prefs: Prefs;
  StreamStatus: ComponentType<StreamStatusComponentProps>;
}

// Virtuoso measures item heights with a ResizeObserver, which ignores margins —
// so ALL spacing here must be padding, never margin. Each item carries its own
// centering wrapper (760px column, 24px gutters) instead of customizing List.
const itemWrapStyle: CSSProperties = {
  margin: '0 auto',
  maxWidth: 760,
  width: '100%',
  padding: '0 24px 16px',
  boxSizing: 'border-box',
};

// Data Header/Footer/EmptyPlaceholder need, threaded through Virtuoso's
// `context` prop instead of closures. Virtuoso remounts a `components` entry
// whenever its function reference changes — closing over fast-changing props
// (streaming updates on every token) would recreate Footer every render and
// reset any local state inside it, e.g. collapsed tool groups mid-stream.
interface ListContext {
  streaming: StreamState | null;
  elapsed: number;
  liveTokens: number;
  liveContentLen: number;
  prefs: Prefs;
  StreamStatus: ComponentType<StreamStatusComponentProps>;
}

function ListHeader() {
  // Old layout: 12px scroller padding + 24px column padding on top.
  return <div style={{ height: 36 }} />;
}

function ListEmptyPlaceholder({ context }: { context: ListContext }) {
  if (context.streaming) return null;
  return (
    <div style={{ ...itemWrapStyle, height: '100%', display: 'flex', flexDirection: 'column', paddingTop: 24 }}>
      <div style={styles.empty}>
        <div
          style={{
            ...styles.emptyText,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <div>How can I help you today?</div>
          <span style={{ fontSize: 12, opacity: 0.65, fontWeight: 'normal' }}>
            Type below or click New Session to begin.
          </span>
        </div>
      </div>
    </div>
  );
}

// Rendered outside the item list, so it needs its own centering wrapper.
// Bottom breathing room matches the old scroller's 12px padding.
function ListFooter({ context }: { context: ListContext }) {
  const { streaming, elapsed, liveTokens, liveContentLen, prefs, StreamStatus } = context;
  return (
    <div style={{ ...itemWrapStyle, paddingBottom: 12 }}>
      {streaming && (
        <div style={styles.msgRow}>
          <div style={{ width: '100%' }}>
            <StreamStatus
              streaming={streaming}
              elapsed={elapsed}
              liveTokens={liveTokens}
              liveContentLen={liveContentLen}
              prefs={prefs}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Module-scope, stable reference — Virtuoso never sees a "new" Header/Footer/
// EmptyPlaceholder across renders, so it never remounts them mid-stream.
const listComponents = {
  Header: ListHeader,
  EmptyPlaceholder: ListEmptyPlaceholder,
  Footer: ListFooter,
};

export default function MessageList({
  renderedMessages,
  hoveredKey,
  setHoveredKey,
  streaming,
  elapsed,
  liveTokens,
  liveContentLen,
  prefs,
  StreamStatus,
}: MessageListProps) {
  // Zero-height items break Virtuoso's positioning — drop hidden ones instead.
  const items = useMemo(
    () => (prefs.showThinking ? renderedMessages : renderedMessages.filter((i) => i.type !== 'thinking')),
    [renderedMessages, prefs.showThinking],
  );

  // The in-flight assistant turn renders in the Footer (StreamStatus), which
  // grows token by token WITHOUT changing totalCount — so Virtuoso's
  // followOutput (which only reacts to item-count changes) never fires during a
  // stream and the view falls behind. Follow the growth ourselves: while the
  // user is pinned to the bottom, keep scrolling to it as content arrives. If
  // they scroll up to read history mid-stream, atBottom flips false and we stop.
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  useEffect(() => {
    if (!streaming || !atBottomRef.current) return;
    const raf = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER });
    });
    return () => cancelAnimationFrame(raf);
  }, [streaming, liveContentLen]);

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ flex: 1 }}
      totalCount={items.length}
      computeItemKey={(index) => items[index].key}
      initialTopMostItemIndex={Math.max(0, items.length - 1)}
      increaseViewportBy={{ top: 400, bottom: 400 }}
      followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
      atBottomThreshold={80}
      atBottomStateChange={(atBottom) => { atBottomRef.current = atBottom; }}
      context={{ streaming, elapsed, liveTokens, liveContentLen, prefs, StreamStatus }}
      onMouseMove={(e) => {
        const msgEl = (e.target as HTMLElement).closest('[data-msg-key]');
        setHoveredKey(msgEl ? (msgEl as HTMLElement).dataset.msgKey ?? null : null);
      }}
      itemContent={(index) => {
        const item = items[index];
        if (item.type === 'tools') {
          return (
            <div style={itemWrapStyle}>
              <ToolGroup tools={item.tools} />
            </div>
          );
        } else if (item.type === 'thinking') {
          return (
            <div style={itemWrapStyle}>
              <Thinking content={item.msg.content} duration={item.msg.duration} />
            </div>
          );
        } else if (item.type === 'canceled') {
          return (
            <div style={itemWrapStyle}>
              <div style={{ ...styles.msgRow, justifyContent: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontStyle: 'italic' }}>
                  Canceled by user
                </span>
              </div>
            </div>
          );
        } else {
          // Message renders its own msgRow (with user/assistant alignment) —
          // wrapping it in another flex row would shrink it to content width
          // and break the flex-end alignment of user bubbles.
          return (
            <div style={itemWrapStyle}>
              <Message msg={item.msg} msgKey={item.key} hovered={hoveredKey === item.key} />
            </div>
          );
        }
      }}
      components={listComponents}
    />
  );
}
