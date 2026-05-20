import { useState, useCallback, type ReactNode, type DragEvent } from 'react';
import { Upload } from 'lucide-react';

interface DragDropZoneProps {
  children: ReactNode;
  onFilesDropped: (files: File[]) => void;
}

export function DragDropZone({ children, onFilesDropped }: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide if leaving the container (not entering a child)
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesDropped(files);
    }
  }, [onFilesDropped]);

  return (
    <div
      className="relative w-full h-full flex flex-col flex-1 min-h-0 overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="drag-drop-zone"
    >
      {children}
      {isDragging && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-lg"
          data-testid="drag-drop-overlay"
        >
          <Upload className="w-12 h-12 text-blue-400 mb-3" />
          <p className="text-lg font-medium text-white">Drop files here</p>
          <p className="text-sm text-white/60 mt-1">Images and documents</p>
        </div>
      )}
    </div>
  );
}
