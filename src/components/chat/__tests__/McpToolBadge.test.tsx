import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McpToolBadge, parseMcpToolName } from '../McpToolBadge';

describe('parseMcpToolName', () => {
  it('parses MCP tool name with double underscore', () => {
    const result = parseMcpToolName('filesystem__read_file');
    expect(result).toEqual({ serverName: 'filesystem', toolName: 'read_file' });
  });

  it('returns null for name without double underscore', () => {
    expect(parseMcpToolName('read_file')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseMcpToolName('')).toBeNull();
  });

  it('handles server name with underscores', () => {
    const result = parseMcpToolName('my_server__my_tool_name');
    expect(result).toEqual({ serverName: 'my_server', toolName: 'my_tool_name' });
  });

  it('splits on first double underscore only', () => {
    const result = parseMcpToolName('srv__tool__extra');
    expect(result).toEqual({ serverName: 'srv', toolName: 'tool__extra' });
  });

  it('handles double underscore at start', () => {
    const result = parseMcpToolName('__toolname');
    expect(result).toEqual({ serverName: '', toolName: 'toolname' });
  });
});

describe('McpToolBadge', () => {
  it('renders server name as text', () => {
    render(<McpToolBadge serverName="filesystem" />);
    expect(screen.getByText('filesystem')).toBeInTheDocument();
  });

  it('renders as inline span', () => {
    const { container } = render(<McpToolBadge serverName="git" />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe('git');
  });
});
