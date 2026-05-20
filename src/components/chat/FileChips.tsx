import { FileText, X, Loader2, AlertCircle } from 'lucide-react';
import { useFileStore } from '@/stores/useFileStore';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateFileName(name: string, max = 15): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0) {
    const extension = name.slice(ext);
    const base = name.slice(0, max - extension.length - 1);
    return `${base}…${extension}`;
  }
  return `${name.slice(0, max - 1)}…`;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function FileChips() {
  const pendingFiles = useFileStore((s) => s.pendingFiles);

  if (pendingFiles.length === 0) return null;

  return (
    <div className="flex overflow-x-auto gap-2 p-2">
      {pendingFiles.map((file) => {
        const isImage = isImageMime(file.mimeType);
        const isError = file.status === 'error';
        const isProcessing = file.status === 'processing';

        return (
          <div
            key={file.id}
            data-testid={`file-chip-${file.id}`}
            className={`
              flex items-center gap-2 min-w-[160px] max-w-[200px] px-2 py-1.5
              rounded-lg bg-[var(--surface-2)] border
              ${isError ? 'border-red-500' : 'border-[var(--border)]'}
              transition-colors
            `}
          >
            {/* Thumbnail / Icon */}
            <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden flex items-center justify-center bg-[var(--fill-tertiary)]">
              {isImage && file.previewUrl ? (
                <img
                  src={file.previewUrl}
                  alt={file.fileName}
                  className="w-10 h-10 object-cover"
                />
              ) : (
                <FileText className="w-5 h-5 text-[var(--text-muted)]" />
              )}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--text)] truncate">
                {truncateFileName(file.fileName)}
              </p>
              <p className="text-[10px] text-[var(--text-subtle)]">
                {formatFileSize(file.fileSize)}
              </p>
            </div>

            {/* Status indicator */}
            {isProcessing && (
              <Loader2
                data-testid="file-chip-spinner"
                className="w-4 h-4 text-[var(--text-muted)] animate-spin flex-shrink-0"
              />
            )}
            {isError && (
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}

            {/* Remove button */}
            <button
              type="button"
              aria-label="remove"
              onClick={() => useFileStore.getState().removeFile(file.id)}
              className="flex-shrink-0 p-0.5 rounded hover:bg-[var(--hover-bg-strong)] text-[var(--text-subtle)] hover:text-[var(--text)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
