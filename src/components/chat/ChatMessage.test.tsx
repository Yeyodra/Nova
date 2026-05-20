import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';
import type { Message } from '@/types';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

const baseMessage: Message = {
  id: 'msg-1',
  sessionId: 'ses-1',
  role: 'user',
  content: 'Hello world',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('ChatMessage', () => {
  it('renders message without attachments unchanged', () => {
    render(<ChatMessage message={baseMessage} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-grid')).toBeNull();
  });

  it('renders image attachment as thumbnail', () => {
    const msg: Message = {
      ...baseMessage,
      attachments: [{
        id: 'att-1',
        fileName: 'photo.png',
        fileSize: 2048,
        mimeType: 'image/png',
        filePath: '/path/photo.png',
        status: 'ready',
      }],
    };
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId('attachment-image-att-1')).toBeInTheDocument();
    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
  });

  it('renders document attachment as card', () => {
    const msg: Message = {
      ...baseMessage,
      attachments: [{
        id: 'att-2',
        fileName: 'report.pdf',
        fileSize: 1048576,
        mimeType: 'application/pdf',
        filePath: '/path/report.pdf',
        status: 'ready',
      }],
    };
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId('attachment-doc-att-2')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
  });

  it('renders multiple attachments in grid', () => {
    const msg: Message = {
      ...baseMessage,
      attachments: [
        { id: 'att-1', fileName: 'a.png', fileSize: 1024, mimeType: 'image/png', filePath: '/a', status: 'ready' },
        { id: 'att-2', fileName: 'b.jpg', fileSize: 2048, mimeType: 'image/jpeg', filePath: '/b', status: 'ready' },
        { id: 'att-3', fileName: 'c.pdf', fileSize: 4096, mimeType: 'application/pdf', filePath: '/c', status: 'ready' },
      ],
    };
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId('attachment-image-att-1')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-image-att-2')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-doc-att-3')).toBeInTheDocument();
  });

  it('assistant message renders without attachments normally', () => {
    const msg: Message = {
      ...baseMessage,
      role: 'assistant',
      content: 'Here is my response',
    };
    render(<ChatMessage message={msg} />);
    expect(screen.getByText('Here is my response')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-grid')).toBeNull();
  });
});
