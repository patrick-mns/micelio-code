import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolGroup } from '@/components/ToolEntry';
import { mdComponents } from '@/components/MdComponents';
import { chatStyles as styles } from '@/utils/theme-styles';
import { fmtDuration, fmtTok } from '@/utils/formatters';
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

  // Group consecutive tool parts into ToolGroup items live, matching the
  // post-turn "Ran N tools" rendering in Chat.tsx.
  type GroupedItem =
    { type: 'tools'; items: string[]; key: string } |
    { type: 'content'; items: string; key: string };
  const groupedParts = useMemo(() => {
    const out: GroupedItem[] = [];
    for (let i = 0; i < streaming.parts.length; i++) {
      const p = streaming.parts[i];
      if (p.type === 'tool') {
        const tools = [p.content ?? ''];
        let j = i + 1;
        while (j < streaming.parts.length && streaming.parts[j].type === 'tool') {
          tools.push(streaming.parts[j].content ?? '');
          j++;
        }
        out.push({ type: 'tools', items: tools, key: `g-${out.length}` });
        i = j - 1;
      } else if (p.text) {
        out.push({ type: 'content', items: p.text, key: `c-${out.length}` });
      }
    }
    return out;
  }, [streaming.parts]);

  return (
    <>
      {groupedParts.map((g) =>
        g.type === 'tools' && prefs.showTools ? (
          <ToolGroup key={g.key} tools={g.items} />
        ) : g.type === 'content' ? (
          <div className="md" key={g.key}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {g.items}
            </ReactMarkdown>
          </div>
        ) : null
      )}
      {/* Activity line: ✻ <duration> · ~<tokens> tok · thinking/responding */}
      <div style={styles.activity}>
        <span style={styles.star}>✻</span>
        <span style={styles.activityText}>
          {fmtDuration(elapsed)}
          {liveTokens > 0 ? ` · ~${fmtTok(liveTokens)} tok` : ''}
          {' · '}
          {liveContentLen > 0 ? 'responding' : 'thinking'}
          <span className="think-dots-inline" />
        </span>
      </div>
    </>
  );
}
