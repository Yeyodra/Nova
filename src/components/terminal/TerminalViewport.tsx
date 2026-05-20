import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getTerminalTheme } from '@/lib/terminalTheme';
import { useLayoutStore } from '@/stores/useLayoutStore';
import '@xterm/xterm/css/xterm.css';

interface PtyOutputPayload {
  sessionId: string;
  data: number[];
}

interface PtyExitPayload {
  sessionId: string;
  exitCode: number | null;
}

interface TerminalViewportProps {
  sessionId: string | null;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

export function TerminalViewport({ sessionId, onData, onResize }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const openedRef = useRef(false);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const isVisible = useLayoutStore((s) => s.bottomPanelOpen);

  // Keep refs in sync with latest callbacks
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  // Initialize terminal on mount — separate creation from open()
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      theme: getTerminalTheme(),
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      lineHeight: 1.4,
      letterSpacing: 0,
      scrollback: 5000,
      allowTransparency: false,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.onData((data) => {
      onDataRef.current(data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    openedRef.current = false;

    // Use ResizeObserver to detect when container has dimensions, then open
    const container = containerRef.current;
    const initObserver = new ResizeObserver(() => {
      if (openedRef.current) return;
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        openedRef.current = true;
        terminal.open(container);
        try {
          fitAddon.fit();
          onResizeRef.current(terminal.cols, terminal.rows);
        } catch {
          // ignore fit errors on first open
        }
        initObserver.disconnect();
      }
    });
    initObserver.observe(container);

    // Also try immediately in case container already has dimensions
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      openedRef.current = true;
      terminal.open(container);
      try {
        fitAddon.fit();
        onResizeRef.current(terminal.cols, terminal.rows);
      } catch {
        // ignore
      }
      initObserver.disconnect();
    }

    return () => {
      initObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      openedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manage ResizeObserver based on dock visibility
  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const container = containerRef.current;
    if (!terminal || !fitAddon || !container || !openedRef.current) return;

    if (isVisible) {
      // Dock just became visible — fit after a brief delay for layout
      const fitTimer = setTimeout(() => {
        try {
          if (container.clientWidth > 0 && container.clientHeight > 0 && terminal.element) {
            fitAddon.fit();
            onResizeRef.current(terminal.cols, terminal.rows);
          }
        } catch {
          // ignore
        }
      }, 50);

      // Start observing resize
      const observer = new ResizeObserver(() => {
        if (!openedRef.current || !terminal.element) return;
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          try {
            fitAddon.fit();
            onResizeRef.current(terminal.cols, terminal.rows);
          } catch {
            // ignore
          }
        }
      });
      observer.observe(container);
      resizeObserverRef.current = observer;

      return () => {
        clearTimeout(fitTimer);
        observer.disconnect();
        resizeObserverRef.current = null;
      };
    } else {
      // Dock is hidden — disconnect observer to prevent 0x0 corruption
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      return undefined;
    }
  }, [isVisible]);

  // Listen to Tauri PTY events
  useEffect(() => {
    if (!sessionId || !terminalRef.current) return;

    const terminal = terminalRef.current;
    const unlisteners: UnlistenFn[] = [];

    const setupListeners = async () => {
      const unlistenOutput = await listen<PtyOutputPayload>('pty-output', (event) => {
        const payload = event.payload;
        if (payload.sessionId === sessionId) {
          terminal.write(new Uint8Array(payload.data));
        }
      });
      unlisteners.push(unlistenOutput);

      const unlistenExit = await listen<PtyExitPayload>('pty-exit', (event) => {
        const payload = event.payload;
        if (payload.sessionId === sessionId) {
          const code = payload.exitCode !== null ? payload.exitCode : 'unknown';
          terminal.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
        }
      });
      unlisteners.push(unlistenExit);
    };

    setupListeners();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full p-1" />;
}
