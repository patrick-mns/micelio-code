import React, { useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { questionCardStyles } from '@/utils/theme-styles';
import { mdComponents } from '@/components/MdComponents';
import { Check, ArrowRight, CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { theme } from '@/theme';

export interface Question {
  question: string;
  header: string;
  options: string[];
  multi: boolean;
}

// Parse the raw `ask_user` arguments JSON into a normalized questions array.
// Accepts the Claude-style `{questions:[{question,header,options,multiSelect}]}`
// and the legacy single-question `{question, options:"a,b"}` shape.
export function parseQuestions(argsJson: string): Question[] {
  let val: any;
  try { val = JSON.parse(argsJson); } catch { return []; }

  const opts = (o: unknown): string[] => {
    if (Array.isArray(o)) return o.map((x) => String(x).trim()).filter(Boolean);
    if (typeof o === 'string') return o.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  };

  const isMulti = (q: any): boolean => {
    const v = q.multiSelect ?? q.multi_select ?? q.multiselect ?? q.multiple ?? q.multi ?? q.allowMultiple;
    if (typeof v === 'string') return ['true', 'yes', '1', 'on'].includes(v.trim().toLowerCase());
    return !!v;
  };

  if (Array.isArray(val?.questions)) {
    return val.questions
      .filter((q: any) => q?.question)
      .map((q: any) => ({
        question: String(q.question).trim(),
        header: (q.header || '').trim(),
        options: opts(q.options),
        multi: isMulti(q),
      }));
  }
  if (val?.question) {
    return [{ question: String(val.question).trim(), header: '', options: opts(val.options), multi: isMulti(val) }];
  }
  return [];
}

interface QuestionCardProps {
  questions: Question[];
  onAnswer: (text: string) => void;
  onCancel: () => void;
}

export default function QuestionCard({ questions, onAnswer, onCancel }: QuestionCardProps) {
  // Track answers across all questions (indexed by question index)
  const [picked, setPicked] = useState<string[]>(() => questions.map(() => ''));
  const [freeText, setFreeText] = useState<string[]>(() => questions.map(() => ''));
  const [page, setPage] = useState(0);

  const pickOption = (qi: number, opt: string) => {
    setPicked((prev) => prev.map((v, i) => (i === qi ? (v === opt ? '' : opt) : v)));
  };

  const submit = () => {
    const lines = questions.map((q, qi) => {
      const label = q.header || q.question;
      const picks: string[] = [];
      if (picked[qi]) picks.push(picked[qi]);
      const t = freeText[qi].trim();
      if (t) picks.push(t);
      return picks.length > 0 ? `${label}: ${picks.join(', ')}` : `${label}: (skipped)`;
    });
    onAnswer(lines.join('\n'));
  };

  const q = questions[page];

  return (
    <div style={questionCardStyles.wrap}>
      {/* Top bar with close and pagination */}
      <div style={questionCardStyles.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {questions.length > 1 && (
            <>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="close-btn"
                style={{ color: page === 0 ? theme.faint : theme.dim }}
              >
                <CaretLeft size={13} />
              </button>
              <span style={{ fontSize: 11.5, color: theme.dim, fontFamily: 'ui-monospace, monospace' }}>
                {page + 1}/{questions.length}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(questions.length - 1, p + 1))}
                disabled={page === questions.length - 1}
                className="close-btn"
                style={{ color: page === questions.length - 1 ? theme.faint : theme.dim }}
              >
                <CaretRight size={13} />
              </button>
            </>
          )}
        </div>
        <button className="close-btn" onClick={onCancel} title="Cancel">
          <X size={15} />
        </button>
      </div>

      {/* Question card */}
      <div style={questionCardStyles.card}>

        {/* Header + question text (rendered as markdown) */}
        {q.header && <span style={questionCardStyles.header}>{q.header}</span>}
        <div style={questionCardStyles.question}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{q.question}</ReactMarkdown>
        </div>

        {/* Options as compact chips */}
        {q.options.length > 0 && (
          <div style={inlineStyles.chips}>
            {q.options.map((opt) => {
              const on = picked[page] === opt;
              return (
                <button
                  key={opt}
                  onClick={() => pickOption(page, opt)}
                  style={{
                    ...inlineStyles.chip,
                    ...(on ? inlineStyles.chipOn : undefined),
                  }}
                >
                  {on && <Check size={11} weight="bold" />}
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* Free text input */}
        <input
          value={freeText[page]}
          onChange={(e) => setFreeText((prev) => prev.map((v, i) => (i === page ? e.target.value : v)))}
          placeholder={q.options.length ? 'Or type your own…' : 'Type your answer…'}
          style={questionCardStyles.input}
        />

        {/* Bottom: next / send */}
        <div style={inlineStyles.bottom}>
          <div />
          {questions.length > 1 && page < questions.length - 1 ? (
            <button
              onClick={() => setPage((p) => Math.min(questions.length - 1, p + 1))}
              className="btn btn-sm btn-solid"
            >
              Next <ArrowRight size={11} weight="bold" />
            </button>
          ) : (
            <button
              onClick={submit}
              className="btn btn-sm btn-solid"
            >
              Send <ArrowRight size={11} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Inline styles for new elements not in theme-styles
const inlineStyles: Record<string, CSSProperties> = {
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    borderRadius: 'var(--radius-full)',
    border: `1px solid ${theme.border}`,
    background: 'transparent',
    color: theme.text,
    fontSize: 12.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s',
  },
  chipOn: {
    background: theme.accent + '18',
    borderColor: theme.accent,
    color: theme.accent,
  },
  bottom: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  pageLabel: {
    fontSize: 11.5,
    color: theme.dim,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    minWidth: 32,
    textAlign: 'center' as const,
  },
};