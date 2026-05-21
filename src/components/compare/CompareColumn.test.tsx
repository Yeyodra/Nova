import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompareColumn } from './CompareColumn';
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

describe('CompareColumn', () => {
  it('renders model name in header', () => {
    render(<CompareColumn column={makeColumn()} />);
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
  });

  it('shows streaming text when streaming', () => {
    render(
      <CompareColumn
        column={makeColumn({ isStreaming: true, streamingText: 'Hello world' })}
      />,
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();
  });

  it('shows error state with error message', () => {
    render(
      <CompareColumn column={makeColumn({ error: 'Rate limit exceeded' })} />,
    );
    expect(screen.getByTestId('error-banner')).toBeInTheDocument();
    expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
  });

  it('"Use this model" button calls onUseModel', () => {
    const onUseModel = vi.fn();
    render(
      <CompareColumn
        column={makeColumn({ streamingText: 'Some response text' })}
        onUseModel={onUseModel}
      />,
    );
    const button = screen.getByText('Use this model');
    fireEvent.click(button);
    expect(onUseModel).toHaveBeenCalledWith('gpt-4o', 'openai');
  });

  it('shows waiting state when idle', () => {
    render(<CompareColumn column={makeColumn()} />);
    expect(screen.getByText('Waiting for response...')).toBeInTheDocument();
  });

  it('shows retry button in error state when onRetry provided', () => {
    const onRetry = vi.fn();
    render(
      <CompareColumn
        column={makeColumn({ error: 'Connection failed' })}
        onRetry={onRetry}
      />,
    );
    const retryButton = screen.getByTestId('retry-button');
    expect(retryButton).toBeInTheDocument();
    expect(retryButton).toHaveTextContent('Retry');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledWith('openai');
  });

  it('does not show retry button when onRetry not provided', () => {
    render(
      <CompareColumn column={makeColumn({ error: 'Connection failed' })} />,
    );
    expect(screen.getByTestId('error-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
  });
});
