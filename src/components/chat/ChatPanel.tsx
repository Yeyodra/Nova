import React, { useEffect, useRef, useCallback } from 'react';
import { Robot } from '@phosphor-icons/react';
import { useChatStore } from '@/stores/useChatStore';
import { useAgentStore } from '@/stores/useAgentStore';
import { useFileStore } from '@/stores/useFileStore';
import { ChatMessage } from './ChatMessage';
import { StreamingMessage } from './StreamingMessage';
import { AgentRunCard } from './AgentRunCard';
import { DragDropZone } from './DragDropZone';
import { Message, AgentRunWithTools } from '@/types';

interface ChatPanelProps {
  onChipClick?: (text: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ onChipClick: _onChipClick }) => {
  const { messages, isStreaming, streamingText } = useChatStore();
  const { agentRuns } = useAgentStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const isAutoScrolling = useRef(false);

  const handleFilesDropped = useCallback((files: File[]) => {
    const { addFile } = useFileStore.getState();
    for (const file of files) {
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      addFile({
        id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        filePath: '',
        previewUrl,
        status: 'pending',
      });
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAutoScrolling.current = true;
    requestAnimationFrame(() => {
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      // Reset flag after browser has applied the scroll
      requestAnimationFrame(() => { isAutoScrolling.current = false; });
    });
  }, []);

  // Track user scroll intent — ignore scroll events caused by our own scrollToBottom
  const handleScroll = useCallback(() => {
    if (isAutoScrolling.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distFromBottom > 150;
  }, []);

  // Auto-scroll only when genuinely new messages are added
  const prevMsgCount = useRef(messages.length);

  useEffect(() => {
    const newMsg = messages.length > prevMsgCount.current;
    prevMsgCount.current = messages.length;

    if (newMsg && !userScrolledUp.current) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  // During active streaming only, follow new tokens (throttled)
  const streamScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isStreaming || userScrolledUp.current) return;
    if (streamScrollTimer.current) return; // throttle
    streamScrollTimer.current = setTimeout(() => {
      streamScrollTimer.current = null;
      if (!userScrolledUp.current) scrollToBottom();
    }, 80);
  }, [streamingText, isStreaming, scrollToBottom]);

  const isEmpty = messages.length === 0 && agentRuns.length === 0 && !isStreaming;

  if (isEmpty) {
    return (
      <DragDropZone onFilesDropped={handleFilesDropped}>
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-[var(--fill-tertiary)] flex items-center justify-center">
              <Robot size={22} weight="duotone" className="text-[var(--text-muted)]" />
            </div>
            <span className="text-lg font-semibold text-[var(--text)]">enowX Coder</span>
          </div>
          <p className="text-[14px] text-[var(--text-muted)] mb-1">What can I help you with today?</p>
        </div>
      </DragDropZone>
    );
  }

  const topLevelRuns = agentRuns.filter((r) => r.parentAgentRunId === null);
  const combinedItems = [
    ...messages.map((m) => ({ type: 'message' as const, data: m, date: new Date(m.createdAt).getTime() })),
    ...topLevelRuns.map((r) => ({ type: 'agent' as const, data: r, date: new Date(r.createdAt).getTime() })),
  ].sort((a, b) => a.date - b.date);

  return (
    <DragDropZone onFilesDropped={handleFilesDropped}>
      <div className="flex-1 relative overflow-hidden min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto custom-scrollbar py-6"
        >
          <div className="max-w-3xl mx-auto w-full px-4 flex flex-col gap-6">
            {combinedItems.map((item) => {
              if (item.type === 'message') {
                const message = item.data as Message;
                return <ChatMessage key={message.id} message={message} />;
              }
              return <AgentRunCard key={item.data.id} run={item.data as AgentRunWithTools} />;
            })}
            <StreamingMessage />
            <div ref={bottomRef} />
          </div>
        </div>

        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--bg))' }}
        />
      </div>
    </DragDropZone>
  );
};
