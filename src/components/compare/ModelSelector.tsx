import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCompareStore } from '@/stores/useCompareStore';
import { cn } from '@/lib/utils';
import type { ProviderModelConfig } from '@/types';

const MAX_MODELS = 3;

interface ModelChip {
  key: string; // "providerId::modelId"
  providerId: string;
  modelId: string;
  providerName: string;
  displayName: string;
}

export const ModelSelector: React.FC = () => {
  const providers = useSettingsStore((s) => s.providers);
  const selectedModelIds = useCompareStore((s) => s.selectedModelIds);
  const addModel = useCompareStore((s) => s.addModel);
  const removeModel = useCompareStore((s) => s.removeModel);

  const enabledProviders = providers.filter((p) => p.isEnabled);
  const isAtMax = selectedModelIds.length >= MAX_MODELS;

  const [modelChips, setModelChips] = useState<ModelChip[]>([]);

  useEffect(() => {
    const loadModels = async () => {
      const chips: ModelChip[] = [];
      for (const provider of enabledProviders) {
        try {
          const models = await invoke<ProviderModelConfig[]>('list_provider_models', {
            providerId: provider.id,
          });
          const enabled = models.filter((m) => m.enabled);
          if (enabled.length > 0) {
            for (const model of enabled) {
              chips.push({
                key: `${provider.id}::${model.modelId}`,
                providerId: provider.id,
                modelId: model.modelId,
                providerName: provider.name,
                displayName: `${provider.name} · ${model.modelId}`,
              });
            }
          } else {
            // Fallback: use provider's default model
            chips.push({
              key: `${provider.id}::${provider.model}`,
              providerId: provider.id,
              modelId: provider.model,
              providerName: provider.name,
              displayName: `${provider.name} · ${provider.model}`,
            });
          }
        } catch {
          // Fallback on error
          chips.push({
            key: `${provider.id}::${provider.model}`,
            providerId: provider.id,
            modelId: provider.model,
            providerName: provider.name,
            displayName: `${provider.name} · ${provider.model}`,
          });
        }
      }
      setModelChips(chips);
    };
    loadModels();
  }, [enabledProviders.length]);

  const handleToggle = (chipKey: string) => {
    if (selectedModelIds.includes(chipKey)) {
      removeModel(chipKey);
    } else if (!isAtMax) {
      addModel(chipKey);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {modelChips.map((chip) => {
        const isSelected = selectedModelIds.includes(chip.key);
        const isDisabled = !isSelected && isAtMax;

        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => handleToggle(chip.key)}
            disabled={isDisabled}
            className={cn(
              'px-3 py-1.5 rounded-full text-[12px] font-medium cursor-pointer transition-colors',
              isSelected
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--fill-quaternary)] text-[var(--text-muted)] border border-[var(--border)]',
              isDisabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            {chip.displayName}
          </button>
        );
      })}
    </div>
  );
};
