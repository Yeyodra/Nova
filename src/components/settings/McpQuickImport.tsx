import React, { useState, useEffect } from 'react';
import { X, FileArrowUp, SpinnerGap, Check } from '@phosphor-icons/react';
import { McpServer } from '@/types';
import { cn } from '@/lib/utils';

/** Shape of a single server entry in Claude Desktop's config format */
interface ClaudeDesktopServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

interface McpQuickImportProps {
  onImport: (servers: Partial<McpServer>[]) => void;
  onClose: () => void;
}

function parseImportJson(json: string): Partial<McpServer>[] {
  const parsed: unknown = JSON.parse(json);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Claude Desktop format: { "mcpServers": { "name": { ... } } }
  if (obj.mcpServers && typeof obj.mcpServers === 'object' && !Array.isArray(obj.mcpServers)) {
    const mcpServers = obj.mcpServers as Record<string, unknown>;
    return Object.entries(mcpServers).map(([name, rawConfig]) => {
      const config = rawConfig as ClaudeDesktopServerConfig;
      const hasCommand = typeof config.command === 'string' && config.command.length > 0;
      return {
        name,
        transportType: hasCommand ? 'stdio' as const : 'http' as const,
        command: config.command,
        args: Array.isArray(config.args) ? config.args : undefined,
        envVars: config.env && typeof config.env === 'object' ? config.env : undefined,
        url: typeof config.url === 'string' ? config.url : undefined,
        authType: 'none' as const,
        enabled: true,
      };
    });
  }

  // Single server object: { "command": "...", "args": [...] } or { "url": "..." }
  const single = obj as ClaudeDesktopServerConfig;
  const hasCommand = typeof single.command === 'string' && single.command.length > 0;
  const hasUrl = typeof single.url === 'string' && single.url.length > 0;

  if (hasCommand || hasUrl) {
    let serverName = 'server';
    if (hasCommand) {
      serverName = single.command!.split(/[\\/]/).pop() ?? 'server';
    } else if (hasUrl) {
      try { serverName = new URL(single.url!).hostname; } catch { /* keep default */ }
    }

    return [{
      name: serverName,
      transportType: hasCommand ? 'stdio' as const : 'http' as const,
      command: single.command,
      args: Array.isArray(single.args) ? single.args : undefined,
      envVars: single.env && typeof single.env === 'object' ? single.env : undefined,
      url: single.url,
      authType: 'none' as const,
      enabled: true,
    }];
  }

  throw new Error('Unrecognized format. Expected Claude Desktop config or a single server object.');
}

export const McpQuickImport: React.FC<McpQuickImportProps> = ({ onImport, onClose }) => {
  const [jsonInput, setJsonInput] = useState('');
  const [parsedServers, setParsedServers] = useState<Partial<McpServer>[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleParse = () => {
    setParsedServers(null);
    setParseError(null);

    if (!jsonInput.trim()) {
      setParseError('Please paste JSON configuration');
      return;
    }

    try {
      const servers = parseImportJson(jsonInput);
      if (servers.length === 0) {
        setParseError('No servers found in the configuration');
        return;
      }
      setParsedServers(servers);
    } catch (e) {
      setParseError(e instanceof SyntaxError ? 'Invalid JSON syntax' : String(e instanceof Error ? e.message : e));
    }
  };

  const handleImport = () => {
    if (!parsedServers) return;
    setImporting(true);
    onImport(parsedServers);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-xl w-full max-w-lg flex flex-col overflow-hidden shadow-2xl shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--text)]">Quick Import</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[60vh]">
          <p className="text-xs text-[var(--text-muted)]">
            Paste your Claude Desktop <code className="px-1 py-0.5 rounded bg-[var(--fill-tertiary)] text-[var(--text-subtle)] font-mono text-[10px]">claude_desktop_config.json</code> or a single server JSON object.
          </p>

          {/* JSON Input */}
          <textarea
            value={jsonInput}
            onChange={(e) => { setJsonInput(e.target.value); setParsedServers(null); setParseError(null); }}
            placeholder={'{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@example/mcp-server"],\n      "env": { "API_KEY": "..." }\n    }\n  }\n}'}
            rows={8}
            className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none font-mono"
          />

          {/* Parse button */}
          {!parsedServers && (
            <button
              onClick={handleParse}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--fill)] text-[var(--text)] hover:bg-[var(--fill-secondary)] transition-colors"
            >
              <FileArrowUp size={12} />
              Parse
            </button>
          )}

          {/* Parse Error */}
          {parseError && (
            <div className="px-3 py-2 rounded-lg text-xs border bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger)]">
              {parseError}
            </div>
          )}

          {/* Preview */}
          {parsedServers && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                Found {parsedServers.length} server{parsedServers.length === 1 ? '' : 's'}:
              </p>
              <div className="space-y-1">
                {parsedServers.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]"
                  >
                    <Check size={12} className="text-[var(--success)] shrink-0" />
                    <span className="text-xs font-medium text-[var(--text)] truncate">{s.name}</span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--fill-tertiary)] text-[var(--text-muted)]">
                      {s.transportType}
                    </span>
                    <span className="text-[10px] text-[var(--text-subtle)] truncate ml-auto">
                      {s.transportType === 'stdio' ? s.command : s.url}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)] transition-colors"
          >
            Cancel
          </button>
          {parsedServers && (
            <button
              onClick={handleImport}
              disabled={importing}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                "bg-[var(--fill)] text-[var(--text)] hover:bg-[var(--fill-secondary)] disabled:opacity-50"
              )}
            >
              {importing ? <SpinnerGap size={12} className="animate-spin" /> : <FileArrowUp size={12} />}
              Import All
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
