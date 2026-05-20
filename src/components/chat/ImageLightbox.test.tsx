import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageLightbox } from './ImageLightbox';

describe('ImageLightbox', () => {
  const defaultProps = {
    isOpen: true,
    imageSrc: '/path/to/image.png',
    fileName: 'photo.png',
    onClose: vi.fn(),
  };

  it('not visible when closed', () => {
    render(<ImageLightbox {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('lightbox-backdrop')).toBeNull();
  });

  it('opens with image', () => {
    render(<ImageLightbox {...defaultProps} />);
    expect(screen.getByTestId('lightbox-backdrop')).toBeInTheDocument();
    const img = screen.getByTestId('lightbox-image');
    expect(img).toHaveAttribute('src', '/path/to/image.png');
    expect(img).toHaveAttribute('alt', 'photo.png');
  });

  it('close on backdrop click', () => {
    const onClose = vi.fn();
    render(<ImageLightbox {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('lightbox-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close on Escape key', () => {
    const onClose = vi.fn();
    render(<ImageLightbox {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows filename below image', () => {
    render(<ImageLightbox {...defaultProps} />);
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });
});
