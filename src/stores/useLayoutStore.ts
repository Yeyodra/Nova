import { create } from 'zustand';

export type PanelPosition = 'left' | 'right' | 'bottom';
export type PanelType = 'file-tree' | 'git' | 'search' | 'code-review' | 'terminal' | 'none';

interface LayoutState {
  // Left sidebar
  leftSidebarOpen: boolean;
  leftSidebarWidth: number;
  leftPanel: PanelType;
  setLeftPanel: (panel: PanelType) => void;
  toggleLeftSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  
  // Right sidebar
  rightSidebarOpen: boolean;
  rightSidebarWidth: number;
  rightPanel: PanelType;
  setRightPanel: (panel: PanelType) => void;
  toggleRightSidebar: () => void;
  setRightSidebarWidth: (width: number) => void;
  
  // Bottom panel
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  bottomPanelFullscreen: boolean;
  bottomPanel: PanelType;
  setBottomPanel: (panel: PanelType) => void;
  toggleBottomPanel: () => void;
  setBottomPanelHeight: (height: number) => void;
  toggleBottomPanelFullscreen: () => void;
  
  // Editor
  editorVisible: boolean;
  setEditorVisible: (visible: boolean) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  // Left sidebar (File Tree)
  leftSidebarOpen: true,
  leftSidebarWidth: 250,
  leftPanel: 'file-tree',
  setLeftPanel: (panel) => set({ leftPanel: panel, leftSidebarOpen: panel !== 'none' }),
  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  setLeftSidebarWidth: (width) => set({ leftSidebarWidth: width }),
  
  // Right sidebar (Git, Search, Code Review)
  rightSidebarOpen: false,
  rightSidebarWidth: 300,
  rightPanel: 'none',
  setRightPanel: (panel) => set({ rightPanel: panel, rightSidebarOpen: panel !== 'none' }),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
  
  // Bottom panel (Terminal)
  bottomPanelOpen: false,
  bottomPanelHeight: 250,
  bottomPanelFullscreen: false,
  bottomPanel: 'none',
  setBottomPanel: (panel) => set({ bottomPanel: panel, bottomPanelOpen: panel !== 'none' }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelHeight: (height) => set({ bottomPanelHeight: height }),
  toggleBottomPanelFullscreen: () => set((s) => ({ bottomPanelFullscreen: !s.bottomPanelFullscreen })),
  
  // Editor
  editorVisible: false,
  setEditorVisible: (visible) => set({ editorVisible: visible }),
}));
