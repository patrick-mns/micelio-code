import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import MessageList from '@/components/MessageList';
import Composer from '@/components/Composer';
import StreamStatus from '@/components/StreamStatus';
import QuestionCard, { parseQuestions } from '@/components/QuestionCard';
import EditApprovalCard from '@/components/EditApprovalCard';
import ToolConfirmCard from '@/components/ToolConfirmCard';
import GitContext from '@/components/GitContext';
import SkillDock from '@/components/SkillDock';
import SummarizeBanner from '@/components/SummarizeBanner';
import TranscriptView from '@/components/TranscriptView';
import CommandPalette from '@/components/CommandPalette';
import { useWorkspace } from '@/hooks/useWorkspace';
import { COMMANDS, type Attachment, type CommandContext, type ChatMessageView, type RenderedItem, type SlashCommand } from '@/utils/chatHelpers';
import { MIN_SCAN_MS } from '@/utils/treemapHelpers';
import { chatStyles as styles } from '@/utils/theme-styles';
import type { EditReviewRequest, FileHit, SkillSummary, ToolConfirmRequest, Usage } from '@/types';
import type { StreamPart, StreamState } from '@/components/StreamStatus';
import type { Question } from '@/components/QuestionCard';

// The in-flight assistant turn buffered in a ref (a richer StreamState with the
// thinking text, start time, usage, and a cancel flag).
interface StreamSession extends StreamState {
  thinking: string;
  startedAt: number;
  usage?: Usage;
  canceled?: boolean;
}

interface SummarizeState {
  done: number;
  total: number;
  failed: number;
  finished: boolean;
  startedAt: number;
}

export default function Chat() {
  // ── Store ──────────────────────────────────────────────────────────────────
  const {
    messagesBySession, addMessage, setMessages, setLoading,
    setActiveTab, setShowSettings, setGraphNodes, setScanning,
    chatModel, setChatModel, summarizeModel, setSummarizeModel,
    sessions, currentSession, setCurrentSession, streamingSession, setStreamingSession,
    draftsBySession, attachmentsBySession, setDraft, setDraftAttachment,
    prefs, transcriptOpen, currentWorkspace,
  } = useStore();

  const { pickWorkspace } = useWorkspace();

  // First folder of the current workspace → passed to SkillDock as workspaceRoot
  const workspaceRoot: string | null = currentWorkspace?.folders?.[0] ?? null;

  const viewingSession: string = currentSession ?? sessions.find((s) => s.active)?.id ?? '';
  const messages = messagesBySession[viewingSession] ?? [];

  // ── Composer draft (per session, persisted) ──────────────────────────────────
  // Backed by the store keyed on the viewed session so each conversation keeps
  // its own unsent text + staged image, instead of one draft bleeding across
  // sessions. Keep the input/setInput shape so the rest of the view is unchanged.
  const input = draftsBySession[viewingSession] ?? '';
  const setInput = useCallback(
    (value: string) => setDraft(viewingSession, value),
    [setDraft, viewingSession],
  );
  const attachment = attachmentsBySession[viewingSession] ?? null;
  const setAttachment = useCallback(
    (value: Attachment | null) => setDraftAttachment(viewingSession, value),
    [setDraftAttachment, viewingSession],
  );

  // ── Local state ────────────────────────────────────────────────────────────
  const [pendingAsk, setPendingAsk] = useState<Question[] | null>(null);
  const [pendingEdit, setPendingEdit] = useState<EditReviewRequest | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ToolConfirmRequest | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [summarize, setSummarize] = useState<SummarizeState | null>(null);
  const [cmdSelected, setCmdSelected] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [gitRefreshTick, setGitRefreshTick] = useState(0);
  // Bumped when the user sends a message, so the list jumps to the bottom even
  // if they'd scrolled up into history.
  const [sendTick, setSendTick] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const attachedRef = useRef(false);

  // Streaming state: kept inline here (not a custom hook) because logic is Chat-specific
  // (thinking + tools + parts). If this grows or is needed elsewhere, extract to useStreamingChat.
  const streamsRef = useRef<Record<string, StreamSession>>({});
  const [streamsBySession, setStreamsBySession] = useState<Record<string, StreamSession>>({});
  const streaming = streamsBySession[viewingSession] ?? null;

  // ── Fetch history on session change ────────────────────────────────────────
  useEffect(() => {
    if (!viewingSession) return;
    ipc.getHistory().then((msgs) => setMessages(viewingSession, msgs)).catch(console.error);
  }, [viewingSession]);

  // ── Summarization banner ───────────────────────────────────────────────────
  useEffect(() => {
    let unProg: (() => void) | undefined, unDone: (() => void) | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    ipc.onSummarizeProgress((p) => {
      clearTimeout(hideTimer);
      setSummarize((prev) => ({
        done: p.done, total: p.total, failed: p.failed ?? 0,
        finished: false, startedAt: prev?.startedAt ?? Date.now(),
      }));
    }).then((u) => unProg = u);

    ipc.onSummarizeDone((p) => {
      if (!p || p.total === 0) { setSummarize(null); return; }
      setSummarize((prev) => ({
        done: p.done ?? p.total, total: p.total, failed: p.failed ?? 0,
        finished: true, startedAt: prev?.startedAt ?? Date.now(),
      }));
      ipc.getGraph().then(setGraphNodes).catch(console.error);
      hideTimer = setTimeout(() => setSummarize(null), (p.failed ?? 0) > 0 ? 6000 : 2500);
    }).then((u) => unDone = u);

    return () => { unProg?.(); unDone?.(); clearTimeout(hideTimer); };
  }, []);

  // ── Stream IPC listeners (registered once) ─────────────────────────────────
  useEffect(() => {
    if (attachedRef.current) return;
    attachedRef.current = true;

    ipc.onStreamContent(({ session_id, delta }) => {
      pushTo(session_id, 'content', delta);
      useStore.getState().setAgentStatus(session_id, 'running');
    });
    ipc.onStreamThinking(({ session_id, delta }) => {
      pushTo(session_id, 'thinking', delta);
      useStore.getState().setAgentStatus(session_id, 'running');
    });
    ipc.onStreamTool(({ session_id, summary }) => pushTo(session_id, 'tools', summary));
    ipc.onStreamDone(({ session_id }) => finishStream(session_id));
    ipc.onStreamError(({ session_id, error }) => errorStream(session_id, error));
    ipc.onAskUser(({ session_id, args }) => {
      const qs = parseQuestions(args);
      if (qs.length) setPendingAsk(qs);
      useStore.getState().setAgentStatus(session_id, 'awaiting_input');
    });
    ipc.onReviewRequest((req) => {
      setPendingEdit(req);
      useStore.getState().setAgentStatus(req.session_id, 'awaiting_input');
    });
    ipc.onConfirmRequest((req) => {
      setPendingConfirm(req);
      useStore.getState().setAgentStatus(req.session_id, 'awaiting_input');
    });
    ipc.onStreamUsage(({ session_id, ...u }) => {
      if (streamsRef.current[session_id]) streamsRef.current[session_id].usage = u;
    });
  }, []);

  function pushTo(sessionId: string, key: 'content' | 'thinking' | 'tools', chunk: string) {
    const cur = streamsRef.current[sessionId];
    if (!cur) return;
    // Once the user hits stop, drop any chunks still arriving while the backend
    // unwinds, so content visibly stops immediately.
    if (cur.canceled) return;
    let next: StreamSession;
    if (key === 'thinking') {
      next = { ...cur, thinking: cur.thinking + chunk };
    } else if (key === 'tools') {
      next = { ...cur, parts: [...cur.parts, { type: 'tool', content: chunk }] };
    } else {
      const parts = [...cur.parts];
      const last = parts[parts.length - 1];
      if (last && last.type === 'content') {
        parts[parts.length - 1] = { ...last, text: last.text + chunk };
      } else {
        parts.push({ type: 'content', text: chunk });
      }
      next = { ...cur, parts };
    }
    streamsRef.current[sessionId] = next;
    setStreamsBySession((prev) => ({ ...prev, [sessionId]: next }));
  }

  // Flush the in-flight stream buffer into permanent messages. Shared by the
  // clean-finish and error paths so a failed turn keeps whatever streamed
  // before it broke instead of discarding it.
  function flushStreamBuffer(sessionId: string) {
    const s = streamsRef.current[sessionId];
    const store = useStore.getState();
    if (s) {
      const dur = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
      if (s.thinking.trim()) store.addMessage(sessionId, { role: 'thinking', content: s.thinking, duration: dur });
      let lastAssistant = -1;
      s.parts.forEach((p, i) => { if (p.type !== 'tool' && p.text?.trim()) lastAssistant = i; });
      s.parts.forEach((p, i) => {
        if (p.type === 'tool') store.addMessage(sessionId, { role: 'tool', content: p.content ?? '' });
        else if (p.text?.trim()) store.addMessage(sessionId, { role: 'assistant', content: p.text ?? '', usage: i === lastAssistant ? s.usage : undefined });
      });
      if (s.canceled) store.addMessage(sessionId, { role: 'canceled', content: '' });
    }
    delete streamsRef.current[sessionId];
    setStreamsBySession((prev) => { const n = { ...prev }; delete n[sessionId]; return n; });
    return s;
  }

  function finishStream(sessionId: string) {
    const s = flushStreamBuffer(sessionId);
    const store = useStore.getState();
    store.setStreamingSession(null);
    store.setLoading(false);
    // Only set 'complete' if not canceled (cancel already set 'idle')
    if (s && !s.canceled) store.setAgentStatus(sessionId, 'complete');
  }

  function errorStream(sessionId: string, msg: string) {
    const store = useStore.getState();
    // Keep the partial response the user was already reading, then note the error.
    flushStreamBuffer(sessionId);
    store.addMessage(sessionId, { role: 'assistant', content: `Error: ${msg}` });
    store.setStreamingSession(null);
    store.setLoading(false);
    store.setAgentStatus(sessionId, 'error');
  }

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - streaming.startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [!!streaming]);

  // Auto-scroll is handled by Virtuoso's followOutput.

  // ── Image attachment ───────────────────────────────────────────────────────
  const attachImage = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    // Capture the session at call time (synchronous) so the async reader.onload
    // writes to the right session even if the user switches tabs before the read
    // finishes.
    const sessionAtCall = viewingSession;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      const b64 = dataUrl.split(',')[1] || '';
      const ext = file.name?.split('.').pop() || file.type.split('/')[1] || 'png';
      const name = file.name || `image.${ext}`;
      try {
        const path = await ipc.saveAttachment(b64, ext);
        useStore.getState().setDraftAttachment(sessionAtCall, { path, name, preview: dataUrl });
      } catch (e) { console.error('attach failed', e); }
    };
    reader.readAsDataURL(file);
  }, [viewingSession]);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); attachImage(item.getAsFile()); }
  }, [attachImage]);

  const onDrop = useCallback((e: React.DragEvent) => {
    // Skill dragged from the dock → insert a #mention at the caret
    const skillName = e.dataTransfer?.getData('application/x-micelio-skill');
    if (skillName) {
      e.preventDefault();
      // Dropping a skill activates it right away (even if already mentioned).
      ipc
        .setSkillEnabled(skillName, true)
        .then(() => ipc.listSkills())
        .then((list) => useStore.getState().setSkills(list))
        .catch(console.error);
      const ta = taRef.current;
      const current = input;
      const pos = ta ? ta.selectionStart : current.length;
      const mention = `#${skillName}`;
      // Skip if already mentioned (boundary check so '#code' doesn't match
      // inside an existing '#code-review')
      const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`#${escaped}(?![\\w-])`).test(current)) return;
      const before = current.slice(0, pos);
      const after = current.slice(pos);
      const next =
        (before && !before.endsWith(' ') ? before + ' ' : before) +
        mention +
        (after.startsWith(' ') || after === '' ? '' : ' ') +
        after +
        (after === '' ? ' ' : '');
      setInput(next);
      requestAnimationFrame(() => ta?.focus());
      return;
    }
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); attachImage(file); }
  }, [attachImage, input, setInput]);

  // ── Send / Cancel / Clear ──────────────────────────────────────────────────
  const send = useCallback(async () => {
    const content = input.trim();
    if ((!content && !attachment) || streaming != null) return;

    let activeSession = viewingSession;
    if (!activeSession) {
      try {
        const nextId = await ipc.newSession();
        await useStore.getState().loadSessions();
        await useStore.getState().loadWorkspacesWithSessions();
        useStore.getState().setCurrentSession(nextId);
        activeSession = nextId;
      } catch (e) {
        console.error('Failed to auto-create session', e);
        return;
      }
    }

    // /summarize [n] shortcut
    const sm = content.match(/^\/summarize(?:\s+(\d+))?$/i);
    if (sm) {
      setInput('');
      if (taRef.current) taRef.current.style.height = 'auto';
      await ipc.summarizeAll(sm[1] ? parseInt(sm[1], 10) : undefined).catch(console.error);
      return;
    }

    // #skill mentions auto-enable the skill before the stream starts, so the
    // backend injects its body into this message's system prompt.
    // Only #tokens at the start of the text or after whitespace count — a URL
    // fragment like site.com/#deploy must not enable a skill.
    const mentions = [...content.matchAll(/(?:^|\s)#([\w-]+)/g)].map((m) => m[1].toLowerCase());
    if (mentions.length > 0) {
      try {
        const allSkills = await ipc.listSkills();
        const toEnable = allSkills.filter(
          (s) => !s.enabled && mentions.includes(s.name.toLowerCase()),
        );
        if (toEnable.length > 0) {
          await Promise.all(toEnable.map((s) => ipc.setSkillEnabled(s.name, true)));
          useStore.getState().setSkills(await ipc.listSkills());
        }
      } catch (e) {
        console.error('failed to enable mentioned skills', e);
      }
    }

    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    const att = attachment;
    setAttachment(null);

    // @file mentions are cited, not inlined: tell the agent which workspace
    // files the user pointed at so it can read them with the file tool. Only
    // @tokens at the start or after whitespace count (so an email@host doesn't).
    const fileMentions = [...new Set(
      [...content.matchAll(/(?:^|\s)@(\S+)/g)].map((m) => m[1]),
    )];
    const fileNote = fileMentions.length > 0
      ? `${content ? '\n\n' : ''}[The user referenced these workspace files: ${fileMentions.join(', ')}. Read them with the file tool if relevant before answering.]`
      : '';

    const sentContent = content + fileNote + (att
      ? `${content || fileNote ? '\n\n' : ''}[The user attached an image at ${att.path}. Use the vision tool with this path to view it before answering.]`
      : '');

    addMessage(activeSession, { role: 'user', content, attachment: att ? { name: att.name, preview: att.preview } : undefined });
    setSendTick((t) => t + 1);
    setLoading(true);

    const buf: StreamSession = { thinking: '', parts: [], startedAt: Date.now() };
    streamsRef.current[activeSession] = buf;
    setStreamsBySession((prev) => ({ ...prev, [activeSession]: buf }));
    setStreamingSession(activeSession);
    useStore.getState().setAgentStatus(activeSession, 'running');

    try {
      const sessionId = await ipc.startChatStream(sentContent);
      setGitRefreshTick((t) => t + 1);
      if (sessionId && sessionId !== activeSession) {
        streamsRef.current[sessionId] = streamsRef.current[activeSession];
        delete streamsRef.current[activeSession];
        setStreamsBySession((prev) => { const n = { ...prev }; n[sessionId] = n[activeSession]; delete n[activeSession]; return n; });
        const fromMsgs = useStore.getState().messagesBySession[activeSession] ?? [];
        setMessages(sessionId, fromMsgs);
        setCurrentSession(sessionId);
      }
      setStreamingSession(sessionId ?? activeSession);
    } catch (e) {
      addMessage(activeSession, { role: 'assistant', content: `Error: ${String(e)}` });
      delete streamsRef.current[activeSession];
      setStreamsBySession((prev) => { const n = { ...prev }; delete n[activeSession]; return n; });
      setLoading(false);
      useStore.getState().setAgentStatus(activeSession, 'error');
    }
  }, [input, attachment, streaming, viewingSession]);

  const cancel = useCallback(async () => {
    const buf = streamsRef.current[viewingSession];
    if (!buf || buf.canceled) return;
    // Give immediate feedback: mark the stream as canceling (re-render so the
    // button switches to a spinner) and stop new content from appearing right
    // away. The buffer is kept until the backend confirms with stream_done —
    // finalizing early would let a stale done event from this turn clobber a
    // message the user might send during the unwind.
    const next = { ...buf, canceled: true };
    streamsRef.current[viewingSession] = next;
    setStreamsBySession((prev) => ({ ...prev, [viewingSession]: next }));
    useStore.getState().setAgentStatus(viewingSession, 'idle');
    await ipc.stopChatStream(viewingSession).catch(console.error);
  }, [viewingSession]);

  const clear = useCallback(async () => {
    await ipc.clearHistory().catch(console.error);
    setMessages(viewingSession, []);
  }, [viewingSession]);

  // ── QuestionCard ───────────────────────────────────────────────────────────
  const answerAsk = useCallback(async (answer: string) => {
    setPendingAsk(null);
    useStore.getState().setAgentStatus(viewingSession, 'running');
    await ipc.answerQuestion(answer).catch(console.error);
  }, [viewingSession]);

  const cancelAsk = useCallback(async () => {
    setPendingAsk(null);
    useStore.getState().setAgentStatus(viewingSession, 'idle');
    await ipc.stopChatStream(viewingSession).catch(console.error);
  }, [viewingSession]);

  // ── EditApprovalCard ────────────────────────────────────────────────────────
  const acceptEdit = useCallback(async () => {
    setPendingEdit(null);
    useStore.getState().setAgentStatus(viewingSession, 'running');
    await ipc.answerEditReview(true).catch(console.error);
  }, [viewingSession]);

  const rejectEdit = useCallback(async () => {
    setPendingEdit(null);
    useStore.getState().setAgentStatus(viewingSession, 'running');
    await ipc.answerEditReview(false).catch(console.error);
  }, [viewingSession]);

  // ── ToolConfirmCard ─────────────────────────────────────────────────────────
  const answerConfirm = useCallback(async (decision: 'reject' | 'once' | 'always') => {
    setPendingConfirm(null);
    useStore.getState().setAgentStatus(viewingSession, 'running');
    await ipc.answerToolConfirm(decision).catch(console.error);
  }, [viewingSession]);

  // ── Slash commands ─────────────────────────────────────────────────────────
  const showPalette = input.startsWith('/') && !input.includes(' ');
  const filteredCmds = showPalette ? COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase())) : [];

  // ── #skill mention autocomplete ────────────────────────────────────────────
  // Triggered by a "#token" being typed at the end of the draft (start of text
  // or after whitespace). Escape dismisses until the token changes again.
  const skills = useStore((s) => s.skills);
  const mentionMatch = !showPalette ? input.match(/(^|\s)#([\w-]*)$/) : null;
  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null;
  useEffect(() => setMentionDismissed(false), [mentionQuery]);
  const filteredSkills: SkillSummary[] =
    mentionQuery != null && !mentionDismissed
      ? skills.filter((s) => s.name.toLowerCase().startsWith(mentionQuery))
      : [];
  // Once the mention is fully typed there is nothing left to complete —
  // close the palette so Enter sends instead of re-inserting the name.
  const showSkillPalette =
    filteredSkills.length > 0 &&
    !(filteredSkills.length === 1 && filteredSkills[0].name.toLowerCase() === mentionQuery);

  const pickSkill = useCallback(
    (s: SkillSummary) => {
      setInput(input.replace(/#[\w-]*$/, `#${s.name} `));
      setCmdSelected(0);
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [input, setInput],
  );

  // ── @file mention autocomplete ─────────────────────────────────────────────
  // Triggered by an "@token" at the end of the draft (start of text or after
  // whitespace). Paths contain '/', '.', '-', so the token is any non-space run.
  // Results come from a debounced fuzzy search over the selected folder.
  const [fileHits, setFileHits] = useState<FileHit[]>([]);
  const [fileDismissed, setFileDismissed] = useState(false);
  const fileMatch = !showPalette && !showSkillPalette ? input.match(/(^|\s)@(\S*)$/) : null;
  const fileQuery = fileMatch ? fileMatch[2] : null;
  useEffect(() => setFileDismissed(false), [fileQuery]);
  useEffect(() => {
    if (fileQuery == null) { setFileHits([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      ipc.searchWorkspaceFiles(fileQuery, 20)
        .then((hits) => { if (alive) setFileHits(hits); })
        .catch(() => { if (alive) setFileHits([]); });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [fileQuery]);
  const showFilePalette = fileQuery != null && !fileDismissed && fileHits.length > 0;

  const pickFile = useCallback(
    (f: FileHit) => {
      setInput(input.replace(/@\S*$/, `@${f.path} `));
      setCmdSelected(0);
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [input, setInput],
  );

  const cmdContext: CommandContext = {
    clear,
    tools: async () => {
      const tools = await ipc.listTools().catch(() => []);
      addMessage(viewingSession, {
        role: 'assistant',
        content: `**Tools** (${tools.length})\n\n${tools.map((t) => `- \`${t.name}\` — ${t.description}`).join('\n')}`,
      });
    },
    workspace: () => pickWorkspace(viewingSession),
    summarize: async (concurrency?: number) => { await ipc.summarizeAll(concurrency).catch(console.error); },
    scan: async () => {
      const t0 = performance.now();
      setScanning(true);
      try {
        await ipc.scanWorkspace().catch(console.error);
        setGraphNodes(await ipc.getGraph().catch(() => []));
      } finally {
        const left = MIN_SCAN_MS - (performance.now() - t0);
        if (left > 0) await new Promise((r) => setTimeout(r, left));
        setScanning(false);
      }
    },
  };

  const runCommand = useCallback((c: SlashCommand) => {
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    setCmdSelected(0);
    c.run(cmdContext);
  }, [cmdContext]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPalette && filteredCmds.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdSelected((i) => (i + 1) % filteredCmds.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCmdSelected((i) => (i - 1 + filteredCmds.length) % filteredCmds.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); runCommand(filteredCmds[Math.min(cmdSelected, filteredCmds.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setInput(''); return; }
    }
    if (showSkillPalette) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdSelected((i) => (i + 1) % filteredSkills.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCmdSelected((i) => (i - 1 + filteredSkills.length) % filteredSkills.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSkill(filteredSkills[Math.min(cmdSelected, filteredSkills.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionDismissed(true); return; }
    }
    if (showFilePalette) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdSelected((i) => (i + 1) % fileHits.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCmdSelected((i) => (i - 1 + fileHits.length) % fileHits.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickFile(fileHits[Math.min(cmdSelected, fileHits.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setFileDismissed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [showPalette, filteredCmds, cmdSelected, runCommand, send, showSkillPalette, filteredSkills, pickSkill, showFilePalette, fileHits, pickFile]);

  const autosize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const liveContentLen = streaming ? streaming.parts.reduce((n, p) => n + (p.type === 'content' ? (p.text?.length ?? 0) : 0), 0) : 0;
  const liveTokens = streaming ? Math.round((streaming.thinking.length + liveContentLen) / 4) : 0;

  // ── Transcript view ────────────────────────────────────────────────────────
  if (transcriptOpen) return <TranscriptView />;

  // ── Computed messages (group tools, pass through thinking/canceled/msg) ─────
  const rendered: RenderedItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'tool') {
      const group = [msg.content];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') { group.push(messages[j].content); j++; }
      rendered.push({ type: 'tools', tools: group, key: `tools-${i}` });
      i = j - 1;
    } else if (msg.role === 'thinking') {
      rendered.push({ type: 'thinking', msg, key: `think-${i}` });
    } else if (msg.role === 'canceled') {
      rendered.push({ type: 'canceled', key: `cancel-${i}` });
    } else {
      rendered.push({ type: 'msg', msg, key: `msg-${i}` });
    }
  }

  // ── Footer (QuestionCard, SummarizeBanner, GitContext, Composer) ──────────
  return (
    <div style={styles.root}>
      <MessageList
        renderedMessages={rendered}
        hoveredKey={hoveredKey}
        setHoveredKey={setHoveredKey}
        streaming={streaming}
        elapsed={elapsed}
        liveTokens={liveTokens}
        liveContentLen={liveContentLen}
        prefs={prefs}
        StreamStatus={StreamStatus}
        scrollToBottomSignal={sendTick}
      />

      {/* Footer — QuestionCard, SummarizeBanner, GitContext, Composer */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: '0 0 8px', background: 'inherit' }}>
        <div style={styles.composerFade} />
        <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pendingAsk && (streamingSession == null || streamingSession === viewingSession) && (
            <QuestionCard questions={pendingAsk} onAnswer={answerAsk} onCancel={cancelAsk} />
          )}
          {pendingEdit && pendingEdit.session_id === viewingSession && (
            <EditApprovalCard request={pendingEdit} onAccept={acceptEdit} onReject={rejectEdit} />
          )}
          {pendingConfirm && pendingConfirm.session_id === viewingSession && (
            <ToolConfirmCard request={pendingConfirm} onDecision={answerConfirm} />
          )}
          {summarize && (
            <SummarizeBanner
              done={summarize.done} total={summarize.total} failed={summarize.failed}
              finished={summarize.finished} startedAt={summarize.startedAt}
              onCancel={() => ipc.stopSummarize().catch(console.error)}
            />
          )}
          <GitContext onPickWorkspace={() => pickWorkspace(viewingSession)} refreshTick={gitRefreshTick} />
          <Composer
            input={input}
            setInput={setInput}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            send={send}
            cancel={cancel}
            clear={clear}
            attachment={attachment}
            setAttachment={setAttachment}
            attachImage={attachImage}
            fileInputRef={fileInputRef}
            taRef={taRef}
            isLoading={streaming != null}
            canceling={streaming?.canceled ?? false}
            onDrop={onDrop}
            autosize={autosize}
            showPalette={showPalette}
            filteredCmds={filteredCmds}
            cmdSelected={cmdSelected}
            setCmdSelected={setCmdSelected}
            runCommand={runCommand}
            CommandPalette={CommandPalette}
            showSkillPalette={showSkillPalette}
            filteredSkills={filteredSkills}
            skillSelected={cmdSelected}
            pickSkill={pickSkill}
            showFilePalette={showFilePalette}
            fileHits={fileHits}
            fileSelected={cmdSelected}
            pickFile={pickFile}
          />
          <SkillDock workspaceRoot={workspaceRoot} />
        </div>
      </div>
    </div>
  );
}