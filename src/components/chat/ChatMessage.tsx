import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Sparkle } from '@phosphor-icons/react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Message, AttachmentItem } from '@/types';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { ImageLightbox } from './ImageLightbox';
import { fixMarkdownTables } from '@/lib/utils';
import 'highlight.js/styles/github-dark.css';

/**
 * Strip XML-style segment tags (<thinking>, <tool>, <response>) and
 * heading-based segment markers so we render a single clean markdown block.
 */
const cleanContent = (raw: string): string => {
  let text = raw.replace(/\r\n/g, '\n').trim();

  // Remove XML segment wrappers — keep inner content
  text = text.replace(/<\/?(?:thinking|tool|response)>/gi, '');

  // Remove heading lines that are purely segment labels
  text = text.replace(
    /^#{1,6}\s+(?:thinking|reasoning|analysis|chain of thought|tool execution?|response|final answer|answer)\s*$/gim,
    '',
  );

  // Remove prefix-style segment labels  (e.g. "Response: ...")
  text = text.replace(
    /^(?:thinking|reasoning|analysis|tool|executing tool|response|final answer)\s*[:\-]\s*/gim,
    '',
  );

  // Collapse 3+ consecutive blank lines into 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentGrid({ attachments, onImageClick }: { attachments: AttachmentItem[]; onImageClick?: (att: AttachmentItem) => void }) {
  const images = attachments.filter(a => a.mimeType.startsWith('image/'));
  const docs = attachments.filter(a => !a.mimeType.startsWith('image/'));

  return (
    <div className="mt-2 space-y-2" data-testid="attachment-grid">
      {/* Image thumbnails grid */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(img => {
            // Convert local file path to asset protocol URL for webview display
            const imgSrc = img.previewUrl || (img.filePath ? convertFileSrc(img.filePath) : '');
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => onImageClick?.(img)}
                className="relative w-32 h-32 rounded-lg overflow-hidden border border-[var(--border)] hover:border-[var(--text-subtle)] transition-colors cursor-pointer"
                data-testid={`attachment-image-${img.id}`}
              >
                <img
                  src={imgSrc}
                  alt={img.fileName}
                  className="w-full h-full object-cover"
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Document cards */}
      {docs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {docs.map(doc => (
            <div
              key={doc.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] max-w-xs"
              data-testid={`attachment-doc-${doc.id}`}
            >
              <FileText className="w-5 h-5 text-[var(--text-muted)] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--text)] truncate">{doc.fileName}</p>
                <p className="text-xs text-[var(--text-muted)]">{formatFileSize(doc.fileSize)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const markdownComponents = {
  code: MarkdownCodeBlock as React.ComponentType<React.HTMLAttributes<HTMLElement>>,
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <div className="mb-4 last:mb-0" {...props}>{children}</div>
  ),
};

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage = React.memo<ChatMessageProps>(({ message }) => {
  const isUser = message.role === 'user';
  const [lightboxImage, setLightboxImage] = useState<AttachmentItem | null>(null);

  /* ── User bubble ─────────────────────────────────────────── */
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-2">
        {/* Text bubble */}
        {message.content && (
          <div
            className={cn(
              'px-4 py-2.5 rounded-3xl rounded-br-lg text-[15px] leading-relaxed',
              'bg-[var(--surface-2)] text-[var(--text)]',
              'max-w-[75%]',
            )}
            style={{ width: 'fit-content' }}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        )}
        {/* Attachments below text */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="max-w-[75%]">
            <AttachmentGrid
              attachments={message.attachments}
              onImageClick={(att) => setLightboxImage(att)}
            />
          </div>
        )}
        {lightboxImage && (
          <ImageLightbox
            isOpen={!!lightboxImage}
            imageSrc={lightboxImage.previewUrl || (lightboxImage.filePath ? convertFileSrc(lightboxImage.filePath) : '')}
            fileName={lightboxImage.fileName}
            onClose={() => setLightboxImage(null)}
          />
        )}
      </div>
    );
  }

  /* ── Assistant message — flat, no boxes ──────────────────── */
  const content = cleanContent(message.content);

  return (
    <div className="flex gap-3 w-full">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5">
        <Sparkle size={14} weight="fill" className="text-[var(--accent-fg)]" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 ai-prose ai-prose-readable pt-0.5">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {fixMarkdownTables(content)}
        </ReactMarkdown>
        {message.attachments && message.attachments.length > 0 && (
          <AttachmentGrid attachments={message.attachments} />
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = 'ChatMessage';
