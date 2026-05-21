-- MCP (Model Context Protocol) servers configuration
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    transport_type TEXT NOT NULL,
    command TEXT,
    args TEXT,
    env_vars TEXT,
    url TEXT,
    headers TEXT,
    auth_type TEXT NOT NULL DEFAULT 'none',
    auth_token TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'disconnected',
    tools_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
