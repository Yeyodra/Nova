import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DragDropZone } from './DragDropZone';

describe('DragDropZone', () => {
  const mockOnFilesDropped = vi.fn();

  beforeEach(() => {
    mockOnFilesDropped.mockClear();
  });

  it('renders children normally', () => {
    render(
      <DragDropZone onFilesDropped={mockOnFilesDropped}>
        <div data-testid="child">Child content</div>
      </DragDropZone>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('no overlay by default', () => {
    render(
      <DragDropZone onFilesDropped={mockOnFilesDropped}>
        <div>Content</div>
      </DragDropZone>
    );
    expect(screen.queryByTestId('drag-drop-overlay')).toBeNull();
  });

  it('shows overlay on dragover', () => {
    render(
      <DragDropZone onFilesDropped={mockOnFilesDropped}>
        <div>Content</div>
      </DragDropZone>
    );
    const zone = screen.getByTestId('drag-drop-zone');
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();
  });

  it('hides overlay on dragleave', () => {
    render(
      <DragDropZone onFilesDropped={mockOnFilesDropped}>
        <div>Content</div>
      </DragDropZone>
    );
    const zone = screen.getByTestId('drag-drop-zone');
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();
    // Simulate dragleave where target === currentTarget
    fireEvent.dragLeave(zone, { target: zone });
    expect(screen.queryByTestId('drag-drop-overlay')).toBeNull();
  });

  it('calls onFilesDropped with files on drop', () => {
    render(
      <DragDropZone onFilesDropped={mockOnFilesDropped}>
        <div>Content</div>
      </DragDropZone>
    );
    const zone = screen.getByTestId('drag-drop-zone');
    const file = new File(['content'], 'test.png', { type: 'image/png' });
    fireEvent.drop(zone, {
      dataTransfer: { files: [file] },
    });
    expect(mockOnFilesDropped).toHaveBeenCalledWith([file]);
  });
});
