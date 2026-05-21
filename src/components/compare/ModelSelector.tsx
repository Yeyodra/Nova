import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plus, X, Check } from '@phosphor-icons/react';
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

interface GroupedModels {
  providerName: string;
  models: ModelChip[];
}

export const ModelSelector: React.FC = () => {
  const providers = useSettingsStore((s) => s.providers);
  const selectedModelIds = useCompareStore((s) => s.selectedModelIds);
  const addModel = useCompareStore((s) => s.addModel);
  const removeModel = useCompareStore((s) => s.removeModel);

  const enabledProviders = providers.filter((p) => p.isEnabled);
  const isAtMax = selectedModelIds.length >= MAX_MODELS;

  const [modelChips, setModelChips] = useState<ModelChip[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-close dropdown when max reached
  useEffect(() => {
    if (isAtMax) {
      setIsOpen(false);
    }
  }, [isAtMax]);

  const groupedModels = useMemo<GroupedModels[]>(() => {
    const groups: Record<string, ModelChip[]> = {};
    for (const chip of modelChips) {
      if (!groups[chip.providerName]) {
        groups[chip.providerName] = [];
      }
      groups[chip.providerName].push(chip);
    }

    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([providerName, models]) => ({
        providerName,
        models: models.sort((a, b) => a.modelId.localeCompare(b.modelId)),
      }));
  }, [modelChips]);

  const selectedChips = useMemo(
    () => modelChips.filter((chip) => selectedModelIds.includes(chip.key)),
    [modelChips, selectedModelIds]
  );

  const handleDropdownSelect = (chipKey: string) => {
    if (selectedModelIds.includes(chipKey)) {
      removeModel(chipKey);
    } else {
      addModel(chipKey);
    }
  };

  const handleRemoveChip = (chipKey: string) => {
    removeModel(chipKey);
  };

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {/* Selected model chips */}
      {selectedChips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 px-2.5 py-1 rounded-md text-[12px]"
        >
          {chip.displayName}
          <button
            type="button"
            onClick={() => handleRemoveChip(chip.key)}
            className="ml-0.5 hover:text-red-400 transition-colors"
            aria-label={`Remove ${chip.displayName}`}
          >
            <X size={12} weight="bold" />
          </button>
        </span>
      ))}

      {/* Add Model button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isAtMax}
        className={cn(
          'inline-flex items-center gap-1 bg-[var(--fill-quaternary)] border border-dashed border-[var(--border)] text-[var(--text-muted)] px-3 py-1 rounded-md text-[12px] transition-colors',
          !isAtMax && 'hover:border-[var(--accent)] hover:text-[var(--accent)]',
          isAtMax && 'opacity-50 cursor-not-allowed'
        )}
      >
        {isAtMax ? (
          <span>{MAX_MODELS}/{MAX_MODELS} selected</span>
        ) : (
          <>
            <Plus size={12} weight="bold" />
            <span>Add Model</span>
          </>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && !isAtMax && (
        <div
          ref={dropdownRef}
          className="absolute top-full mt-1 right-0 w-64 max-h-72 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-lg z-50"
          role="listbox"
          aria-label="Select models"
        >
          {groupedModels.map((group) => (
            <div key={group.providerName}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium text-[var(--text-subtle)] bg-[var(--fill-quaternary)] sticky top-0">
                {group.providerName}
              </div>
              {group.models.map((model) => {
                const isSelected = selectedModelIds.includes(model.key);
                return (
                  <button
                    key={model.key}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleDropdownSelect(model.key)}
                    className={cn(
                      'w-full px-3 py-2 text-[12px] text-left hover:bg-[var(--fill-tertiary)] cursor-pointer flex items-center justify-between transition-colors',
                      isSelected ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                    )}
                  >
                    <span>{model.modelId}</span>
                    {isSelected && <Check size={14} weight="bold" className="text-[var(--accent)]" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
