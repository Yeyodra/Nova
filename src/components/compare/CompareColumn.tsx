import React from 'react';
import type { CompareColumn as CompareColumnType } from '@/types/compare';

export interface CompareColumnProps {
  column: CompareColumnType;
  onUseModel?: (modelId: string, providerId: string) => void;
  onRetry?: (providerId: string) => void;
}

export const CompareColumn: React.FC<CompareColumnProps> = ({
  column,
  onUseModel,
  onRetry,
}) => {
  const { modelId, providerId, modelName, providerName, isStreaming, streamingText, error } = column;
  const hasContent = streamingText.length > 0;
  const showFooter = !isStreaming && hasContent;

  return (
    <div className="flex-1 flex flex-col h-full border-r border-[var(--border)] last:border-r-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] shrink-0 flex items-center gap-2">
        <span className="text-[13px] font-medium text-[var(--text)] truncate">
          {modelName}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface-hover)] text-[var(--text-muted)]">
          {providerName}
        </span>
        {isStreaming && (
          <span
            className="animate-pulse bg-green-400 w-2 h-2 rounded-full ml-auto shrink-0"
            data-testid="streaming-indicator"
          />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <div
            className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-[var(--radius)] p-3 text-[12px]"
            data-testid="error-banner"
          >
            <p>{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(providerId)}
                className="mt-2 text-[12px] text-[var(--accent)] hover:underline"
                data-testid="retry-button"
              >
                Retry
              </button>
            )}
          </div>
        ) : hasContent ? (
          <div className="text-[13px] text-[var(--text)] whitespace-pre-wrap leading-relaxed">
            {streamingText}
          </div>
        ) : (
          <div className="text-[12px] text-[var(--text-muted)] italic">
            Waiting for response...
          </div>
        )}
      </div>

      {/* Footer */}
      {showFooter && (
        <div className="px-4 py-2 border-t border-[var(--border)] shrink-0">
          <button
            type="button"
            className="text-[12px] text-[var(--accent)] hover:underline"
            onClick={() => onUseModel?.(modelId, providerId)}
          >
            Use this model
          </button>
        </div>
      )}
    </div>
  );
};
