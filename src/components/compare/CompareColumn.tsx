import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownCodeBlock } from '@/components/chat/MarkdownCodeBlock';
import { fixMarkdownTables } from '@/lib/utils';
import type { CompareColumn as CompareColumnType } from '@/types/compare';

const markdownComponents = {
  code: MarkdownCodeBlock as React.ComponentType<React.HTMLAttributes<HTMLElement>>,
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <div className="mb-4 last:mb-0" {...props}>{children}</div>
  ),
};

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
  const { modelId, providerId, modelName, providerName, isStreaming, streamingText, messages, error } = column;
  const hasMessages = messages.length > 0;
  const showFooter = !isStreaming && hasMessages;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change or streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming, streamingText]);

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

      {/* Body — scrollable message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, idx) => (
          msg.role === 'user' ? (
            <div key={msg.id || idx} className="flex justify-end">
              <div className="bg-[var(--fill-quaternary)] rounded-[var(--radius)] px-3 py-2 max-w-[85%]">
                <p className="text-[13px] text-[var(--text)] whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ) : (
            <div key={msg.id || idx} className="text-[13px] text-[var(--text)] leading-relaxed prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={markdownComponents}
              >
                {fixMarkdownTables(msg.content)}
              </ReactMarkdown>
            </div>
          )
        ))}

        {/* Currently streaming response */}
        {isStreaming && streamingText && (
          <div className="text-[13px] text-[var(--text)] leading-relaxed prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {fixMarkdownTables(streamingText)}
            </ReactMarkdown>
          </div>
        )}

        {/* Waiting indicator */}
        {isStreaming && !streamingText && (
          <div className="text-[12px] text-[var(--text-muted)] italic">
            Waiting for response...
          </div>
        )}

        {/* Error state */}
        {error && (
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
