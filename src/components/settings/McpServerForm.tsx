import React, { useState, useEffect } from 'react';
import { X, FloppyDisk, Plugs, SpinnerGap } from '@phosphor-icons/react';
import { useMcpStore } from '@/stores/useMcpStore';
import { McpServer, McpTransportType } from '@/types';
import { cn } from '@/lib/utils';

interface McpServerFormProps {
  server?: McpServer;
  onClose: () => void;
  onSave: () => void;
}

export const McpServerForm: React.FC<McpServerFormProps> = ({ server, onClose, onSave }) => {
  const { addServer, updateServer, testConnection } = useMcpStore();

  const [name, setName] = useState(server?.name ?? '');
  const [transportType, setTransportType] = useState<McpTransportType>(server?.transportType ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? '');
  const [args, setArgs] = useState(server?.args?.join(' ') ?? '');
  const [envVars, setEnvVars] = useState(
    server?.envVars ? Object.entries(server.envVars).map(([k, v]) => `${k}=${v}`).join('\n') : ''
  );
  const [url, setUrl] = useState(server?.url ?? '');
  const [authType, setAuthType] = useState<'none' | 'bearer'>(server?.authType ?? 'none');
  const [authToken, setAuthToken] = useState(server?.authToken ?? '');
  const [headers, setHeaders] = useState(
    server?.headers ? Object.entries(server.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : ''
  );

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEdit = !!server;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const parseArgs = (raw: string): string[] => {
    if (!raw.trim()) return [];
    // Split by spaces, respecting quoted strings
    const matches = raw.match(/(?:[^\s"]+|"[^"]*")+/g);
    return matches ? matches.map((m) => m.replace(/^"|"$/g, '')) : [];
  };

  const parseEnvVars = (raw: string): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
    return result;
  };

  const parseHeaders = (raw: string): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        result[trimmed.slice(0, colonIdx).trim()] = trimmed.slice(colonIdx + 1).trim();
      }
    }
    return result;
  };

  const buildFormData = (): Partial<McpServer> => {
    const serverName = name.trim() || (transportType === 'stdio' ? command.split(/[\\/]/).pop() ?? 'server' : (() => { try { return new URL(url).hostname; } catch { return 'server'; } })());

    const data: Partial<McpServer> = {
      ...(server?.id ? { id: server.id } : {}),
      name: serverName,
      transportType,
      authType,
      enabled: server?.enabled ?? true,
    };

    if (transportType === 'stdio') {
      data.command = command.trim();
      data.args = parseArgs(args);
      const env = parseEnvVars(envVars);
      if (Object.keys(env).length > 0) data.envVars = env;
    } else {
      data.url = url.trim();
      if (authType === 'bearer') data.authToken = authToken.trim();
      const hdrs = parseHeaders(headers);
      if (Object.keys(hdrs).length > 0) data.headers = hdrs;
    }

    return data;
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (transportType === 'stdio' && !command.trim()) {
      errs.command = 'Command is required';
    }
    if (transportType === 'http' && !url.trim()) {
      errs.url = 'URL is required';
    }
    if (transportType === 'http' && url.trim()) {
      try {
        new URL(url.trim());
      } catch {
        errs.url = 'Invalid URL format';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleTest = async () => {
    if (!validate()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const tools = await testConnection(buildFormData());
      setTestResult({ success: true, message: `Connected! Found ${tools.length} tool${tools.length === 1 ? '' : 's'}` });
    } catch (e) {
      setTestResult({ success: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const data = buildFormData();
      if (isEdit && server) {
        await updateServer({ ...server, ...data } as McpServer);
      } else {
        await addServer(data);
      }
      onSave();
    } catch (e) {
      setErrors({ form: String(e) });
    } finally {
      setSaving(false);
    }
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
          <h3 className="text-sm font-bold text-[var(--text)]">
            {isEdit ? 'Edit Server' : 'Add MCP Server'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[60vh]">
          {/* Server Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-muted)]">Server Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated from command/url if empty"
              className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Transport Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-muted)]">Transport</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTransportType('stdio')}
                className={cn(
                  "flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors",
                  transportType === 'stdio'
                    ? "bg-[var(--fill)] border-[var(--accent)] text-[var(--text)]"
                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]"
                )}
              >
                stdio
              </button>
              <button
                type="button"
                onClick={() => setTransportType('http')}
                className={cn(
                  "flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors",
                  transportType === 'http'
                    ? "bg-[var(--fill)] border-[var(--accent)] text-[var(--text)]"
                    : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]"
                )}
              >
                http
              </button>
            </div>
          </div>

          {/* Stdio Fields */}
          {transportType === 'stdio' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-muted)]">
                  Command <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => { setCommand(e.target.value); setErrors((p) => ({ ...p, command: '' })); }}
                  placeholder="e.g. npx, uvx, node"
                  className={cn(
                    "w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors",
                    errors.command ? "border-[var(--danger)]" : "border-[var(--border)]"
                  )}
                />
                {errors.command && <p className="text-[10px] text-[var(--danger)]">{errors.command}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-muted)]">Arguments</label>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder='e.g. -y @modelcontextprotocol/server-filesystem "/path"'
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
                <p className="text-[10px] text-[var(--text-subtle)]">Space-separated. Use quotes for args with spaces.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-muted)]">Environment Variables</label>
                <textarea
                  value={envVars}
                  onChange={(e) => setEnvVars(e.target.value)}
                  placeholder={"API_KEY=sk-xxx\nNODE_ENV=production"}
                  rows={3}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none font-mono"
                />
                <p className="text-[10px] text-[var(--text-subtle)]">One per line: KEY=VALUE</p>
              </div>
            </>
          )}

          {/* HTTP Fields */}
          {transportType === 'http' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-muted)]">
                  URL <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setErrors((p) => ({ ...p, url: '' })); }}
                  placeholder="https://mcp-server.example.com/sse"
                  className={cn(
                    "w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors",
                    errors.url ? "border-[var(--danger)]" : "border-[var(--border)]"
                  )}
                />
                {errors.url && <p className="text-[10px] text-[var(--danger)]">{errors.url}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-muted)]">Authentication</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthType('none')}
                    className={cn(
                      "flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors",
                      authType === 'none'
                        ? "bg-[var(--fill)] border-[var(--accent)] text-[var(--text)]"
                        : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                    )}
                  >
                    None
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthType('bearer')}
                    className={cn(
                      "flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-colors",
                      authType === 'bearer'
                        ? "bg-[var(--fill)] border-[var(--accent)] text-[var(--text)]"
                        : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                    )}
                  >
                    Bearer Token
                  </button>
                </div>
              </div>

              {authType === 'bearer' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--text-muted)]">Token</label>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Bearer token"
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-muted)]">Custom Headers</label>
                <textarea
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  placeholder={"X-Custom-Header: value\nAnother-Header: value"}
                  rows={3}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none font-mono"
                />
                <p className="text-[10px] text-[var(--text-subtle)]">One per line: Header-Name: value</p>
              </div>
            </>
          )}

          {/* Test Result */}
          {testResult && (
            <div
              className={cn(
                "px-3 py-2 rounded-lg text-xs border",
                testResult.success
                  ? "bg-[var(--success-bg)] border-[var(--success-border)] text-[var(--success)]"
                  : "bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger)]"
              )}
            >
              {testResult.message}
            </div>
          )}

          {/* Form-level error */}
          {errors.form && (
            <div className="px-3 py-2 rounded-lg text-xs border bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger)]">
              {errors.form}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)] transition-colors disabled:opacity-50"
          >
            {testing ? <SpinnerGap size={12} className="animate-spin" /> : <Plugs size={12} />}
            Test Connection
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--fill)] text-[var(--text)] hover:bg-[var(--fill-secondary)] transition-colors disabled:opacity-50"
            >
              {saving ? <SpinnerGap size={12} className="animate-spin" /> : <FloppyDisk size={12} />}
              {isEdit ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
