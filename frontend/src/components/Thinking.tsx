import React, { useState, type CSSProperties } from 'react';
import { thinkingStyles } from '@/utils/theme-styles';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CaretRight } from '@phosphor-icons/react';
import { theme } from '@/theme';

interface ThinkingProps {
  content: string;
  duration?: number;
  live?: boolean;
}

// Collapsible reasoning block, Claude-style: no icon, just a subtle
// "✻ Thought for Ns" header with the reasoning indented under a thin rule.
// While `live` it stays open and shows a pulsing asterisk + "Thinking".
export default function Thinking({ content, duration, live = false }: ThinkingProps) {
  const [open, setOpen] = useState(live);

  // keep it open while streaming
  const isOpen = live || open;

  const header = live
    ? 'Thinking'
    : duration != null
    ? `Thought for ${duration}s`
    : 'Thought process';

  return (
    <div style={thinkingStyles.wrap}>
      <button
        onClick={() => !live && setOpen(!open)}
        style={{ ...thinkingStyles.header, cursor: live ? 'default' : 'pointer' }}
      >
        <span style={{ ...thinkingStyles.asterisk, animation: live ? 'pulse-star 1.4s ease-in-out infinite' : 'none' }}>
          ✻
        </span>
        <span style={thinkingStyles.label}>{header}</span>
        {live && <span className="think-dots" style={thinkingStyles.dots} />}
        {!live && content && (
          <CaretRight
            size={11}
            color={theme.faint}
            style={{
              transform: isOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.12s',
              flexShrink: 0,
            }}
          />
        )}
      </button>

      {isOpen && content && (
        <div style={thinkingStyles.body}>
          <div className="md-thinking">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

