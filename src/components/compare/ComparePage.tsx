import React, { useState, useEffect } from 'react';
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

  // Reset session when model selection changes (columns get cleared by store)
  useEffect(() => {
    setSessionId(null);
  }, [selectedModelIds]);

  const handleSend = async (content: string, attachmentIds?: string[]) => {
    if (selectedModelIds.length < 2) return;
    if (!content.trim()) return;

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

    // Initialize columns if first message, otherwise reuse existing
    const store = useCompareStore.getState();
    if (store.columns.length === 0) {
      const initialColumns: CompareColumnType[] = selectedModelIds.map((compositeKey) => {
        const [providerId, modelId] = compositeKey.split('::');
        const provider = providers.find((p) => p.id === providerId);
        return {
          modelId,
          providerId,
          modelName: modelId,
          providerName: provider?.name ?? providerId,
          isStreaming: false,
          streamingText: '',
          messages: [],
          error: undefined,
        };
      });
      useCompareStore.getState().setColumns(initialColumns);
    }

    // Append user message to all columns and set streaming state
    useCompareStore.getState().appendUserMessage(content);
    useCompareStore.getState().setColumns(
      useCompareStore.getState().columns.map((col) => ({
        ...col,
        isStreaming: true,
        streamingText: '',
        error: undefined,
      }))
    );
    setIsSending(true);

    // Set up channel — tokens are prefixed with "{index}:" for demuxing
    const onToken = new Channel<string>();
    onToken.onmessage = (prefixedToken: string) => {
      const colonIdx = prefixedToken.indexOf(':');
      if (colonIdx === -1) return;

      const indexStr = prefixedToken.substring(0, colonIdx);
      const payload = prefixedToken.substring(colonIdx + 1);

      // Handle error messages from backend
      if (payload.startsWith('ERROR:')) {
        const errorMsg = payload.substring(6);
        const modelIndex = parseInt(indexStr, 10);
        const cols = useCompareStore.getState().columns;
        if (modelIndex >= 0 && modelIndex < cols.length) {
          useCompareStore.getState().setColumnError(cols[modelIndex].modelId, errorMsg);
        }
        return;
      }

      const modelIndex = parseInt(indexStr, 10);
      const cols = useCompareStore.getState().columns;
      if (modelIndex >= 0 && modelIndex < cols.length) {
        useCompareStore.getState().appendColumnToken(cols[modelIndex].modelId, payload);
      }
    };

    try {
      await invoke('send_compare_message', {
        sessionId: currentSessionId,
        content,
        modelConfigs,
        attachmentIds: attachmentIds ?? [],
        onToken,
      });

      // Fetch final messages after completion
      const messages = await invoke<{ role: string; content: string; modelId?: string; providerId?: string }[]>(
        'get_compare_messages',
        { sessionId: currentSessionId }
      );

      // Get assistant messages and find the latest one per model
      const assistantMessages = messages.filter((m) => m.role === 'assistant');
      const cols = useCompareStore.getState().columns;
      useCompareStore.getState().setColumns(
        cols.map((col) => {
          const colMessages = assistantMessages.filter((m) => m.modelId === col.modelId);
          const latestMsg = colMessages[colMessages.length - 1];
          if (latestMsg) {
            return {
              ...col,
              isStreaming: false,
              streamingText: '',
              messages: [...col.messages, {
                id: crypto.randomUUID(),
                compareSessionId: currentSessionId ?? '',
                role: 'assistant' as const,
                content: latestMsg.content,
                modelId: col.modelId,
                providerId: col.providerId,
                createdAt: new Date().toISOString(),
              }],
            };
          }
          return { ...col, isStreaming: false, error: 'Model failed to respond. Check API key and connectivity.' };
        })
      );
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
