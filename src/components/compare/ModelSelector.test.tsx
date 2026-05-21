import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSelector } from './ModelSelector';

const mockAddModel = vi.fn(() => true);
const mockRemoveModel = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: any) => {
    if (cmd === 'list_provider_models') {
      const providerId = args?.providerId;
      const modelsMap: Record<string, any[]> = {
        p1: [
          { id: 'm1', providerId: 'p1', modelId: 'gpt-4o', enabled: true, maxTokens: 4096, temperature: 0.7, createdAt: '', updatedAt: '' },
          { id: 'm2', providerId: 'p1', modelId: 'gpt-4o-mini', enabled: true, maxTokens: 4096, temperature: 0.7, createdAt: '', updatedAt: '' },
        ],
        p2: [
          { id: 'm3', providerId: 'p2', modelId: 'claude-sonnet-4', enabled: true, maxTokens: 4096, temperature: 0.7, createdAt: '', updatedAt: '' },
        ],
        p3: [
          { id: 'm4', providerId: 'p3', modelId: 'gemini-2.5-pro', enabled: true, maxTokens: 4096, temperature: 0.7, createdAt: '', updatedAt: '' },
        ],
      };
      return Promise.resolve(modelsMap[providerId] ?? []);
    }
    return Promise.resolve([]);
  }),
}));

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: (selector: any) => {
    const state = {
      providers: [
        { id: 'p1', name: 'OpenAI', model: 'gpt-4o', isEnabled: true },
        { id: 'p2', name: 'Anthropic', model: 'claude-sonnet-4', isEnabled: true },
        { id: 'p3', name: 'Google', model: 'gemini-2.5-pro', isEnabled: true },
        { id: 'p4', name: 'Ollama', model: 'llama3', isEnabled: false },
      ],
    };
    return selector(state);
  },
}));

let mockSelectedModelIds: string[] = [];

vi.mock('@/stores/useCompareStore', () => ({
  useCompareStore: (selector: any) => {
    const state = {
      selectedModelIds: mockSelectedModelIds,
      addModel: mockAddModel,
      removeModel: mockRemoveModel,
    };
    return selector(state);
  },
}));

describe('ModelSelector', () => {
  beforeEach(() => {
    mockSelectedModelIds = [];
    mockAddModel.mockClear();
    mockRemoveModel.mockClear();
  });

  it('renders all enabled models from all providers as chips', async () => {
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI · gpt-4o')).toBeInTheDocument();
    });

    // OpenAI has 2 models
    expect(screen.getByText('OpenAI · gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('OpenAI · gpt-4o-mini')).toBeInTheDocument();
    // Anthropic has 1 model
    expect(screen.getByText('Anthropic · claude-sonnet-4')).toBeInTheDocument();
    // Google has 1 model
    expect(screen.getByText('Google · gemini-2.5-pro')).toBeInTheDocument();
    // Disabled provider should not appear
    expect(screen.queryByText('Ollama · llama3')).not.toBeInTheDocument();
  });

  it('clicking an unselected chip calls addModel with composite key', async () => {
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI · gpt-4o')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('OpenAI · gpt-4o'));
    expect(mockAddModel).toHaveBeenCalledWith('p1::gpt-4o');
  });

  it('clicking a selected chip calls removeModel with composite key', async () => {
    mockSelectedModelIds = ['p1::gpt-4o'];
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI · gpt-4o')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('OpenAI · gpt-4o'));
    expect(mockRemoveModel).toHaveBeenCalledWith('p1::gpt-4o');
  });

  it('disables unselected chips when 3 models are selected', async () => {
    mockSelectedModelIds = ['p1::gpt-4o', 'p1::gpt-4o-mini', 'p2::claude-sonnet-4'];
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI · gpt-4o')).toBeInTheDocument();
    });

    // Selected chips are not disabled
    const openaiChip = screen.getByText('OpenAI · gpt-4o');
    const miniChip = screen.getByText('OpenAI · gpt-4o-mini');
    const anthropicChip = screen.getByText('Anthropic · claude-sonnet-4');
    const googleChip = screen.getByText('Google · gemini-2.5-pro');

    expect(openaiChip).not.toBeDisabled();
    expect(miniChip).not.toBeDisabled();
    expect(anthropicChip).not.toBeDisabled();
    // Unselected chip should be disabled at max
    expect(googleChip).toBeDisabled();
  });
});
