import { describe, it, expect, beforeEach } from 'vitest';
import { useCompareStore } from './useCompareStore';
import type { CompareSession, CompareColumn } from '@/types/compare';

const makeSession = (id: string): CompareSession => ({
  id,
  title: `Session ${id}`,
  modelIds: ['model-1', 'model-2'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});

const makeColumn = (modelId: string, overrides?: Partial<CompareColumn>): CompareColumn => ({
  modelId,
  providerId: `provider-${modelId}`,
  modelName: `Model ${modelId}`,
  providerName: `Provider ${modelId}`,
  isStreaming: false,
  streamingText: '',
  messages: [],
  ...overrides,
});

describe('useCompareStore', () => {
  beforeEach(() => {
    useCompareStore.setState({
      activeCompareSessionId: null,
      compareSessions: [],
      columns: [],
      selectedModelIds: [],
    });
  });

  it('initial state is correct', () => {
    const state = useCompareStore.getState();
    expect(state.activeCompareSessionId).toBeNull();
    expect(state.compareSessions).toEqual([]);
    expect(state.columns).toEqual([]);
    expect(state.selectedModelIds).toEqual([]);
  });

  it('setActiveCompareSession sets the active session id', () => {
    useCompareStore.getState().setActiveCompareSession('session-1');
    expect(useCompareStore.getState().activeCompareSessionId).toBe('session-1');

    useCompareStore.getState().setActiveCompareSession(null);
    expect(useCompareStore.getState().activeCompareSessionId).toBeNull();
  });

  it('addCompareSession adds a session', () => {
    const session = makeSession('s1');
    useCompareStore.getState().addCompareSession(session);
    expect(useCompareStore.getState().compareSessions).toHaveLength(1);
    expect(useCompareStore.getState().compareSessions[0].id).toBe('s1');
  });

  it('removeCompareSession removes by id', () => {
    useCompareStore.setState({
      compareSessions: [makeSession('s1'), makeSession('s2')],
    });
    useCompareStore.getState().removeCompareSession('s1');
    expect(useCompareStore.getState().compareSessions).toHaveLength(1);
    expect(useCompareStore.getState().compareSessions[0].id).toBe('s2');
  });

  it('addModel enforces max 3 limit', () => {
    const { addModel } = useCompareStore.getState();
    expect(addModel('m1')).toBe(true);
    expect(addModel('m2')).toBe(true);
    expect(addModel('m3')).toBe(true);
    expect(addModel('m4')).toBe(false);
    expect(useCompareStore.getState().selectedModelIds).toHaveLength(3);
    expect(useCompareStore.getState().selectedModelIds).toEqual(['m1', 'm2', 'm3']);
  });

  it('removeModel removes by modelId', () => {
    useCompareStore.setState({ selectedModelIds: ['m1', 'm2', 'm3'] });
    useCompareStore.getState().removeModel('m2');
    expect(useCompareStore.getState().selectedModelIds).toEqual(['m1', 'm3']);
  });

  it('appendColumnToken appends to correct column', () => {
    useCompareStore.setState({
      columns: [makeColumn('m1'), makeColumn('m2')],
    });
    useCompareStore.getState().appendColumnToken('m1', 'Hello');
    useCompareStore.getState().appendColumnToken('m1', ' World');
    expect(useCompareStore.getState().columns[0].streamingText).toBe('Hello World');
    expect(useCompareStore.getState().columns[1].streamingText).toBe('');
  });

  it('setColumnError sets error on correct column', () => {
    useCompareStore.setState({
      columns: [makeColumn('m1'), makeColumn('m2')],
    });
    useCompareStore.getState().setColumnError('m2', 'Rate limit exceeded');
    expect(useCompareStore.getState().columns[0].error).toBeUndefined();
    expect(useCompareStore.getState().columns[1].error).toBe('Rate limit exceeded');
  });

  it('isAnyStreaming returns true when any column is streaming', () => {
    useCompareStore.setState({
      columns: [makeColumn('m1'), makeColumn('m2', { isStreaming: true })],
    });
    expect(useCompareStore.getState().isAnyStreaming()).toBe(true);
  });

  it('isAnyStreaming returns false when no column is streaming', () => {
    useCompareStore.setState({
      columns: [makeColumn('m1'), makeColumn('m2')],
    });
    expect(useCompareStore.getState().isAnyStreaming()).toBe(false);
  });

  it('clearColumns resets all columns', () => {
    useCompareStore.setState({
      columns: [makeColumn('m1', { streamingText: 'data' }), makeColumn('m2')],
    });
    useCompareStore.getState().clearColumns();
    expect(useCompareStore.getState().columns).toEqual([]);
  });

  it('setColumnStreaming sets streaming on correct column', () => {
    useCompareStore.setState({
      columns: [makeColumn('m1'), makeColumn('m2')],
    });
    useCompareStore.getState().setColumnStreaming('m1', true);
    expect(useCompareStore.getState().columns[0].isStreaming).toBe(true);
    expect(useCompareStore.getState().columns[1].isStreaming).toBe(false);
  });

  it('setCompareSessions replaces all sessions', () => {
    useCompareStore.setState({ compareSessions: [makeSession('old')] });
    const newSessions = [makeSession('new1'), makeSession('new2')];
    useCompareStore.getState().setCompareSessions(newSessions);
    expect(useCompareStore.getState().compareSessions).toHaveLength(2);
    expect(useCompareStore.getState().compareSessions[0].id).toBe('new1');
  });
});
