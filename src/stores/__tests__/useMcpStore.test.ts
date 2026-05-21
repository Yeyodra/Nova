import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { useMcpStore } from '../useMcpStore';

describe('useMcpStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useMcpStore.setState({
      servers: [],
      tools: {},
      isLoading: false,
      testResult: {},
      error: null,
    });
  });

  it('loadServers populates state from backend', async () => {
    mockInvoke.mockResolvedValueOnce([
      { id: '1', name: 'fs', transportType: 'stdio', enabled: true, status: 'disconnected', toolsCount: 3 },
      { id: '2', name: 'git', transportType: 'stdio', enabled: false, status: 'disconnected', toolsCount: 0 },
    ]);

    await useMcpStore.getState().loadServers();

    expect(useMcpStore.getState().servers).toHaveLength(2);
    expect(useMcpStore.getState().servers[0].name).toBe('fs');
    expect(useMcpStore.getState().isLoading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('list_mcp_servers');
  });

  it('loadServers sets error on failure', async () => {
    mockInvoke.mockRejectedValueOnce('Network error');

    await useMcpStore.getState().loadServers();

    expect(useMcpStore.getState().error).toBe('Network error');
    expect(useMcpStore.getState().isLoading).toBe(false);
    expect(useMcpStore.getState().servers).toEqual([]);
  });

  it('addServer appends to state and returns server', async () => {
    const newServer = {
      id: '3',
      name: 'test',
      transportType: 'http' as const,
      enabled: true,
      status: 'disconnected' as const,
      toolsCount: 0,
      authType: 'none' as const,
      createdAt: '',
      updatedAt: '',
    };
    mockInvoke.mockResolvedValueOnce(newServer);

    const result = await useMcpStore.getState().addServer({ name: 'test' });

    expect(result).toEqual(newServer);
    expect(useMcpStore.getState().servers).toHaveLength(1);
    expect(useMcpStore.getState().servers[0].name).toBe('test');
    expect(mockInvoke).toHaveBeenCalledWith('add_mcp_server', { config: expect.objectContaining({ name: 'test' }) });
  });

  it('addServer returns null on error', async () => {
    mockInvoke.mockRejectedValueOnce('Failed to add');

    const result = await useMcpStore.getState().addServer({ name: 'bad' });

    expect(result).toBeNull();
    expect(useMcpStore.getState().error).toBe('Failed to add');
  });

  it('removeServer removes from state', async () => {
    useMcpStore.setState({
      servers: [{ id: '1', name: 'fs' } as any, { id: '2', name: 'git' } as any],
      tools: { '1': [{ name: 'read' } as any] },
    });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useMcpStore.getState().removeServer('1');

    expect(useMcpStore.getState().servers).toHaveLength(1);
    expect(useMcpStore.getState().servers[0].id).toBe('2');
    expect(useMcpStore.getState().tools['1']).toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('remove_mcp_server', { id: '1' });
  });

  it('toggleServer updates enabled state', async () => {
    useMcpStore.setState({
      servers: [{ id: '1', name: 'fs', enabled: true } as any],
    });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useMcpStore.getState().toggleServer('1', false);

    expect(useMcpStore.getState().servers[0].enabled).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('toggle_mcp_server', { id: '1', enabled: false });
  });

  it('updateServer replaces server in state', async () => {
    const original = { id: '1', name: 'fs', transportType: 'stdio', enabled: true } as any;
    useMcpStore.setState({ servers: [original] });
    mockInvoke.mockResolvedValueOnce(undefined);

    const updated = { ...original, name: 'filesystem' };
    await useMcpStore.getState().updateServer(updated);

    expect(useMcpStore.getState().servers[0].name).toBe('filesystem');
    expect(mockInvoke).toHaveBeenCalledWith('update_mcp_server', { config: expect.objectContaining({ name: 'filesystem' }) });
  });

  it('testConnection stores success result', async () => {
    const tools = [{ name: 'read', description: 'Read file', inputSchema: {} }];
    mockInvoke.mockResolvedValueOnce(tools);

    const result = await useMcpStore.getState().testConnection({ id: 'srv1' });

    expect(result).toEqual(tools);
    expect(useMcpStore.getState().testResult['srv1']).toEqual({ success: true, tools });
  });

  it('testConnection stores failure result and returns empty array', async () => {
    mockInvoke.mockRejectedValueOnce('Connection refused');

    const result = await useMcpStore.getState().testConnection({ id: 'srv2' });

    expect(result).toEqual([]);
    expect(useMcpStore.getState().testResult['srv2']).toEqual({
      success: false,
      error: 'Connection refused',
    });
  });

  it('testConnection uses "new" key when config has no id', async () => {
    mockInvoke.mockResolvedValueOnce([]);

    await useMcpStore.getState().testConnection({});

    expect(useMcpStore.getState().testResult['new']).toEqual({ success: true, tools: [] });
  });

  it('refreshTools populates tools for a server', async () => {
    const tools = [{ name: 'list', description: 'List files', inputSchema: {} }];
    mockInvoke.mockResolvedValueOnce(tools);

    await useMcpStore.getState().refreshTools('srv1');

    expect(useMcpStore.getState().tools['srv1']).toEqual(tools);
    expect(mockInvoke).toHaveBeenCalledWith('get_mcp_tools', { serverId: 'srv1' });
  });
});
