import React, { useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { ModelSelector } from './ModelSelector';
import { CompareColumn } from './CompareColumn';
import { ChatInputBar } from '@/components/chat/ChatInputBar';
import { useCompareStore } from '@/stores/useCompareStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { CompareColumn as CompareColumnType } from '@/types/compare';

export const ComparePage: React.FC = () => {
  const columns = useCompareStore((s) => s.columns);
  const selectedModelIds = useCompareStore((s) => s.selectedModelIds);
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const handleSend = async (content: string, _attachmentIds?: string[]) => {
    if (selectedModelIds.length < 2) return;
    if (!content.trim()) return;

    setLastPrompt(content);

    const providers = useSettingsStore.getState().providers;

    // Build model configs from composite keys "providerId::modelId"
    const modelConfigs = selectedModelIds.map((compositeKey) => {
      const [providerId, modelId] = compositeKey.split('::');
      return { providerId, modelId };
    });

    // Create a session in DB (needed for backend send_compare_message)
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      try {
        const session = await invoke<{ id: string }>('create_compare_session', {
          modelIds: selectedModelIds,
        });
        currentSessionId = session.id;
        setSessionId(session.id);
      } catch (err) {
        console.error('Failed to create compare session:', err);
        return;
      }
    }

    // Initialize columns in streaming state
    const initialColumns: CompareColumnType[] = selectedModelIds.map((compositeKey) => {
      const [providerId, modelId] = compositeKey.split('::');
      const provider = providers.find((p) => p.id === providerId);
      return {
        modelId,
        providerId,
        modelName: modelId,
        providerName: provider?.name ?? providerId,
        isStreaming: true,
        streamingText: '',
        messages: [],
        error: undefined,
      };
    });
    useCompareStore.getState().setColumns(initialColumns);
    setIsSending(true);

    // Set up channel (tokens are interleaved — v1 uses fetch-after-complete)
    const onToken = new Channel<string>();
    onToken.onmessage = () => {
      // v1: tokens interleaved, just wait for completion
    };

    try {
      await invoke('send_compare_message', {
        sessionId: currentSessionId,
        content,
        modelConfigs,
        onToken,
      });

      // Fetch final messages after completion
      const messages = await invoke<{ role: string; content: string; modelId?: string; providerId?: string }[]>(
        'get_compare_messages',
        { sessionId: currentSessionId }
      );

      // Group assistant messages by modelId into columns
      const assistantMessages = messages.filter((m) => m.role === 'assistant');
      const updatedColumns: CompareColumnType[] = selectedModelIds.map((compositeKey) => {
        const [providerId, modelId] = compositeKey.split('::');
        const provider = providers.find((p) => p.id === providerId);
        const colMessages = assistantMessages.filter((m) => m.modelId === modelId);
        const hasError = colMessages.length === 0;
        const lastMessage = colMessages[colMessages.length - 1];
        return {
          modelId,
          providerId,
          modelName: modelId,
          providerName: provider?.name ?? providerId,
          isStreaming: false,
          streamingText: lastMessage?.content ?? '',
          messages: [],
          error: hasError ? 'Model failed to respond. Check API key and connectivity.' : undefined,
        };
      });
      useCompareStore.getState().setColumns(updatedColumns);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const cols = useCompareStore.getState().columns;
      useCompareStore.getState().setColumns(
        cols.map((c) => ({ ...c, isStreaming: false, error: errorMsg }))
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleStop = () => {
    if (sessionId) {
      invoke('cancel_compare', { sessionId }).catch(console.error);
    }
    const cols = useCompareStore.getState().columns;
    useCompareStore.getState().setColumns(
      cols.map((c) => ({ ...c, isStreaming: false }))
    );
    setIsSending(false);
  };

  const handleRetry = (providerId: string) => {
    const cols = useCompareStore.getState().columns;
    useCompareStore.getState().setColumns(
      cols.map((c) => c.providerId === providerId ? { ...c, error: undefined } : c)
    );
  };

  const handleUseModel = (modelId: string, providerId: string) => {
    useSettingsStore.getState().setDefaultProviderId(providerId);
    useSettingsStore.getState().setSelectedModelId(modelId);
  };

  const showEmptyState = columns.length === 0;
  const isStreaming = isSending || columns.some((c) => c.isStreaming);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Model Selector — top */}
      <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
        <ModelSelector />
      </div>

      {/* User prompt bubble */}
      {lastPrompt && (
        <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
          <div className="max-w-2xl ml-auto bg-[var(--fill-quaternary)] rounded-[var(--radius)] px-4 py-3">
            <p className="text-[13px] text-[var(--text)] whitespace-pre-wrap">{lastPrompt}</p>
          </div>
        </div>
      )}

      {/* Columns area — middle, flex-1 */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!showEmptyState ? (
          columns.map((col) => (
            <CompareColumn
              key={col.providerId + '::' + col.modelId}
              column={col}
              onUseModel={handleUseModel}
              onRetry={handleRetry}
            />
          ))
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
            <p className="text-sm">Select 2-3 models to compare responses side-by-side</p>
          </div>
        )}
      </div>

      {/* Input bar — bottom */}
      <div className="shrink-0">
        <ChatInputBar
          onSend={handleSend}
          onStop={isStreaming ? handleStop : undefined}
          hideAgentSelector
          hideModelSelector
        />
      </div>
    </div>
  );
};
