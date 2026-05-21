import { create } from 'zustand';
import type { CompareSession, CompareColumn, CompareMessage } from '@/types/compare';

const MAX_MODELS = 3;

interface CompareStoreState {
  // Session state
  activeCompareSessionId: string | null;
  compareSessions: CompareSession[];

  // Column state (per-model)
  columns: CompareColumn[];

  // Shared input
  selectedModelIds: string[]; // max 3

  // Actions
  setActiveCompareSession: (id: string | null) => void;
  setCompareSessions: (sessions: CompareSession[]) => void;
  addCompareSession: (session: CompareSession) => void;
  removeCompareSession: (id: string) => void;

  setSelectedModels: (modelIds: string[]) => void;
  addModel: (modelId: string) => boolean; // false if at max (3)
  removeModel: (modelId: string) => void;

  setColumns: (columns: CompareColumn[]) => void;
  appendColumnToken: (modelId: string, token: string) => void;
  setColumnError: (modelId: string, error: string) => void;
  setColumnStreaming: (modelId: string, streaming: boolean) => void;
  appendUserMessage: (content: string) => void;
  appendAssistantMessage: (modelId: string, content: string) => void;
  clearColumns: () => void;

  isAnyStreaming: () => boolean;
}

export const useCompareStore = create<CompareStoreState>((set, get) => ({
  activeCompareSessionId: null,
  compareSessions: [],
  columns: [],
  selectedModelIds: [],

  setActiveCompareSession: (id) => {
    set({ activeCompareSessionId: id });
  },

  setCompareSessions: (sessions) => {
    set({ compareSessions: sessions });
  },

  addCompareSession: (session) => {
    set((state) => ({
      compareSessions: [...state.compareSessions, session],
    }));
  },

  removeCompareSession: (id) => {
    set((state) => ({
      compareSessions: state.compareSessions.filter((s) => s.id !== id),
    }));
  },

  setSelectedModels: (modelIds) => {
    set({ selectedModelIds: modelIds.slice(0, MAX_MODELS) });
  },

  addModel: (modelId) => {
    const { selectedModelIds } = get();
    if (selectedModelIds.length >= MAX_MODELS) {
      return false;
    }
    set({ selectedModelIds: [...selectedModelIds, modelId], columns: [] });
    return true;
  },

  removeModel: (modelId) => {
    set((state) => ({
      selectedModelIds: state.selectedModelIds.filter((id) => id !== modelId),
      columns: [],
    }));
  },

  setColumns: (columns) => {
    set({ columns });
  },

  appendColumnToken: (modelId, token) => {
    set((state) => ({
      columns: state.columns.map((col) =>
        col.modelId === modelId
          ? { ...col, streamingText: col.streamingText + token }
          : col
      ),
    }));
  },

  setColumnError: (modelId, error) => {
    set((state) => ({
      columns: state.columns.map((col) =>
        col.modelId === modelId ? { ...col, error } : col
      ),
    }));
  },

  setColumnStreaming: (modelId, streaming) => {
    set((state) => ({
      columns: state.columns.map((col) =>
        col.modelId === modelId ? { ...col, isStreaming: streaming } : col
      ),
    }));
  },

  appendUserMessage: (content) => {
    const msg: CompareMessage = {
      id: crypto.randomUUID(),
      compareSessionId: '',
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      columns: state.columns.map((col) => ({
        ...col,
        messages: [...col.messages, msg],
      })),
    }));
  },

  appendAssistantMessage: (modelId, content) => {
    const msg: CompareMessage = {
      id: crypto.randomUUID(),
      compareSessionId: '',
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      columns: state.columns.map((col) =>
        col.modelId === modelId
          ? { ...col, messages: [...col.messages, msg] }
          : col
      ),
    }));
  },

  clearColumns: () => {
    set({ columns: [] });
  },

  isAnyStreaming: () => {
    return get().columns.some((c) => c.isStreaming);
  },
}));
