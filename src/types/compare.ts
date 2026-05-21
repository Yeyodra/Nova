export interface CompareSession {
  id: string;
  title: string;
  modelIds: string[]; // parsed from JSON
  createdAt: string;
  updatedAt: string;
}

export interface CompareMessage {
  id: string;
  compareSessionId: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  providerId?: string;
  createdAt: string;
}

export interface CompareColumn {
  modelId: string;
  providerId: string;
  modelName: string;
  providerName: string;
  isStreaming: boolean;
  streamingText: string;
  messages: CompareMessage[];
  error?: string;
}
