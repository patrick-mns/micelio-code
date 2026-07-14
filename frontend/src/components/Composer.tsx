import React, { useRef, type ComponentType, type RefObject } from 'react';
import { ArrowElbowDownLeft, Stop, Broom, ImageSquare, X } from '@phosphor-icons/react';
import { theme } from '@/theme';
import { useStore } from '@/store';
import { renderInlineMentions } from '@/utils/skillMentions';
import ModelRolesSelector from '@/components/ModelRolesSelector';
import SuggestPalette from '@/components/SuggestPalette';
import type { SkillSummary } from '@/types';
import ModeSelector from '@/components/ModeSelector';
import { chatStyles as styles } from '@/utils/theme-styles';
import type { Attachment, SlashCommand } from '@/utils/chatHelpers';

interface CommandPaletteComponentProps {
  commands: SlashCommand[];
  selected: number;
  onPick: (command: SlashCommand) => void;
}

interface ComposerProps {
  input: string;
  setInput: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  send: () => void;
  cancel: () => void;
  clear: () => void;
  attachment: Attachment | null;
  setAttachment: (attachment: Attachment | null) => void;
  attachImage: (file: File | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  taRef: RefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  onDrop: (e: React.DragEvent) => void;
  autosize: (el: HTMLTextAreaElement) => void;
  showPalette: boolean;
  filteredCmds: SlashCommand[];
  cmdSelected: number;
  setCmdSelected: (n: number) => void;
  runCommand: (command: SlashCommand) => void;
  CommandPalette: ComponentType<CommandPaletteComponentProps>;
  showSkillPalette: boolean;
  filteredSkills: SkillSummary[];
  skillSelected: number;
  pickSkill: (skill: SkillSummary) => void;
}

export default function Composer({
  input, setInput, onKeyDown, onPaste, send, cancel, clear,
  attachment, setAttachment, attachImage, fileInputRef, taRef, isLoading,
  onDrop, autosize, showPalette, filteredCmds, cmdSelected, setCmdSelected,
  runCommand, CommandPalette,
  showSkillPalette, filteredSkills, skillSelected, pickSkill,
}: ComposerProps) {
  const skills = useStore((s) => s.skills);
  const overlayRef = useRef<HTMLDivElement>(null);
  return (
    <div style={{ position: 'relative' }}>
      {showPalette && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 10 }}>
          <CommandPalette commands={filteredCmds} selected={cmdSelected} onPick={runCommand} />
        </div>
      )}
      {showSkillPalette && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 10 }}>
          <SuggestPalette
            items={filteredSkills}
            selected={skillSelected}
            onPick={pickSkill}
            getKey={(s) => s.name}
            getLabel={(s) => `#${s.name}`}
            getDesc={(s) => s.description || s.display_name}
          />
        </div>
      )}
      <div style={styles.card} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          {attachment && (
            <div style={styles.attachRow}>
              <div style={styles.attachChip}>
                <img src={attachment.preview} alt="attachment" style={styles.attachThumb} />
                <span style={styles.attachName}>image attached</span>
                <button onClick={() => setAttachment(null)} className="icon-btn-sm" title="Remove image">
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
          {/* Mirrored highlight: the overlay renders the same text (with
              #skill mentions in accent) behind a transparent-text textarea.
              Both share styles.textarea metrics, so glyphs align 1:1 and the
              caret/selection stay native. */}
          <div style={{ position: 'relative' }}>
            <div
              ref={overlayRef}
              aria-hidden
              style={{
                ...styles.textarea,
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                pointerEvents: 'none',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
                padding: 0,
              }}
            >
              {renderInlineMentions(input, skills)}
              {'​' /* keeps a trailing newline's line box rendered */}
            </div>
            <textarea
              ref={taRef}
              className="mention-ta"
              value={input}
              onChange={(e) => { setInput(e.target.value); setCmdSelected(0); autosize(e.target); }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={(e) => {
                if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              placeholder="Type a prompt or /command..."
              rows={2}
              style={{
                ...styles.textarea,
                display: 'block',
                position: 'relative',
                color: 'transparent',
                caretColor: theme.text,
                padding: 0,
              }}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { attachImage(e.target.files?.[0] ?? null); e.target.value = ''; }}
          />
          <div style={styles.actionRow}>
            <ModeSelector />
            <button className="icon-btn" onClick={clear} title="Clear conversation">
              <Broom size={16} />
            </button>
            <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach image">
              <ImageSquare size={16} />
            </button>
            <div style={{ flex: 1 }} />
            <ModelRolesSelector />
            <button
              className="send-btn"
              onClick={isLoading ? cancel : send}
              disabled={!input.trim() && !attachment && !isLoading}
              style={{
                ...styles.sendBtn,
                background: input.trim() || attachment || isLoading ? theme.cardActive : theme.card,
                border: `1px solid ${theme.border}`,
              }}
              title={isLoading ? 'Stop generating' : 'Send (Enter)'}
            >
              {isLoading ? (
                <Stop size={13} weight="fill" color={theme.text} />
              ) : (
                <ArrowElbowDownLeft size={15} color={input.trim() || attachment ? theme.text : theme.faint} />
              )}
            </button>
        </div>
      </div>
    </div>
  );
}