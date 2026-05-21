import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpTab } from '../McpTab';
import { useMcpStore } from '@/stores/useMcpStore';
import { McpServer } from '@/types';

// Mock the store
vi.mock('@/stores/useMcpStore');

const mockLoadServers = vi.fn();
const mockToggleServer = vi.fn();
const mockRemoveServer = vi.fn();

const createServer = (overrides: Partial<McpServer> = {}): McpServer => ({
  id: 'srv-1',
  name: 'filesystem',
  transportType: 'stdio',
  command: 'npx',
  args: ['-y', '@mcp/fs'],
  authType: 'none',
  enabled: true,
  status: 'connected',
  toolsCount: 3,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

function mockStoreState(servers: McpServer[]) {
  vi.mocked(useMcpStore).mockReturnValue({
    servers,
    loadServers: mockLoadServers,
    toggleServer: mockToggleServer,
    removeServer: mockRemoveServer,
  } as any);
}

describe('McpTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadServers.mockResolvedValue(undefined);
    mockToggleServer.mockResolvedValue(undefined);
    mockRemoveServer.mockResolvedValue(undefined);
  });

  describe('empty state', () => {
    it('renders empty state when no servers', () => {
      mockStoreState([]);
      render(<McpTab />);

      expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
      expect(screen.getByText('Add a server to extend your tools')).toBeInTheDocument();
    });

    it('renders Add Server button in empty state', () => {
      mockStoreState([]);
      render(<McpTab />);

      expect(screen.getByText('Add Server')).toBeInTheDocument();
    });

    it('calls onAddServer when empty state button clicked', () => {
      mockStoreState([]);
      const onAddServer = vi.fn();
      render(<McpTab onAddServer={onAddServer} />);

      fireEvent.click(screen.getByText('Add Server'));
      expect(onAddServer).toHaveBeenCalledTimes(1);
    });
  });

  describe('server list rendering', () => {
    it('renders server names', () => {
      mockStoreState([
        createServer({ id: '1', name: 'filesystem' }),
        createServer({ id: '2', name: 'github' }),
      ]);
      render(<McpTab />);

      expect(screen.getByText('filesystem')).toBeInTheDocument();
      expect(screen.getByText('github')).toBeInTheDocument();
    });

    it('renders transport type badges', () => {
      mockStoreState([
        createServer({ id: '1', transportType: 'stdio' }),
        createServer({ id: '2', transportType: 'http' }),
      ]);
      render(<McpTab />);

      expect(screen.getByText('stdio')).toBeInTheDocument();
      expect(screen.getByText('http')).toBeInTheDocument();
    });

    it('renders tools count', () => {
      mockStoreState([createServer({ toolsCount: 5 })]);
      render(<McpTab />);

      expect(screen.getByText('(5 tools)')).toBeInTheDocument();
    });

    it('renders singular tool count', () => {
      mockStoreState([createServer({ toolsCount: 1 })]);
      render(<McpTab />);

      expect(screen.getByText('(1 tool)')).toBeInTheDocument();
    });

    it('does not render tools count when zero', () => {
      mockStoreState([createServer({ toolsCount: 0 })]);
      render(<McpTab />);

      expect(screen.queryByText(/tool/)).toBeNull();
    });

    it('renders header with MCP Servers title', () => {
      mockStoreState([createServer()]);
      render(<McpTab />);

      expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    });

    it('renders Quick Import button in header', () => {
      mockStoreState([createServer()]);
      render(<McpTab />);

      expect(screen.getByText('Quick Import')).toBeInTheDocument();
    });
  });

  describe('toggle server', () => {
    it('calls toggleServer when toggle button clicked', () => {
      const server = createServer({ id: 'srv-1', enabled: true });
      mockStoreState([server]);
      render(<McpTab />);

      const toggleBtn = screen.getByTitle('Disable');
      fireEvent.click(toggleBtn);

      expect(mockToggleServer).toHaveBeenCalledWith('srv-1', false);
    });

    it('calls toggleServer with true for disabled server', () => {
      const server = createServer({ id: 'srv-2', enabled: false });
      mockStoreState([server]);
      render(<McpTab />);

      const toggleBtn = screen.getByTitle('Enable');
      fireEvent.click(toggleBtn);

      expect(mockToggleServer).toHaveBeenCalledWith('srv-2', true);
    });
  });

  describe('delete server', () => {
    it('requires double click to delete (confirmation)', () => {
      const server = createServer({ id: 'srv-1' });
      mockStoreState([server]);
      render(<McpTab />);

      const deleteBtn = screen.getByTitle('Delete server');
      fireEvent.click(deleteBtn);

      // First click changes to confirm state
      expect(mockRemoveServer).not.toHaveBeenCalled();
      expect(screen.getByTitle('Click again to confirm')).toBeInTheDocument();
    });

    it('calls removeServer on second click', () => {
      const server = createServer({ id: 'srv-1' });
      mockStoreState([server]);
      render(<McpTab />);

      const deleteBtn = screen.getByTitle('Delete server');
      fireEvent.click(deleteBtn);

      // Second click confirms
      const confirmBtn = screen.getByTitle('Click again to confirm');
      fireEvent.click(confirmBtn);

      expect(mockRemoveServer).toHaveBeenCalledWith('srv-1');
    });
  });

  describe('callbacks', () => {
    it('calls onAddServer when Add Server header button clicked', () => {
      mockStoreState([createServer()]);
      const onAddServer = vi.fn();
      render(<McpTab onAddServer={onAddServer} />);

      fireEvent.click(screen.getByText('Add Server'));
      expect(onAddServer).toHaveBeenCalledTimes(1);
    });

    it('calls onQuickImport when Quick Import button clicked', () => {
      mockStoreState([createServer()]);
      const onQuickImport = vi.fn();
      render(<McpTab onQuickImport={onQuickImport} />);

      fireEvent.click(screen.getByText('Quick Import'));
      expect(onQuickImport).toHaveBeenCalledTimes(1);
    });

    it('calls onEditServer when edit button clicked', () => {
      const server = createServer({ id: 'srv-1' });
      mockStoreState([server]);
      const onEditServer = vi.fn();
      render(<McpTab onEditServer={onEditServer} />);

      const editBtn = screen.getByTitle('Edit server');
      fireEvent.click(editBtn);

      expect(onEditServer).toHaveBeenCalledWith(server);
    });
  });

  describe('loadServers on mount', () => {
    it('calls loadServers on mount', () => {
      mockStoreState([]);
      render(<McpTab />);

      expect(mockLoadServers).toHaveBeenCalledTimes(1);
    });
  });
});
