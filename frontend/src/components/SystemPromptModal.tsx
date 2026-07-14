import React, { useEffect, useState, type CSSProperties } from 'react';
import { systemPromptModalStyles } from '@/utils/theme-styles';
import { fmtTok } from '@/utils/formatters';
import { X, Copy, Check, PencilSimple, ArrowCounterClockwise } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ipc } from '@/ipc';
import { theme } from '@/theme';
import Modal from '@/components/Modal';

const estTokens = (s: string | null) => Math.max(1, Math.round((s?.length || 0) / 4));

interface SystemPromptModalProps {
  onClose: () => void;
}

// Inspector + editor for the system prompt — the instructions sent to the model
// on every turn (never summarized by Compact). Reads as formatted markdown;
// "Edit" switches to a raw textarea where the prompt can be customized or reset
// back to the built-in default.
export default function SystemPromptModal({ onClose }: SystemPromptModalProps) {
  const [text, setText] = useState<string | null>(null);      // live prompt (rendered)
  const [defaultText, setDefaultText] = useState(''); // built-in default
  const [skillsText, setSkillsText] = useState('');   // active skills (read-only)
  const [isCustom, setIsCustom] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');       // textarea buffer while editing
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ipc.getSystemPrompt()
      .then((info) => {
        setText(info.text);
        setDefaultText(info.default_text);
        setIsCustom(info.is_custom);
        setSkillsText(info.skills_text);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const copy = () => {
    navigator.clipboard?.writeText(text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const startEdit = () => {
    setDraft(text || '');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      // Backend returns false when the saved text matches the default (it
      // clears the override in that case), so "custom" reflects reality.
      const stillCustom = await ipc.setSystemPrompt(draft);
      setText(draft);
      setIsCustom(stillCustom);
      setEditing(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Restore the built-in default. While editing, just loads it into the draft
  // (the user still has to Save). Otherwise clears the override immediately.
  const reset = async () => {
    if (editing) {
      setDraft(defaultText);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const def = await ipc.resetSystemPrompt();
      setText(def);
      setIsCustom(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const shown = editing ? draft : text;

  return (
    <Modal
      onClose={onClose}
      onEscape={() => (editing ? setEditing(false) : onClose())}
      closeOnBackdrop={!editing}
      backdropStyle={{ position: 'absolute', zIndex: 1000 }}
      cardStyle={{ background: theme.bg }}
    >
        <div style={systemPromptModalStyles.head}>
          <div style={systemPromptModalStyles.headLeft}>
            <span style={systemPromptModalStyles.title}>System prompt</span>
            {isCustom && !editing && <span style={systemPromptModalStyles.customTag}>custom</span>}
            {shown != null && (
              <span style={systemPromptModalStyles.meta}>~{fmtTok(estTokens(shown))} tok</span>
            )}
          </div>
          <div style={systemPromptModalStyles.headRight}>
            {!editing && (
              <>
                {isCustom && (
                  <button className="btn btn-sm btn-outline" onClick={reset} disabled={saving}>
                    <ArrowCounterClockwise size={13} />
                    Reset
                  </button>
                )}
                <button className="btn btn-sm btn-outline" onClick={copy} disabled={text == null}>
                  {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={startEdit} disabled={text == null}>
                  <PencilSimple size={13} />
                  Edit
                </button>
              </>
            )}
            {editing && (
              <>
                <button className="btn btn-sm btn-outline" onClick={reset} disabled={saving}>
                  <ArrowCounterClockwise size={13} />
                  Load default
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
                <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            <button className="close-btn" style={systemPromptModalStyles.close} onClick={onClose} title="Close (Esc)">
              <X size={15} />
            </button>
          </div>
        </div>
        <div style={systemPromptModalStyles.body}>
          {err && <div style={systemPromptModalStyles.err}>{err}</div>}
          {text == null && !err && <div style={systemPromptModalStyles.loading}>Loading…</div>}
          {text != null && !editing && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="md" style={systemPromptModalStyles.mdWrap}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              </div>
              {/* Active skills — appended to the prompt at send time, but
                  managed from the dock, so they're read-only here. */}
              {skillsText && (
                <div style={{ marginTop: 20, borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: theme.text }}>
                      Active skills
                    </span>
                    <span style={systemPromptModalStyles.meta}>
                      ~{fmtTok(estTokens(skillsText))} tok · appended at send time · manage in the dock
                    </span>
                  </div>
                  <div className="md" style={{ ...systemPromptModalStyles.mdWrap, opacity: 0.75 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{skillsText}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
          {editing && (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              style={systemPromptModalStyles.textarea}
              placeholder="Enter a custom system prompt…"
            />
          )}
        </div>
    </Modal>
  );
}

