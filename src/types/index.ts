export interface Project {
  id: string;
  name: string;
  path?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type AttachmentStatus = 'pending' | 'processing' | 'ready' | 'error';

export interface AttachmentItem {
  id: string;
  messageId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  filePath: string;
  previewUrl?: string;
  base64?: string;
  extractedText?: string;
  status?: AttachmentStatus;
  error?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: AttachmentItem[];
  createdAt: string;
}

export interface Provider {
  id: string;
  name: string;
  providerType: string; // e.g., 'openai', 'anthropic', 'ollama'
  baseUrl: string;
  apiKey?: string;
  model: string;
  isDefault: boolean;
  isBuiltin: boolean;
  isEnabled: boolean;
  /** Wire format: 'openai' or 'anthropic'. Controls serialisation & prompt caching. */
  apiFormat: 'openai' | 'anthropic';
  createdAt: string;
  updatedAt: string;
}

export interface ProviderModelConfig {
  id: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
  maxTokens: number;
  temperature: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  agentType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: string;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  parentAgentRunId?: string | null;
  projectPath?: string | null;
}

export type AgentType =
  | 'chat'
  | 'orchestrator'
  | 'planner'
  | 'coder_fe'
  | 'coder_be'
  | 'security'
  | 'ux_researcher'
  | 'ui_designer'
  | 'tester'
  | 'reviewer'
  | 'researcher'
  | 'librarian';

export const SELECTABLE_AGENTS: AgentType[] = ['chat', 'orchestrator', 'planner'];

export const AGENT_LABELS: Record<AgentType, string> = {
  chat: 'Chat',
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  coder_fe: 'Coder FE',
  coder_be: 'Coder BE',
  security: 'Security',
  ux_researcher: 'UX Researcher',
  ui_designer: 'UI Designer',
  tester: 'Tester',
  reviewer: 'Reviewer',
  researcher: 'Researcher',
  librarian: 'Librarian',
};

export interface AgentConfig {
  id: string;
  agentType: AgentType;
  providerId: string | null;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  id: string;
  agentRunId: string;
  toolName: 'read_file' | 'write_file' | 'list_dir' | 'search_files' | 'run_command' | 'web_search';
  input: string;
  output: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AgentRunWithTools extends AgentRun {
  toolCalls: ToolCall[];
  streamingText: string;
  thinkingBlocks: string[];
  parentAgentRunId: string | null;
  projectPath: string | null;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatUsageEvent {
  sessionId: string;
  usage: TokenUsage;
}

export interface PermissionRequest {
  type: 'sensitive_file' | 'outside_sandbox' | 'shell_command';
  path: string;
  agentType: AgentType;
  agentRunId: string;
}

// MCP Types
export type McpTransportType = 'stdio' | 'http';
export type McpConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface McpServer {
  id: string;
  name: string;
  transportType: McpTransportType;
  command?: string;
  args?: string[];
  envVars?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  authType: 'none' | 'bearer';
  authToken?: string;
  enabled: boolean;
  status: McpConnectionStatus;
  toolsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };
