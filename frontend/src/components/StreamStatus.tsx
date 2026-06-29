import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolEntry from '@/components/ToolEntry';
import { mdComponents } from '@/components/MdComponents';
import { chatStyles as styles } from '@/utils/theme-styles';
import type { Prefs } from '@/store/prefsSlice';

// One chunk of the in-flight assistant turn: either a tool-call summary or a
// run of streamed markdown text.
export interface StreamPart {
  type: 'tool' | 'content';
  content?: string;
  text?: string;
}

export interface StreamState {
  parts: StreamPart[];
}

interface StreamStatusProps {
  streaming: StreamState | null;
  elapsed: number;
  liveTokens: number;
  liveContentLen: number;
  prefs: Prefs;
}

export default function StreamStatus({ streaming, elapsed, liveTokens, liveContentLen, prefs }: StreamStatusProps) {
  if (!streaming) return null;

  return (
    <>
      {streaming.parts.map((p, i) =>
        p.type === 'tool'
          ? prefs.showTools && (
              <ToolEntry key={`live-${i}`} content={p.content ?? ''} showDetails={prefs.showTools} />
            )
          : p.text && (
              <div className="md" key={`live-${i}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {p.text}
                </ReactMarkdown>
              </div>
            )
      )}
      {/* Activity line: ✻ Ns · ~N tok · thinking/responding */}
      <div style={styles.activity}>
        <span style={styles.star}>✻</span>
        <span style={styles.activityText}>
          {elapsed}s
          {liveTokens > 0 ? ` · ~${liveTokens} tok` : ''}
          {' · '}
          {liveContentLen > 0 ? 'responding' : 'thinking'}
          <span className="think-dots-inline" />
        </span>
      </div>
    </>
  );
}
