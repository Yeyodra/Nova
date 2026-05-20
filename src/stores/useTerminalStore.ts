import { create } from 'zustand';
import type { ShellInfo } from '@/types/shell';

export interface TerminalTab {
  id: string;
  label: string;
  sessionId: string | null;
  lifecycle: 'starting' | 'running' | 'exited';
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  createTab: (shell?: ShellInfo) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabSessionId: (tabId: string, sessionId: string) => void;
  setTabLifecycle: (tabId: string, lifecycle: TerminalTab['lifecycle']) => void;
}

let tabCounter = 0;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  createTab: (shell?: ShellInfo) => {
    tabCounter += 1;
    const id = `term-${tabCounter}-${Date.now()}`;
    const label = shell?.name || `Terminal ${tabCounter}`;
    const tab: TerminalTab = {
      id,
      label,
      sessionId: null,
      lifecycle: 'starting',
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (tabId: string) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);
    let newActiveId = activeTabId;

    if (activeTabId === tabId) {
      if (newTabs.length === 0) {
        newActiveId = null;
      } else if (idx >= newTabs.length) {
        newActiveId = newTabs[newTabs.length - 1].id;
      } else {
        newActiveId = newTabs[idx].id;
      }
    }

    set({ tabs: newTabs, activeTabId: newActiveId });
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
  },

  setTabSessionId: (tabId: string, sessionId: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, sessionId } : t
      ),
    }));
  },

  setTabLifecycle: (tabId: string, lifecycle: TerminalTab['lifecycle']) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, lifecycle } : t
      ),
    }));
  },
}));
