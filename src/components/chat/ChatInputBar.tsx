import React, { useRef, useEffect, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Paperclip, ArrowUp, Stop } from '@phosphor-icons/react';
import { ImagePlus, FileUp } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useChatStore } from '@/stores/useChatStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAgentStore } from '@/stores/useAgentStore';
import { useFileStore } from '@/stores/useFileStore';
import { FileChips } from './FileChips';
import type { AttachmentItem } from '@/types';
import { ProviderModelConfig, SELECTABLE_AGENTS, AGENT_LABELS } from '@/types';
import { cn } from '@/lib/utils';

export interface ChatInputBarHandle {
  prefill: (text: string) => void;
}

interface ChatInputBarProps {
  onSend: (content: string, attachmentIds?: string[]) => void;
  onStop?: () => void;
  hideAgentSelector?: boolean;
  hideModelSelector?: boolean;
}

const MAX_HEIGHT = 200;

export const ChatInputBar = React.forwardRef<ChatInputBarHandle, ChatInputBarProps>(({ onSend, onStop, hideAgentSelector, hideModelSelector }, ref) => {
  const { isStreaming } = useChatStore();
  const hasRunningAgent = useAgentStore((s) => s.agentRuns.some((r) => r.status === 'running'));
  const isGenerating = isStreaming || hasRunningAgent;
  const { selectedAgentType, setSelectedAgentType } = useAgentStore();
  const { providers, defaultProviderId, selectedModelId, setDefaultProviderId, setSelectedModelId } =
    useSettingsStore();
  const { pendingFiles, addFile, clearFiles } = useFileStore();

  const [value, setValue] = useState('');
  const [enabledModels, setEnabledModels] = useState<ProviderModelConfig[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  React.useImperativeHandle(ref, () => ({
    prefill: (text: string) => {
      setValue(text);
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
  }));

  // Auto-select provider if only one enabled and none selected
  useEffect(() => {
    const enabled = providers.filter(p => p.isEnabled);
    if (!defaultProviderId && enabled.length > 0) {
      setDefaultProviderId(enabled[0].id);
    }
  }, [providers, defaultProviderId, setDefaultProviderId]);

  // Load enabled models whenever the selected provider changes
  useEffect(() => {
    if (!defaultProviderId) {
      setEnabledModels([]);
      setSelectedModelId(null);
      return;
    }

    invoke<ProviderModelConfig[]>('list_provider_models', { providerId: defaultProviderId })
      .then((models) => {
        const enabled = models.filter((m) => m.enabled);
        if (enabled.length > 0) {
          setEnabledModels(enabled);
          const stillValid = enabled.some((m) => m.modelId === selectedModelId);
          if (!stillValid) {
            setSelectedModelId(enabled[0]?.modelId ?? null);
          }
        } else {
          // Fallback: try list_models command
          invoke<string[]>('list_models', { providerId: defaultProviderId })
            .then((allModels) => {
              const asFake = allModels.map((id) => ({ modelId: id, enabled: true, providerId: defaultProviderId!, id: id, maxTokens: 4096, temperature: 0.7, createdAt: '', updatedAt: '' }));
              setEnabledModels(asFake);
              if (!allModels.includes(selectedModelId ?? '')) {
                setSelectedModelId(allModels[0] ?? null);
              }
            })
            .catch(() => {
              const prov = providers.find(p => p.id === defaultProviderId);
              if (prov?.model) {
                setEnabledModels([{ modelId: prov.model, enabled: true, providerId: prov.id, id: prov.model, maxTokens: 4096, temperature: 0.7, createdAt: '', updatedAt: '' }]);
                setSelectedModelId(prov.model);
              }
            });
        }
      })
      .catch(() => {
        setEnabledModels([]);
        setSelectedModelId(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultProviderId]);

  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed && pendingFiles.length === 0) return;
    if (isGenerating) return;

    const attachmentIds = pendingFiles
      .filter(f => f.status === 'ready')
      .map(f => f.id);

    onSend(trimmed || '', attachmentIds.length > 0 ? attachmentIds : undefined);
    setValue('');
    clearFiles();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isGenerating, onSend, pendingFiles, clearFiles]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = (value.trim().length > 0 || pendingFiles.length > 0) && !isGenerating;

  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const handleAttachImage = useCallback(async () => {
    setShowAttachMenu(false);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const result = await invoke<{ attachments: AttachmentItem[]; errors: Array<{ filePath: string; error: string }> }>('attach_files', { filePaths: paths });
        for (const att of result.attachments) {
          addFile({ ...att, status: 'ready' });
        }
        if (result.errors.length > 0) {
          console.error('Some files failed to attach:', result.errors);
        }
      }
    } catch (err) {
      console.error('File attach failed:', err);
    }
  }, [addFile]);

  const handleAttachFile = useCallback(async () => {
    setShowAttachMenu(false);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Documents', extensions: ['pdf', 'txt', 'md'] }],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const result = await invoke<{ attachments: AttachmentItem[]; errors: Array<{ filePath: string; error: string }> }>('attach_files', { filePaths: paths });
        for (const att of result.attachments) {
          addFile({ ...att, status: 'ready' });
        }
        if (result.errors.length > 0) {
          console.error('Some files failed to attach:', result.errors);
        }
      }
    } catch (err) {
      console.error('File attach failed:', err);
    }
  }, [addFile]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length === 0) return; // Let normal text paste through

    e.preventDefault();

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;

      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      addFile({
        id,
        fileName: `clipboard-${Date.now()}.png`,
        fileSize: file.size,
        mimeType: file.type,
        filePath: '',
        previewUrl,
        status: 'pending',
      });
    }
  }, [addFile]);

  return (
    <div className="px-4 pb-3 pt-2">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-2">
        {/* Main input container — LobeHub style */}
        <div
          className={cn(
            'relative flex flex-col rounded-[var(--radius-lg)] border transition-all duration-200',
            'bg-[var(--surface-2)] border-[var(--border)]',
            'focus-within:border-[var(--text-subtle)] focus-within:shadow-[0_0_0_1px_var(--fill-secondary)]'
          )}
        >
          {/* FileChips above textarea */}
          {pendingFiles.length > 0 && <FileChips />}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isGenerating}
            placeholder="Ask, create, or start a task. @ to assign tasks to other agents."
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent px-4 pt-4 pb-2',
              'text-[14px] leading-relaxed text-[var(--text)]',
              'placeholder:text-[var(--text-subtle)]',
              'custom-scrollbar',
              isGenerating && 'opacity-50 cursor-not-allowed'
            )}
            style={{ minHeight: '36px', maxHeight: `${MAX_HEIGHT}px`, outline: 'none' }}
          />

          {/* Action bar — icons left, send button right */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            {/* Left actions */}
            <div className="flex items-center gap-1">
              {!hideAgentSelector && (
                <Select
                  value={selectedAgentType}
                  onValueChange={(val: any) => setSelectedAgentType(val)}
                  disabled={isGenerating}
                >
                  <SelectTrigger className="h-8 text-[12px] gap-1 px-2 max-w-[110px] bg-transparent border-none shadow-none text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--fill-tertiary)] rounded-[var(--radius-sm)] transition-colors">
                    <SelectValue placeholder="Agent" />
                  </SelectTrigger>
                  <SelectContent side="top" align="start">
                    {SELECTABLE_AGENTS.map((agent) => (
                      <SelectItem key={agent} value={agent}>
                        {AGENT_LABELS[agent]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  disabled={isGenerating}
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] transition-colors',
                    'text-[var(--text-subtle)] hover:text-[var(--text-muted)] hover:bg-[var(--fill-tertiary)]',
                    'disabled:opacity-30 disabled:cursor-not-allowed',
                    showAttachMenu && 'bg-[var(--fill-tertiary)] text-[var(--text-muted)]'
                  )}
                  title="Attach file"
                >
                  <Paperclip size={18} />
                </button>

                {showAttachMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowAttachMenu(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-2 z-50 min-w-[180px] py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-lg backdrop-blur-none">
                      <button
                        type="button"
                        onClick={handleAttachImage}
                        className="flex items-center gap-3 w-full px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--fill-tertiary)] transition-colors"
                      >
                        <ImagePlus size={16} className="text-[var(--text-muted)]" />
                        <span>Upload Image</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleAttachFile}
                        className="flex items-center gap-3 w-full px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--fill-tertiary)] transition-colors"
                      >
                        <FileUp size={16} className="text-[var(--text-muted)]" />
                        <span>Upload File</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right — Send button (circular, LobeHub style) */}
            <div>
              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--text)] text-[var(--bg)] hover:opacity-80 transition-all active:scale-95"
                  title="Stop generating"
                >
                  <Stop size={16} weight="fill" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-full transition-all active:scale-95',
                    canSend
                      ? 'bg-[var(--text)] text-[var(--bg)] hover:opacity-80'
                      : 'bg-[var(--fill-secondary)] text-[var(--text-subtle)] cursor-not-allowed'
                  )}
                  title="Send (Enter)"
                >
                  <ArrowUp size={18} weight="bold" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Runtime config bar — below container, LobeHub style */}
        {!hideModelSelector && (
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1">
              {/* Provider selector */}
              {providers.filter((p) => p.isEnabled).length > 0 && (
                <Select value={defaultProviderId ?? undefined} onValueChange={setDefaultProviderId} disabled={isGenerating}>
                  <SelectTrigger className="h-7 text-[12px] gap-1 px-2 bg-transparent border-none shadow-none text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--fill-tertiary)] rounded-[var(--radius-sm)] transition-colors max-w-[140px]">
                    <SelectValue placeholder="Provider" />
                  </SelectTrigger>
                  <SelectContent side="top" align="start">
                    {providers.filter((p) => p.isEnabled).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Model selector */}
              {enabledModels.length > 0 && (
                <Select value={selectedModelId ?? undefined} onValueChange={setSelectedModelId} disabled={isGenerating}>
                  <SelectTrigger className="h-7 text-[12px] gap-1 px-2 bg-transparent border-none shadow-none text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--fill-tertiary)] rounded-[var(--radius-sm)] transition-colors max-w-[200px]">
                    <SelectValue placeholder="Model" />
                  </SelectTrigger>
                  <SelectContent side="top" align="start">
                    {enabledModels.map((m) => (
                      <SelectItem key={m.modelId} value={m.modelId}>{m.modelId}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Right side — mode indicator */}
            <div className="text-[11px] text-[var(--text-subtle)]">
              Enter to send · Shift+Enter for newline
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

ChatInputBar.displayName = 'ChatInputBar';
