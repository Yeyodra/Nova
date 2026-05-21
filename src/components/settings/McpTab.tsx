import React, { useEffect, useState } from 'react';
import { useMcpStore } from '@/stores/useMcpStore';
import { McpServer } from '@/types';
import {
  Plus,
  Trash,
  PencilSimple,
  Circle,
  ToggleLeft,
  ToggleRight,
  Plugs,
  FileArrowUp,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<McpServer['status'], string> = {
  connected: 'bg-[var(--success)]',
  disconnected: 'bg-[var(--text-subtle)]',
  connecting: 'bg-[var(--warning)]',
  error: 'bg-[var(--danger)]',
};

const STATUS_LABELS: Record<McpServer['status'], string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  error: 'Error',
};

interface McpTabProps {
  onAddServer?: () => void;
  onEditServer?: (server: McpServer) => void;
  onQuickImport?: () => void;
}

export const McpTab: React.FC<McpTabProps> = ({ onAddServer, onEditServer, onQuickImport }) => {
  const { servers, loadServers, toggleServer, removeServer } = useMcpStore();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleDelete = async (server: McpServer) => {
    if (deletingId === server.id) {
      await removeServer(server.id);
      setDeletingId(null);
    } else {
      setDeletingId(server.id);
    }
  };

  const handleToggle = async (server: McpServer) => {
    await toggleServer(server.id, !server.enabled);
  };

  // Empty state
  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
        <Plugs size={32} weight="duotone" className="opacity-50 mb-4" />
        <p className="text-sm font-semibold mb-1">No MCP servers configured</p>
        <p className="text-xs mb-4">Add a server to extend your tools</p>
        <button
          onClick={onAddServer}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--fill)] text-[var(--text)] hover:bg-[var(--fill-secondary)] transition-colors"
        >
          <Plus size={12} weight="bold" />
          Add Server
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--text)]">MCP Servers</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onQuickImport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)] transition-colors"
          >
            <FileArrowUp size={12} />
            Quick Import
          </button>
          <button
            onClick={onAddServer}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[var(--fill)] text-[var(--text)] hover:bg-[var(--fill-secondary)] transition-colors"
          >
            <Plus size={12} weight="bold" />
            Add Server
          </button>
        </div>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {servers.map((server) => (
          <div
            key={server.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
              server.enabled
                ? "border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--hover-bg-strong)]"
                : "border-[var(--border)] bg-[var(--surface)] opacity-60 hover:opacity-80"
            )}
          >
            {/* Status dot */}
            <div
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
                STATUS_COLORS[server.status]
              )}
              title={STATUS_LABELS[server.status]}
            />

            {/* Server info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text)] truncate">
                  {server.name}
                </span>
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--fill-tertiary)] text-[var(--text-muted)]">
                  {server.transportType}
                </span>
                {server.toolsCount > 0 && (
                  <span className="text-[10px] text-[var(--text-subtle)]">
                    ({server.toolsCount} {server.toolsCount === 1 ? 'tool' : 'tools'})
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Toggle */}
              <button
                onClick={() => handleToggle(server)}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                title={server.enabled ? 'Disable' : 'Enable'}
              >
                {server.enabled ? (
                  <ToggleRight size={18} weight="fill" className="text-[var(--success)]" />
                ) : (
                  <ToggleLeft size={18} weight="regular" />
                )}
              </button>

              {/* Edit */}
              <button
                onClick={() => onEditServer?.(server)}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover-bg)] transition-colors"
                title="Edit server"
              >
                <PencilSimple size={14} />
              </button>

              {/* Delete */}
              <button
                onClick={() => handleDelete(server)}
                onBlur={() => setDeletingId(null)}
                className={cn(
                  "p-1 rounded transition-colors",
                  deletingId === server.id
                    ? "text-[var(--danger)] bg-[var(--danger-bg)]"
                    : "text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--hover-bg)]"
                )}
                title={deletingId === server.id ? 'Click again to confirm' : 'Delete server'}
              >
                <Trash size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
