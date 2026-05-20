import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInputBar } from './ChatInputBar';
import { useFileStore } from '@/stores/useFileStore';

// Mock Tauri APIs
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

// Mock child components that use complex deps
vi.mock('@/stores/useChatStore', () => ({
  useChatStore: () => ({ isStreaming: false }),
}));

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: () => ({
    providers: [],
    defaultProviderId: 'p1',
    selectedModelId: 'm1',
    setDefaultProviderId: vi.fn(),
    setSelectedModelId: vi.fn(),
  }),
}));

vi.mock('@/stores/useAgentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: any) => {
      const state = { agentRuns: [], selectedAgentType: 'chat', setSelectedAgentType: vi.fn() };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ agentRuns: [], selectedAgentType: 'chat', setSelectedAgentType: vi.fn() }) }
  ),
}));

describe('ChatInputBar - File Attachment', () => {
  const mockOnSend = vi.fn();

  beforeEach(() => {
    mockOnSend.mockClear();
    useFileStore.setState({ pendingFiles: [] });
  });

  it('paperclip button exists and is clickable', () => {
    render(<ChatInputBar onSend={mockOnSend} />);
    const btn = screen.getByTitle('Attach file');
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('FileChips not rendered when no pending files', () => {
    render(<ChatInputBar onSend={mockOnSend} />);
    expect(screen.queryByTestId('file-chips-container')).toBeNull();
  });

  it('FileChips rendered when files pending', () => {
    useFileStore.setState({
      pendingFiles: [{
        id: 'f1', fileName: 'test.png', fileSize: 1024,
        mimeType: 'image/png', filePath: '/path', status: 'ready',
      }],
    });
    render(<ChatInputBar onSend={mockOnSend} />);
    expect(screen.getByText(/test/i)).toBeInTheDocument();
  });

  it('send clears files after sending', () => {
    useFileStore.setState({
      pendingFiles: [{
        id: 'f1', fileName: 'test.png', fileSize: 1024,
        mimeType: 'image/png', filePath: '/path', status: 'ready',
      }],
    });
    render(<ChatInputBar onSend={mockOnSend} />);
    const textarea = screen.getByPlaceholderText(/ask/i);
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockOnSend).toHaveBeenCalled();
    expect(useFileStore.getState().pendingFiles).toHaveLength(0);
  });

  it('send includes attachment IDs', () => {
    useFileStore.setState({
      pendingFiles: [{
        id: 'att-123', fileName: 'test.png', fileSize: 1024,
        mimeType: 'image/png', filePath: '/path', status: 'ready',
      }],
    });
    render(<ChatInputBar onSend={mockOnSend} />);
    const textarea = screen.getByPlaceholderText(/ask/i);
    fireEvent.change(textarea, { target: { value: 'check this' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockOnSend).toHaveBeenCalledWith('check this', ['att-123']);
  });

  it('can send with only files (no text)', () => {
    useFileStore.setState({
      pendingFiles: [{
        id: 'att-456', fileName: 'photo.png', fileSize: 2048,
        mimeType: 'image/png', filePath: '/path', status: 'ready',
      }],
    });
    render(<ChatInputBar onSend={mockOnSend} />);
    const textarea = screen.getByPlaceholderText(/ask/i);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockOnSend).toHaveBeenCalledWith('', ['att-456']);
  });
});
