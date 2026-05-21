import React from 'react';

interface McpToolBadgeProps {
  serverName: string;
}

/**
 * Parse an MCP tool's full name (e.g. "servername__toolname") into its parts.
 * Returns null if the name doesn't follow MCP convention.
 */
export function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
  const sepIndex = fullName.indexOf('__');
  if (sepIndex === -1) return null;
  return {
    serverName: fullName.substring(0, sepIndex),
    toolName: fullName.substring(sepIndex + 2),
  };
}

export const McpToolBadge: React.FC<McpToolBadgeProps> = ({ serverName }) => {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--surface-2)] text-[var(--text-secondary)]">
      {serverName}
    </span>
  );
};
