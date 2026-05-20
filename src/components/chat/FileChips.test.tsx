import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileChips } from './FileChips';
import { useFileStore } from '@/stores/useFileStore';
import type { AttachmentItem } from '@/types';

const makeFile = (id: string, opts: Partial<AttachmentItem> = {}): AttachmentItem => ({
  id,
  fileName: opts.fileName ?? `${id}.png`,
  fileSize: opts.fileSize ?? 1024,
  mimeType: opts.mimeType ?? 'image/png',
  filePath: `/path/${id}.png`,
  status: opts.status ?? 'ready',
  previewUrl: opts.previewUrl,
  error: opts.error,
});

describe('FileChips', () => {
  beforeEach(() => {
    useFileStore.setState({ pendingFiles: [] });
  });

  it('renders nothing when empty', () => {
    const { container } = render(<FileChips />);
    expect(container.firstChild).toBeNull();
  });

  it('renders file chips', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1', { fileName: 'photo.png' })] });
    render(<FileChips />);
    expect(screen.getByText(/photo/i)).toBeInTheDocument();
  });

  it('image chip shows thumbnail', () => {
    useFileStore.setState({
      pendingFiles: [makeFile('f1', { previewUrl: 'blob:http://localhost/abc', mimeType: 'image/png' })],
    });
    render(<FileChips />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:http://localhost/abc');
  });

  it('doc chip shows file icon (no img)', () => {
    useFileStore.setState({
      pendingFiles: [makeFile('f1', { mimeType: 'application/pdf', fileName: 'report.pdf' })],
    });
    render(<FileChips />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/report/i)).toBeInTheDocument();
  });

  it('remove button calls removeFile', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1')] });
    render(<FileChips />);
    const removeBtn = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeBtn);
    expect(useFileStore.getState().pendingFiles).toHaveLength(0);
  });

  it('shows processing spinner', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1', { status: 'processing' })] });
    render(<FileChips />);
    expect(screen.getByTestId('file-chip-spinner')).toBeInTheDocument();
  });

  it('shows error state', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1', { status: 'error', error: 'Too large' })] });
    render(<FileChips />);
    const chip = screen.getByTestId('file-chip-f1');
    expect(chip.className).toContain('border-red');
  });
});
