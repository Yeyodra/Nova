import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  isOpen: boolean;
  imageSrc: string;
  fileName: string;
  onClose: () => void;
}

export function ImageLightbox({ isOpen, imageSrc, fileName, onClose }: ImageLightboxProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${fileName}`}
      data-testid="lightbox-backdrop"
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        aria-label="Close"
        data-testid="lightbox-close"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Image container — stop propagation so clicking image doesn't close */}
      <div
        className="max-w-[90vw] max-h-[85vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageSrc}
          alt={fileName}
          className="max-w-full max-h-[80vh] object-contain rounded-lg"
          data-testid="lightbox-image"
        />
        <p className="mt-3 text-sm text-white/70">{fileName}</p>
      </div>
    </div>
  );
}
