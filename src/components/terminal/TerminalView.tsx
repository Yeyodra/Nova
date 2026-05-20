import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { Terminal, X, Maximize2, Minimize2, ChevronDown } from 'lucide-react';
import { useTerminalStore } from '@/stores/useTerminalStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { TerminalViewport } from './TerminalViewport';
import { ShellPicker } from './ShellPicker';
import type { ShellInfo } from '@/types/shell';

export function TerminalView() {
  const { tabs, activeTabId, createTab, setActiveTab, setTabSessionId, setTabLifecycle } =
    useTerminalStore();
  const isFullscreen = useLayoutStore((s) => s.bottomPanelFullscreen);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [defaultShellId, setDefaultShellId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      invoke<ShellInfo[]>('get_available_shells'),
      invoke<string | null>('get_default_shell'),
    ]).then(([shellsResult, defaultId]) => {
      setShells(shellsResult);
      if (defaultId && shellsResult.some((s) => s.id === defaultId)) {
        setDefaultShellId(defaultId);
      } else if (shellsResult.length > 0) {
        setDefaultShellId(shellsResult[0].id);
      }
    }).catch(console.error);
  }, []);

  const handleCreateTab = useCallback((shell?: ShellInfo) => {
    const tabId = createTab(shell);

    // Delay terminal session creation to let TerminalViewport mount and get dimensions
    setTimeout(async () => {
      // Read fresh project path from store (not from stale closure)
      const { projects, activeProjectId } = useProjectStore.getState();
      const project = projects.find((p) => p.id === activeProjectId);
      const cwd = project?.path || null;

      try {
        const sessionId = await invoke<string>('create_terminal', {
          cwd,
          cols: 80,
          rows: 24,
          shell: shell?.path || null,
          shellId: shell?.id || null,
        });
        setTabSessionId(tabId, sessionId);
        setTabLifecycle(tabId, 'running');
      } catch (err) {
        console.error('Failed to create terminal:', err);
        setTabLifecycle(tabId, 'exited');
      }
    }, 150);
  }, [createTab, setTabSessionId, setTabLifecycle]);

  const handleCreateDefault = useCallback(() => {
    const defaultShell = shells.find((s) => s.id === defaultShellId) || shells[0];
    handleCreateTab(defaultShell);
  }, [shells, defaultShellId, handleCreateTab]);

  const handleSelectShell = useCallback((shell: ShellInfo) => {
    handleCreateTab(shell);
  }, [handleCreateTab]);

  const handleSetDefault = useCallback((shell: ShellInfo) => {
    setDefaultShellId(shell.id);
    invoke('set_default_shell', { shellId: shell.id }).catch(console.error);
  }, []);

  const bottomPanelOpen = useLayoutStore((s) => s.bottomPanelOpen);

  // Auto-create first tab when dock opens with no tabs
  const hasInitializedRef = useRef(false);
  
  useEffect(() => {
    // Only auto-create once per panel open cycle
    if (!bottomPanelOpen) {
      // Reset when panel closes so next open creates a tab
      hasInitializedRef.current = false;
      return;
    }
    if (hasInitializedRef.current) return;
    if (tabs.length > 0) {
      // Already have tabs, mark as initialized
      hasInitializedRef.current = true;
      return;
    }
    // Panel just opened with no tabs — create one
    hasInitializedRef.current = true;
    handleCreateTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomPanelOpen]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      console.log('[TerminalView] handleCloseTab called with tabId:', tabId);
      const currentTabs = useTerminalStore.getState().tabs;
      const tab = currentTabs.find((t) => t.id === tabId);
      
      // Close tab from UI immediately (don't wait for backend kill)
      useTerminalStore.getState().closeTab(tabId);
      console.log('[TerminalView] closeTab done, remaining tabs:', useTerminalStore.getState().tabs.length);

      // Fire-and-forget: kill the PTY session in the background
      if (tab?.sessionId) {
        console.log('[TerminalView] killing session (fire-and-forget):', tab.sessionId);
        invoke('kill_terminal', { sessionId: tab.sessionId }).catch((err) => {
          console.warn('[TerminalView] kill_terminal failed:', err);
        });
      }
    },
    [],
  );

  const handleData = useCallback(
    (tabId: string) => (data: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab?.sessionId) {
        const encoder = new TextEncoder();
        const bytes = Array.from(encoder.encode(data));
        invoke('write_terminal', { sessionId: tab.sessionId, data: bytes }).catch(console.error);
      }
    },
    [tabs],
  );

  const handleResize = useCallback(
    (tabId: string) => (cols: number, rows: number) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab?.sessionId) {
        invoke('resize_terminal', { sessionId: tab.sessionId, cols, rows }).catch(console.error);
      }
    },
    [tabs],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-2">
        {/* Left: tabs */}
        <div className="flex items-center gap-0.5 overflow-x-auto py-1">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'group relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors cursor-pointer select-none',
                tab.id === activeTabId
                  ? 'bg-[var(--hover-bg-strong)] text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text)]'
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {/* Terminal icon */}
              <Terminal className="h-3.5 w-3.5 shrink-0" />
              {/* Label */}
              <span className="truncate max-w-[100px]">{tab.label}</span>
              {/* Close button — visible on hover or when active */}
              <button
                className={cn(
                  'ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm transition-opacity',
                  'hover:bg-[var(--hover-bg-strong)]',
                  tab.id === activeTabId
                    ? 'opacity-60 hover:opacity-100'
                    : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  console.log('[TerminalView] X button clicked for tab:', tab.id);
                  handleCloseTab(tab.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-0.5 ml-auto pl-2">
          <ShellPicker
            shells={shells}
            defaultShellId={defaultShellId}
            onCreateDefault={handleCreateDefault}
            onSelectShell={handleSelectShell}
            onSetDefault={handleSetDefault}
          />
          {/* Fullscreen toggle */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg-strong)] hover:text-[var(--text)] transition-colors"
            onClick={() => useLayoutStore.getState().toggleBottomPanelFullscreen()}
            title={isFullscreen ? "Restore terminal" : "Maximize terminal"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          {/* Close dock */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--hover-bg-strong)] hover:text-[var(--text)] transition-colors"
            onClick={() => useLayoutStore.getState().toggleBottomPanel()}
            title="Close terminal"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal viewports — always render container, overlay message when empty */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)] z-20">
            No terminal open
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'absolute inset-0',
              tab.id === activeTabId ? 'z-10 visible' : 'z-0 invisible'
            )}
          >
            <TerminalViewport
              sessionId={tab.sessionId}
              onData={handleData(tab.id)}
              onResize={handleResize(tab.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
