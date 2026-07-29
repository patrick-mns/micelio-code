// A real shell in a dock tab, rendered by xterm.js over a pty the backend owns.
//
// The split matters: this component is disposable and the session isn't. A dock
// renders only its showing tab, so switching tabs unmounts this — the shell,
// its scrollback, and anything running in it live in Rust, and a remount
// re-attaches to what was already there. Closing the *tab* is what kills the
// shell (App.tsx), which is why nothing here tears the session down.
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ipc } from '@/ipc';
import { useI18n } from '@/i18n';
import { terminalPanelStyles as styles } from '@/utils/theme-styles';

const FONT_STACK = 'ui-monospace, SFMono-Regular, monospace';

// xterm paints to a canvas, so it needs resolved colors — CSS variables can't
// reach it. Read the tokens off the document instead of duplicating the
// palette here, so the terminal follows the theme (and every variant) for free.
function themeFromTokens(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v('--color-bg-deep'),
    foreground: v('--color-text'),
    cursor: v('--term-cursor'),
    cursorAccent: v('--color-bg-deep'),
    selectionBackground: v('--term-selection'),
    black: v('--term-black'),
    red: v('--term-red'),
    green: v('--term-green'),
    yellow: v('--term-yellow'),
    blue: v('--term-blue'),
    magenta: v('--term-magenta'),
    cyan: v('--term-cyan'),
    white: v('--term-white'),
    brightBlack: v('--term-bright-black'),
    brightRed: v('--term-bright-red'),
    brightGreen: v('--term-bright-green'),
    brightYellow: v('--term-bright-yellow'),
    brightBlue: v('--term-bright-blue'),
    brightMagenta: v('--term-bright-magenta'),
    brightCyan: v('--term-bright-cyan'),
    brightWhite: v('--term-bright-white'),
  };
}

const decode = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

interface TerminalPanelProps {
  /** The dock tab's id, which is also the session's — one tab, one shell. */
  id: string;
  /** Folder to start the shell in; omitted means the selected one. */
  cwd?: string | null;
}

export default function TerminalPanel({ id, cwd }: TerminalPanelProps) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [exit, setExit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const term = new Terminal({
      fontFamily: FONT_STACK,
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      // Backend scrollback is for replay after a tab switch; this is the
      // buffer the user actually scrolls, and it's cheap to be generous.
      scrollback: 10_000,
      allowProposedApi: true,
      theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;

    // Output arriving before the replay has been written would land in the
    // wrong order, so it's parked until then. The backend clears its pending
    // queue as it hands over the scrollback, so nothing here is a duplicate of
    // what the replay already contains.
    let replayed = false;
    const parked: Uint8Array[] = [];
    const writeOut = (data: string) => {
      // Detaching a listener is async, so one more event can still land after
      // the cleanup ran — and writing to a disposed terminal throws.
      if (disposed) return;
      const bytes = decode(data);
      if (replayed) term.write(bytes);
      else parked.push(bytes);
    };

    const sized = () => {
      try {
        fit.fit();
      } catch {
        // fit() throws while the pane has no layout yet (opening animation);
        // the ResizeObserver fires again once it does.
      }
      return { cols: term.cols, rows: term.rows };
    };

    // Listeners go up before the attach so the window between "session exists"
    // and "we're listening" can't drop output.
    const unlisteners = [
      ipc.onPtyOutput((p) => { if (p.id === id) writeOut(p.data); }),
      ipc.onPtyExit((p) => { if (p.id === id && !disposed) setExit(p.code); }),
    ];

    const { cols, rows } = sized();
    ipc.ptyOpen(id, cols, rows, cwd)
      .then((snapshot) => {
        if (disposed) return;
        if (snapshot) term.write(decode(snapshot));
        replayed = true;
        for (const chunk of parked) term.write(chunk);
        parked.length = 0;
        term.focus();
        // The exit event fires once. A tab reopened after its shell died would
        // never see it, so the state is confirmed rather than assumed.
        ipc.ptyIsAlive(id).then((alive) => { if (!alive && !disposed) setExit(0); });
      })
      .catch((e) => { if (!disposed) setError(String(e)); });

    const typed = term.onData((data) => {
      ipc.ptyWrite(id, data).catch(() => {});
    });

    // Full-screen programs lay out to the size the shell was told about, so
    // every geometry change has to reach the pty.
    const observer = new ResizeObserver(() => {
      const next = sized();
      ipc.ptyResize(id, next.cols, next.rows).catch(() => {});
    });
    observer.observe(host);

    // The theme is read once into canvas colors, so a change has to be pushed
    // back in. Watching the attributes rather than the store catches the
    // 'system' preference flipping with the OS, which never touches the store.
    const themeWatcher = new MutationObserver(() => {
      term.options.theme = themeFromTokens();
    });
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-variant', 'data-accent'],
    });

    return () => {
      disposed = true;
      observer.disconnect();
      themeWatcher.disconnect();
      typed.dispose();
      unlisteners.forEach((p) => p.then((un) => un()).catch(() => {}));
      term.dispose();
      termRef.current = null;
      // Deliberately no ptyClose: unmounting is a tab switch, not a close.
    };
  }, [id, cwd]);

  // Cmd-K / Ctrl-Shift-K, the clear-screen binding terminals already use. Bare
  // Ctrl-K is off limits — that's readline's kill-to-end-of-line, and the
  // shell is entitled to it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const clear = e.key.toLowerCase() === 'k' && (e.metaKey || (e.ctrlKey && e.shiftKey));
    if (!clear) return;
    e.preventDefault();
    termRef.current?.clear();
  };

  return (
    <div style={styles.panel} onKeyDown={onKeyDown}>
      {error ? (
        <div style={styles.error}>{error}</div>
      ) : (
        <>
          {/* The frame carries the padding and border; the host stays a bare
              box so the fit addon's measurement of it is exact. */}
          <div style={styles.frame}>
            <div ref={hostRef} style={styles.host} />
          </div>
          {exit !== null && (
            // The tab stays after the shell is gone — whatever it printed on
            // the way out is usually the reason you'd look.
            <div style={styles.exited}>{t('terminal.exited')} ({exit})</div>
          )}
        </>
      )}
    </div>
  );
}
