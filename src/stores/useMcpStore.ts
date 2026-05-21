import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { McpServer, McpTool } from '@/types';

/** Convert frontend McpServer to backend McpServerConfig format.
 * Backend expects args/envVars/headers as JSON-encoded strings, not raw arrays/objects.
 * Also ensures all required backend fields have defaults. */
function serializeConfigForBackend(config: Partial<McpServer>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    // Provide defaults for required backend fields
    id: config.id ?? '',
    name: config.name ?? 'server',
    transportType: config.transportType ?? 'stdio',
    authType: config.authType ?? 'none',
    enabled: config.enabled ?? true,
    status: 'disconnected',
    toolsCount: 0,
    createdAt: config.createdAt ?? new Date().toISOString(),
    updatedAt: config.updatedAt ?? new Date().toISOString(),
    // Optional fields
    command: config.command ?? null,
    url: config.url ?? null,
    authToken: config.authToken ?? null,
  };

  // Backend expects args as JSON string: '["arg1", "arg2"]'
  if (Array.isArray(config.args) && config.args.length > 0) {
    serialized.args = JSON.stringify(config.args);
  } else {
    serialized.args = null;
  }

  // Backend expects envVars as JSON string: '{"KEY": "value"}'
  if (config.envVars && typeof config.envVars === 'object' && Object.keys(config.envVars).length > 0) {
    serialized.envVars = JSON.stringify(config.envVars);
  } else {
    serialized.envVars = null;
  }

  // Backend expects headers as JSON string: '{"Header": "value"}'
  if (config.headers && typeof config.headers === 'object' && Object.keys(config.headers).length > 0) {
    serialized.headers = JSON.stringify(config.headers);
  } else {
    serialized.headers = null;
  }

  return serialized;
}

/** Convert backend McpServerConfig response back to frontend McpServer format.
 * Backend returns args/envVars/headers as JSON-encoded strings. */
function deserializeConfigFromBackend(server: Record<string, unknown>): McpServer {
  const deserialized = { ...server } as Record<string, unknown>;

  if (typeof server.args === 'string') {
    try { deserialized.args = JSON.parse(server.args as string); } catch { deserialized.args = []; }
  }

  if (typeof server.envVars === 'string') {
    try { deserialized.envVars = JSON.parse(server.envVars as string); } catch { deserialized.envVars = {}; }
  }

  if (typeof server.headers === 'string') {
    try { deserialized.headers = JSON.parse(server.headers as string); } catch { deserialized.headers = {}; }
  }

  return deserialized as unknown as McpServer;
}

interface McpState {
  servers: McpServer[];
  tools: Record<string, McpTool[]>;
  isLoading: boolean;
  testResult: Record<string, { success: boolean; tools?: McpTool[]; error?: string }>;
  error: string | null;
  loadServers: () => Promise<void>;
  addServer: (config: Partial<McpServer>) => Promise<McpServer | null>;
  updateServer: (config: McpServer) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  toggleServer: (id: string, enabled: boolean) => Promise<void>;
  testConnection: (config: Partial<McpServer>) => Promise<McpTool[]>;
  refreshTools: (serverId: string) => Promise<void>;
}

export const useMcpStore = create<McpState>((set) => ({
  servers: [],
  tools: {},
  isLoading: false,
  testResult: {},
  error: null,

  loadServers: async () => {
    set({ isLoading: true, error: null });
    try {
      const raw = await invoke<Record<string, unknown>[]>('list_mcp_servers');
      const servers = raw.map(deserializeConfigFromBackend);
      set({ servers, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  addServer: async (config) => {
    try {
      const raw = await invoke<Record<string, unknown>>('add_mcp_server', { config: serializeConfigForBackend(config) });
      const server = deserializeConfigFromBackend(raw);
      set((state) => ({ servers: [...state.servers, server] }));
      return server;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  updateServer: async (config) => {
    try {
      await invoke('update_mcp_server', { config: serializeConfigForBackend(config) });
      set((state) => ({
        servers: state.servers.map((s) => (s.id === config.id ? config : s)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  removeServer: async (id) => {
    try {
      await invoke('remove_mcp_server', { id });
      set((state) => ({
        servers: state.servers.filter((s) => s.id !== id),
        tools: Object.fromEntries(Object.entries(state.tools).filter(([k]) => k !== id)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleServer: async (id, enabled) => {
    try {
      await invoke('toggle_mcp_server', { id, enabled });
      set((state) => ({
        servers: state.servers.map((s) => (s.id === id ? { ...s, enabled } : s)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  testConnection: async (config) => {
    try {
      const serialized = serializeConfigForBackend(config);
      const tools = await invoke<McpTool[]>('test_mcp_connection', { config: serialized });
      set((state) => ({
        testResult: { ...state.testResult, [config.id ?? 'new']: { success: true, tools } },
      }));
      return tools;
    } catch (e) {
      const errorMsg = String(e);
      set((state) => ({
        testResult: { ...state.testResult, [config.id ?? 'new']: { success: false, error: errorMsg } },
      }));
      return [];
    }
  },

  refreshTools: async (serverId) => {
    try {
      const tools = await invoke<McpTool[]>('get_mcp_tools', { serverId });
      set((state) => ({ tools: { ...state.tools, [serverId]: tools } }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
