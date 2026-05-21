import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompareHistory } from './CompareHistory';
import { useCompareStore } from '@/stores/useCompareStore';
import type { CompareSession } from '@/types/compare';

const makeSessions = (): CompareSession[] => [
  {
    id: 'session-1',
    title: 'Compare GPT vs Claude',
    modelIds: ['gpt-4o', 'claude-sonnet'],
    createdAt: '2025-03-15T10:00:00Z',
    updatedAt: '2025-03-15T10:30:00Z',
  },
  {
    id: 'session-2',
    title: 'Three model test',
    modelIds: ['gpt-4o', 'claude-sonnet', 'gemini-pro'],
    createdAt: '2025-03-16T12:00:00Z',
    updatedAt: '2025-03-16T12:45:00Z',
  },
];

describe('CompareHistory', () => {
  beforeEach(() => {
    useCompareStore.setState({
      compareSessions: [],
      activeCompareSessionId: null,
    });
  });

  it('shows empty state when no sessions', () => {
    render(<CompareHistory />);
    expect(screen.getByText('No compare sessions yet')).toBeInTheDocument();
  });

  it('renders session list with titles and model counts', () => {
    useCompareStore.setState({ compareSessions: makeSessions() });
    render(<CompareHistory />);

    expect(screen.getByText('Compare GPT vs Claude')).toBeInTheDocument();
    expect(screen.getByText('Three model test')).toBeInTheDocument();
    expect(screen.getByText('2 models')).toBeInTheDocument();
    expect(screen.getByText('3 models')).toBeInTheDocument();
  });

  it('click sets active session', () => {
    useCompareStore.setState({ compareSessions: makeSessions() });
    render(<CompareHistory />);

    fireEvent.click(screen.getByText('Compare GPT vs Claude'));
    expect(useCompareStore.getState().activeCompareSessionId).toBe('session-1');
  });

  it('delete removes session from list', () => {
    useCompareStore.setState({ compareSessions: makeSessions() });
    render(<CompareHistory />);

    const deleteButtons = screen.getAllByTitle('Delete session');
    fireEvent.click(deleteButtons[0]);

    expect(useCompareStore.getState().compareSessions).toHaveLength(1);
    expect(useCompareStore.getState().compareSessions[0].id).toBe('session-2');
  });

  it('highlights active session', () => {
    useCompareStore.setState({
      compareSessions: makeSessions(),
      activeCompareSessionId: 'session-1',
    });
    const { container } = render(<CompareHistory />);

    const items = container.querySelectorAll('[class*="cursor-pointer"]');
    expect(items[0].className).toContain('bg-[var(--fill-tertiary)]');
  });
});
