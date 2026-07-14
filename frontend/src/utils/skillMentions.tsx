// #skill mention helpers — parsing drafts/messages and rendering the accent
// pill used in chat bubbles and composer chips.
import React from 'react';
import type { SkillSummary } from '@/types';

const pillStyle: React.CSSProperties = {
  color: 'var(--color-accent)',
  fontWeight: 500,
  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
  borderRadius: 'var(--radius-xs)',
  padding: '0 3px',
};

// Color only — no padding/weight, so glyph metrics stay identical to plain
// text. Required by the composer overlay, which must align 1:1 with the
// transparent textarea's caret and selection.
const inlineStyle: React.CSSProperties = {
  color: 'var(--color-accent)',
};

function renderMentions(
  text: string,
  skills: SkillSummary[],
  style: React.CSSProperties,
): React.ReactNode {
  if (!text.includes('#') || skills.length === 0) return text;
  const known = new Set(skills.map((s) => s.name.toLowerCase()));
  const parts = text.split(/(#[\w-]+)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.startsWith('#') && known.has(part.slice(1).toLowerCase()) ? (
      <span key={i} style={style}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Chat bubbles: known #skill mentions as accent pills. */
export function renderSkillMentions(text: string, skills: SkillSummary[]): React.ReactNode {
  return renderMentions(text, skills, pillStyle);
}

/** Composer overlay: accent color only, metrics identical to plain text. */
export function renderInlineMentions(text: string, skills: SkillSummary[]): React.ReactNode {
  return renderMentions(text, skills, inlineStyle);
}
