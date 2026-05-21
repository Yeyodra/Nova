import React, { useEffect, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { ModelSelector } from './ModelSelector';
import { CompareColumn } from './CompareColumn';
import { ChatInputBar } from '@/components/chat/ChatInputBar';
import { useCompareStore } from '@/stores/useCompareStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { CompareSession, CompareMessage, CompareColumn as CompareColumnType } from '@/types/compare';

/** Backend sends modelIds as a JSON string — parse it into a real array */
function parseModelIds(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Normalize a session from backend (parse modelIds JSON string) */
function normalizeSession(session: CompareSession): CompareSession {
  return { ...session, modelIds: parseModelIds(session.modelIds as unknown as string | string[]) };
}

export const ComparePage: React.FC = () => {
  const columns = useCompareStore((s) => s.columns);
  const selectedModelIds = useCompareStore((s) => s.selectedModelIds);
  const activeCompareSessionId = useCompareStore((s) => s.activeCompareSessionId);
  const [isSending, setIsSending] = useState(false);

  // Load session list on mount
  useEffect(() => {
    invoke<CompareSession[]>('list_compare_sessions')
      .then((sessions) => {
        useCompareStore.getState().setCompareSessions(sessions.map(normalizeSession));
      })
      .catch(console.error);
  }, []);

  // Load messages when a past session is selected
  useEffect(() => {
    if (!activeCompareSessionId || isSending) return;

    invoke<CompareMessage[]>('get_compare_messages', { sessionId: activeCompareSessionId })
      .then((messages) => {
        const session = useCompareStore.getState().compareSessions.find(
          (s) => s.id === activeCompareSessionId
        );
        if (!session) return;

        const modelIds: string[] = session.modelIds;
        const providers = useSettingsStore.getState().providers;
        const assistantMessages = messages.filter((m) => m.role === 'assistant');

        const loadedColumns: CompareColumnType[] = modelIds.map((compositeKey) => {
          const [providerId, modelId] = compositeKey.split('::');
          const provider = providers.find((p) => p.id === providerId);
          const colMessages = assistantMessages.filter((m) => m.modelId === modelId);
          const lastMessage = colMessages[colMessages.length - 1];

          return {
            modelId,
            providerId,
            modelName: modelId,
            providerName: provider?.name ?? providerId,
            isStreaming: false,
            streamingText: lastMessage?.content ?? '',
            messages: colMessages,
            error: undefined,
          };
        });

        useCompareStore.getState().setColumns(loadedColumns);
        useCompareStore.getState().setSelectedModels(modelIds);
      })
      .catch(console.error);
  }, [activeCompareSessionId, isSending]);

  const handleSend = async (content: string, _attachmentIds?: string[]) => {
    if (selectedModelIds.length < 2) return;
    if (!content.trim()) return;

    const providers = useSettingsStore.getState().providers;

    // Build model configs from composite keys "providerId::modelId"
    const modelConfigs = selectedModelIds.map((compositeKey) => {
      const [providerId, modelId] = compositeKey.split('::');
      return { providerId, modelId };
    });

    // Create or reuse session
    let sessionId = activeCompareSessionId;
    if (!sessionId) {
      try {
        const session = await invoke<CompareSession>('create_compare_session', {
          modelIds: selectedModelIds,
        });
        sessionId = session.id;
        useCompareStore.getState().setActiveCompareSession(session.id);
        useCompareStore.getState().addCompareSession(normalizeSession(session));
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
      // Tokens arrive interleaved from all models on a shared channel.
      // v1: we don't demux per-column, just wait for completion.
    };

    try {
      await invoke('send_compare_message', {
        sessionId,
        content,
        modelConfigs,
        onToken,
      });

      // Fetch final messages after completion
      const messages = await invoke<CompareMessage[]>('get_compare_messages', {
        sessionId,
      });

      // Group assistant messages by modelId into columns
      // If a model failed, it won't have an assistant message — detect as error
      const assistantMessages = messages.filter((m) => m.role === 'assistant');
      const updatedColumns: CompareColumnType[] = selectedModelIds.map((compositeKey) => {
        const [providerId, modelId] = compositeKey.split('::');
        const provider = providers.find((p) => p.id === providerId);
        const colMessages = assistantMessages.filter((m) => m.modelId === modelId);
        const hasError = colMessages.length === 0;
        return {
          modelId,
          providerId,
          modelName: modelId,
          providerName: provider?.name ?? providerId,
          isStreaming: false,
          streamingText: '',
          messages: colMessages,
          error: hasError ? 'Model failed to respond. Check API key and connectivity.' : undefined,
        };
      });
      useCompareStore.getState().setColumns(updatedColumns);
    } catch (err) {
      // On error, mark all columns with error state
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
    const sessionId = useCompareStore.getState().activeCompareSessionId;
    if (sessionId) {
      invoke('cancel_compare', { sessionId }).catch(console.error);
      const cols = useCompareStore.getState().columns;
      useCompareStore.getState().setColumns(
        cols.map((c) => ({ ...c, isStreaming: false }))
      );
      setIsSending(false);
    }
  };

  const handleRetry = (providerId: string) => {
    // v1: backend sends all models at once, so we can't retry a single model.
    // Clear the error state so user knows to re-send the prompt.
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
            <CompareColumn key={col.providerId} column={col} onUseModel={handleUseModel} onRetry={handleRetry} />
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
