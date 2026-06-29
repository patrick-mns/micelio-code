import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, ImageSquare } from '@phosphor-icons/react';
import { useStore } from '@/store';
import { theme } from '@/theme';
import { mdComponents } from '@/components/MdComponents';
import { fmtUsd, fmtTok, type ChatMessageView } from '@/utils/chatHelpers';
import { chatStyles as styles } from '@/utils/theme-styles';

interface MessageProps {
  msg: ChatMessageView;
  msgKey: string;
  hovered: boolean;
}

export default function Message({ msg, msgKey, hovered }: MessageProps) {
  const [copied, setCopied] = useState(false);
  const showCost = useStore((s) => s.settings?.show_cost);
  const isUser = msg.role === 'user';
  const usage = !isUser && showCost ? msg.usage : null;
  const tok = usage ? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) : 0;

  const copy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Visibility driven by parent's cursor tracking (recomputed on every mousemove),
  // not CSS :hover — the webview leaves :hover stuck when the DOM mutates under a
  // stationary cursor (streaming, layout shift).
  const showBtn = hovered || copied;

  return (
    <div
      data-msg-key={msgKey}
      style={{ ...styles.msgRow, justifyContent: isUser ? 'flex-end' : 'flex-start' }}
    >
      <div style={{ maxWidth: isUser ? '72%' : '100%' }}>
        {isUser ? (
          <div style={styles.userBubble}>
            {msg.content && <div>{msg.content}</div>}
            {msg.attachment && (
              <div style={{ ...styles.msgAttach, marginTop: msg.content ? 8 : 0 }}>
                {msg.attachment.preview && (
                  <img src={msg.attachment.preview} alt="" style={styles.msgAttachThumb} />
                )}
                <ImageSquare size={13} color={theme.dim} weight="fill" style={{ flexShrink: 0 }} />
                <span style={styles.msgAttachName}>{msg.attachment.name}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {msg.content}
            </ReactMarkdown>
          </div>
        )}
        <div style={{ ...styles.copyRow, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
          <button
            onClick={copy}
            className="copy-btn"
            title="Copy message"
            style={{
              ...styles.copyBtn,
              opacity: showBtn ? 1 : 0,
              pointerEvents: showBtn ? 'auto' : 'none',
            }}
          >
            {copied ? <Check size={12} color={theme.success} /> : <Copy size={12} color={theme.dim} />}
          </button>
          {usage && (
            <div style={styles.usage}>
              {fmtTok(tok)} tok · {fmtUsd(usage.cost || 0)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}