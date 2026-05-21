import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComparePage } from './ComparePage';
import type { CompareColumn as CompareColumnType } from '@/types/compare';

const makeColumn = (overrides: Partial<CompareColumnType> = {}): CompareColumnType => ({
  modelId: 'gpt-4o',
  providerId: 'openai',
  modelName: 'GPT-4o',
  providerName: 'OpenAI',
  isStreaming: false,
  streamingText: '',
  messages: [],
  ...overrides,
});

let mockColumns: CompareColumnType[] = [];
let mockSelectedModelIds: string[] = [];

vi.mock('@/stores/useCompareStore', () => ({
  useCompareStore: (selector: any) => {
    const state = {
      columns: mockColumns,
      selectedModelIds: mockSelectedModelIds,
    };
    return selector(state);
  },
}));

vi.mock('./ModelSelector', () => ({
  ModelSelector: () => <div data-testid="model-selector">ModelSelector</div>,
}));

vi.mock('./CompareColumn', () => ({
  CompareColumn: ({ column }: { column: CompareColumnType }) => (
    <div data-testid={`compare-column-${column.modelId}`}>{column.modelName}</div>
  ),
}));

vi.mock('@/components/chat/ChatInputBar', () => ({
  ChatInputBar: React.forwardRef((_props: any, _ref: any) => (
    <div data-testid="chat-input-bar">ChatInputBar</div>
  )),
}));

describe('ComparePage', () => {
  beforeEach(() => {
    mockColumns = [];
    mockSelectedModelIds = [];
  });

  it('renders ModelSelector at the top', () => {
    render(<ComparePage />);
    expect(screen.getByTestId('model-selector')).toBeInTheDocument();
  });

  it('shows empty state when no columns exist', () => {
    render(<ComparePage />);
    expect(
      screen.getByText('Select 2-3 models to compare responses side-by-side'),
    ).toBeInTheDocument();
  });

  it('renders CompareColumn components when columns exist', () => {
    mockColumns = [
      makeColumn({ modelId: 'gpt-4o', modelName: 'GPT-4o' }),
      makeColumn({ modelId: 'claude-3', modelName: 'Claude 3', providerId: 'anthropic', providerName: 'Anthropic' }),
    ];
    mockSelectedModelIds = ['gpt-4o', 'claude-3'];

    render(<ComparePage />);
    expect(screen.getByTestId('compare-column-gpt-4o')).toBeInTheDocument();
    expect(screen.getByTestId('compare-column-claude-3')).toBeInTheDocument();
  });

  it('renders ChatInputBar at the bottom', () => {
    render(<ComparePage />);
    expect(screen.getByTestId('chat-input-bar')).toBeInTheDocument();
  });

  it('does not show empty state when columns are present', () => {
    mockColumns = [makeColumn()];
    mockSelectedModelIds = ['gpt-4o'];

    render(<ComparePage />);
    expect(
      screen.queryByText('Select 2-3 models to compare responses side-by-side'),
    ).not.toBeInTheDocument();
  });
});
