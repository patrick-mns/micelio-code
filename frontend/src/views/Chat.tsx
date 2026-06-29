import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import MessageList from '@/components/MessageList';
import Composer from '@/components/Composer';
import StreamStatus from '@/components/StreamStatus';
import QuestionCard, { parseQuestions } from '@/components/QuestionCard';
import GitContext from '@/components/GitContext';
import SummarizeBanner from '@/components/SummarizeBanner';
import TranscriptView from '@/components/TranscriptView';
import CommandPalette from '@/components/CommandPalette';
import { useWorkspace } from '@/hooks/useWorkspace';
import { COMMANDS, type Attachment, type CommandContext, type ChatMessageView, type RenderedItem, type SlashCommand } from '@/utils/chatHelpers';
import { MIN_SCAN_MS } from '@/utils/treemapHelpers';
import { chatStyles as styles } from '@/utils/theme-styles';
import type { StreamPart, StreamState } from '@/components/StreamStatus';
import type { Question } from '@/components/QuestionCard';
import type { Usage } from '@/types';

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
    prefs, transcriptOpen,
  } = useStore();

  const { pickWorkspace } = useWorkspace();

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
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [summarize, setSummarize] = useState<SummarizeState | null>(null);
  const [cmdSelected, setCmdSelected] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [gitRefreshTick, setGitRefreshTick] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
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

    ipc.onStreamContent(({ session_id, delta }) => pushTo(session_id, 'content', delta));
    ipc.onStreamThinking(({ session_id, delta }) => pushTo(session_id, 'thinking', delta));
    ipc.onStreamTool(({ session_id, summary }) => pushTo(session_id, 'tools', summary));
    ipc.onStreamDone(({ session_id }) => finishStream(session_id));
    ipc.onStreamError(({ session_id, error }) => errorStream(session_id, error));
    ipc.onAskUser(({ session_id, args }) => {
      const qs = parseQuestions(args);
      if (qs.length) setPendingAsk(qs);
    });
    ipc.onStreamUsage(({ session_id, ...u }) => {
      if (streamsRef.current[session_id]) streamsRef.current[session_id].usage = u;
    });
  }, []);

  function pushTo(sessionId: string, key: 'content' | 'thinking' | 'tools', chunk: string) {
    const cur = streamsRef.current[sessionId];
    if (!cur) return;
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

  function finishStream(sessionId: string) {
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
    store.setStreamingSession(null);
    store.setLoading(false);
  }

  function errorStream(sessionId: string, msg: string) {
    const store = useStore.getState();
    store.addMessage(sessionId, { role: 'assistant', content: `Error: ${msg}` });
    delete streamsRef.current[sessionId];
    setStreamsBySession((prev) => { const n = { ...prev }; delete n[sessionId]; return n; });
    store.setLoading(false);
  }

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - streaming.startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [!!streaming]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledAway = useRef(false);

  // Detect user scroll: if they scroll up, stop forcing scroll.
  // When they scroll all the way down, re-enable it.
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom > 100) {
      userScrolledAway.current = true;
    } else {
      userScrolledAway.current = false;
    }
  }, []);

  useEffect(() => {
    if (!userScrolledAway.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streaming]);

  // ── Image attachment ───────────────────────────────────────────────────────
  const attachImage = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      const b64 = dataUrl.split(',')[1] || '';
      const ext = file.name?.split('.').pop() || file.type.split('/')[1] || 'png';
      const name = file.name || `image.${ext}`;
      try {
        const path = await ipc.saveAttachment(b64, ext);
        setAttachment({ path, name, preview: dataUrl });
      } catch (e) { console.error('attach failed', e); }
    };
    reader.readAsDataURL(file);
  }, []);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); attachImage(item.getAsFile()); }
  }, [attachImage]);

  const onDrop = useCallback((e: React.DragEvent) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); attachImage(file); }
  }, [attachImage]);

  // ── Send / Cancel / Clear ──────────────────────────────────────────────────
  const send = useCallback(async () => {
    const content = input.trim();
    if ((!content && !attachment) || streaming != null) return;

    // /summarize [n] shortcut
    const sm = content.match(/^\/summarize(?:\s+(\d+))?$/i);
    if (sm) {
      setInput('');
      if (taRef.current) taRef.current.style.height = 'auto';
      await ipc.summarizeAll(sm[1] ? parseInt(sm[1], 10) : undefined).catch(console.error);
      return;
    }

    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    const att = attachment;
    setAttachment(null);

    const sentContent = content + (att
      ? `${content ? '\n\n' : ''}[The user attached an image at ${att.path}. Use the vision tool with this path to view it before answering.]`
      : '');

    addMessage(viewingSession, { role: 'user', content, attachment: att ? { name: att.name, preview: att.preview } : undefined });
    setLoading(true);

    const buf: StreamSession = { thinking: '', parts: [], startedAt: Date.now() };
    streamsRef.current[viewingSession] = buf;
    setStreamsBySession((prev) => ({ ...prev, [viewingSession]: buf }));
    setStreamingSession(viewingSession);

    try {
      const sessionId = await ipc.startChatStream(sentContent);
      setGitRefreshTick((t) => t + 1);
      if (sessionId && sessionId !== viewingSession) {
        streamsRef.current[sessionId] = streamsRef.current[viewingSession];
        delete streamsRef.current[viewingSession];
        setStreamsBySession((prev) => { const n = { ...prev }; n[sessionId] = n[viewingSession]; delete n[viewingSession]; return n; });
        const fromMsgs = useStore.getState().messagesBySession[viewingSession] ?? [];
        setMessages(sessionId, fromMsgs);
        setCurrentSession(sessionId);
      }
      setStreamingSession(sessionId ?? viewingSession);
    } catch (e) {
      addMessage(viewingSession, { role: 'assistant', content: `Error: ${String(e)}` });
      delete streamsRef.current[viewingSession];
      setStreamsBySession((prev) => { const n = { ...prev }; delete n[viewingSession]; return n; });
      setLoading(false);
    }
  }, [input, attachment, streaming, viewingSession]);

  const cancel = useCallback(async () => {
    if (streamsRef.current[viewingSession]) streamsRef.current[viewingSession].canceled = true;
    await ipc.stopChatStream().catch(console.error);
  }, [viewingSession]);

  const clear = useCallback(async () => {
    await ipc.clearHistory().catch(console.error);
    setMessages(viewingSession, []);
  }, [viewingSession]);

  // ── QuestionCard ───────────────────────────────────────────────────────────
  const answerAsk = useCallback(async (answer: string) => {
    setPendingAsk(null);
    await ipc.answerQuestion(answer).catch(console.error);
  }, []);

  const cancelAsk = useCallback(async () => {
    setPendingAsk(null);
    await ipc.stopChatStream().catch(console.error);
  }, []);

  // ── Slash commands ─────────────────────────────────────────────────────────
  const showPalette = input.startsWith('/') && !input.includes(' ');
  const filteredCmds = showPalette ? COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase())) : [];

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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [showPalette, filteredCmds, cmdSelected, runCommand, send]);

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
        messages={messages}
        renderedMessages={rendered}
        hoveredKey={hoveredKey}
        setHoveredKey={setHoveredKey}
        bottomRef={bottomRef}
        scrollRef={scrollContainerRef}
        onScroll={handleScroll}
        streaming={streaming}
        elapsed={elapsed}
        liveTokens={liveTokens}
        liveContentLen={liveContentLen}
        prefs={prefs}
        StreamStatus={StreamStatus}
      />

      {/* Footer — QuestionCard, SummarizeBanner, GitContext, Composer */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: '0 0 28px', background: 'inherit' }}>
        <div style={styles.composerFade} />
        <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pendingAsk && (streamingSession == null || streamingSession === viewingSession) && (
            <QuestionCard questions={pendingAsk} onAnswer={answerAsk} onCancel={cancelAsk} />
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
            onDrop={onDrop}
            autosize={autosize}
            showPalette={showPalette}
            filteredCmds={filteredCmds}
            cmdSelected={cmdSelected}
            setCmdSelected={setCmdSelected}
            runCommand={runCommand}
            CommandPalette={CommandPalette}
          />
        </div>
      </div>
    </div>
  );
}