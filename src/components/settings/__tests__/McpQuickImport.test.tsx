import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McpQuickImport } from '../McpQuickImport';

describe('McpQuickImport', () => {
  const mockOnImport = vi.fn();
  const mockOnClose = vi.fn();

  const renderComponent = () =>
    render(<McpQuickImport onImport={mockOnImport} onClose={mockOnClose} />);

  const pasteAndParse = (json: string) => {
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: json } });
    fireEvent.click(screen.getByText('Parse'));
  };

  beforeEach(() => {
    mockOnImport.mockReset();
    mockOnClose.mockReset();
  });

  it('parses Claude Desktop format with single server', () => {
    renderComponent();
    pasteAndParse(JSON.stringify({
      mcpServers: {
        fs: { command: 'npx', args: ['-y', '@mcp/server-fs'] },
      },
    }));

    expect(screen.getByText('Found 1 server:')).toBeInTheDocument();
    expect(screen.getByText('fs')).toBeInTheDocument();
  });

  it('parses Claude Desktop format with multiple servers', () => {
    renderComponent();
    pasteAndParse(JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@mcp/fs'] },
        github: { command: 'npx', args: ['-y', '@mcp/github'] },
        web: { url: 'http://localhost:3000/mcp' },
      },
    }));

    expect(screen.getByText('Found 3 servers:')).toBeInTheDocument();
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
  });

  it('parses single server object with command', () => {
    renderComponent();
    pasteAndParse(JSON.stringify({
      command: 'echo',
      args: ['hello'],
    }));

    expect(screen.getByText('Found 1 server:')).toBeInTheDocument();
    // Server name derived from command — appears as both name and command display
    expect(screen.getAllByText('echo').length).toBeGreaterThanOrEqual(1);
  });

  it('parses single server object with url', () => {
    renderComponent();
    pasteAndParse(JSON.stringify({
      url: 'http://api.example.com/mcp',
    }));

    expect(screen.getByText('Found 1 server:')).toBeInTheDocument();
    expect(screen.getByText('api.example.com')).toBeInTheDocument();
  });

  it('shows error for invalid JSON', () => {
    renderComponent();
    pasteAndParse('{ not valid json }}}');

    expect(screen.getByText('Invalid JSON syntax')).toBeInTheDocument();
    expect(screen.queryByText(/Found/)).toBeNull();
  });

  it('shows error for empty input', () => {
    renderComponent();
    fireEvent.click(screen.getByText('Parse'));

    expect(screen.getByText('Please paste JSON configuration')).toBeInTheDocument();
  });

  it('shows error for unrecognized format', () => {
    renderComponent();
    pasteAndParse(JSON.stringify({ foo: 'bar' }));

    expect(screen.getByText('Unrecognized format. Expected Claude Desktop config or a single server object.')).toBeInTheDocument();
  });

  it('calls onImport with parsed servers when import clicked', () => {
    renderComponent();
    pasteAndParse(JSON.stringify({
      mcpServers: {
        myserver: { command: 'node', args: ['server.js'] },
      },
    }));

    fireEvent.click(screen.getByText('Import All'));

    expect(mockOnImport).toHaveBeenCalledTimes(1);
    expect(mockOnImport).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'myserver',
        transportType: 'stdio',
        command: 'node',
        args: ['server.js'],
        enabled: true,
      }),
    ]);
  });

  it('calls onClose when close button clicked', () => {
    renderComponent();
    // The X button is the only button initially besides Parse
    const closeButton = screen.getByRole('button', { name: '' });
    // Actually find by the X icon's parent button — use getAllByRole and find the close one
    const buttons = screen.getAllByRole('button');
    // First button in header is close
    fireEvent.click(buttons[0]);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
