import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSelector } from './ModelSelector';

const mockAddModel = vi.fn(() => true);
const mockRemoveModel = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'list_provider_models') {
      const providerId = (args as { providerId?: string })?.providerId;
      const modelsMap: Record<string, unknown[]> = {
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
      return Promise.resolve(modelsMap[providerId ?? ''] ?? []);
    }
    return Promise.resolve([]);
  }),
}));

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => {
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
  useCompareStore: (selector: (state: Record<string, unknown>) => unknown) => {
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

  it('renders the Add Model button', async () => {
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('Add Model')).toBeInTheDocument();
    });
  });

  it('opens dropdown when Add Model is clicked and shows models grouped by provider', async () => {
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('Add Model')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Model'));

    // Provider group headers should appear
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();

    // Model IDs should appear in dropdown
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();

    // Disabled provider should not appear
    expect(screen.queryByText('Ollama')).not.toBeInTheDocument();
    expect(screen.queryByText('llama3')).not.toBeInTheDocument();
  });

  it('clicking a model in dropdown calls addModel with composite key', async () => {
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('Add Model')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Model'));
    fireEvent.click(screen.getByText('gpt-4o'));

    expect(mockAddModel).toHaveBeenCalledWith('p1::gpt-4o');
  });

  it('clicking an already-selected model in dropdown calls removeModel', async () => {
    mockSelectedModelIds = ['p1::gpt-4o'];
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('Add Model')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Model'));
    fireEvent.click(screen.getByText('gpt-4o'));

    expect(mockRemoveModel).toHaveBeenCalledWith('p1::gpt-4o');
  });

  it('shows selected models as removable chips', async () => {
    mockSelectedModelIds = ['p1::gpt-4o', 'p2::claude-sonnet-4'];
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI · gpt-4o')).toBeInTheDocument();
    });

    expect(screen.getByText('Anthropic · claude-sonnet-4')).toBeInTheDocument();

    // Remove buttons should exist
    expect(screen.getByLabelText('Remove OpenAI · gpt-4o')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Anthropic · claude-sonnet-4')).toBeInTheDocument();
  });

  it('clicking X on a chip calls removeModel', async () => {
    mockSelectedModelIds = ['p1::gpt-4o'];
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('OpenAI · gpt-4o')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Remove OpenAI · gpt-4o'));
    expect(mockRemoveModel).toHaveBeenCalledWith('p1::gpt-4o');
  });

  it('disables Add Model button and shows count when 3 models selected', async () => {
    mockSelectedModelIds = ['p1::gpt-4o', 'p1::gpt-4o-mini', 'p2::claude-sonnet-4'];
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('3/3 selected')).toBeInTheDocument();
    });

    const addButton = screen.getByText('3/3 selected').closest('button');
    expect(addButton).toBeDisabled();
  });

  it('closes dropdown on outside click', async () => {
    render(<ModelSelector />);

    await waitFor(() => {
      expect(screen.getByText('Add Model')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Model'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
