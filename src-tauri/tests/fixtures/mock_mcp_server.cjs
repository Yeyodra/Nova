#!/usr/bin/env node
/**
 * Mock MCP Server for integration testing.
 * Communicates via JSON-RPC over stdin/stdout (newline-delimited).
 * 
 * Supports:
 * - initialize: returns server capabilities
 * - notifications/initialized: no-op (notification, no response)
 * - tools/list: returns 2 test tools (echo, add)
 * - tools/call: executes echo or add tool
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

const SERVER_INFO = {
  name: 'mock-mcp-server',
  version: '1.0.0',
};

const TOOLS = [
  {
    name: 'echo',
    description: 'Returns the input message as-is',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to echo back' },
      },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Adds two numbers together',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
      },
      required: ['a', 'b'],
    },
  },
];

function handleRequest(request) {
  const { id, method, params } = request;

  // Notifications have no id — don't respond
  if (method === 'notifications/initialized') {
    return null;
  }

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS,
        },
      };

    case 'tools/call': {
      const toolName = params && params.name;
      const args = params && params.arguments;

      if (toolName === 'echo') {
        const message = (args && args.message) || '';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: message }],
            isError: false,
          },
        };
      }

      if (toolName === 'add') {
        const a = (args && args.a) || 0;
        const b = (args && args.b) || 0;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: String(a + b) }],
            isError: false,
          },
        };
      }

      // Unknown tool
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Tool not found: ${toolName}`,
        },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (e) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    return;
  }

  const response = handleRequest(request);
  if (response !== null) {
    process.stdout.write(JSON.stringify(response) + '\n');
  }
});

rl.on('close', () => {
  process.exit(0);
});
