import React from 'react';
import { ChevronDown, Plus, Star } from 'lucide-react';
import type { ShellInfo } from '@/types/shell';

interface ShellPickerProps {
  shells: ShellInfo[];
  defaultShellId: string | null;
  onCreateDefault: () => void;
  onSelectShell: (shell: ShellInfo) => void;
  onSetDefault: (shell: ShellInfo) => void;
}

export const ShellPicker = React.memo(function ShellPicker({
  shells,
  defaultShellId,
  onCreateDefault,
  onSelectShell,
  onSetDefault,
}: ShellPickerProps) {
  const [open, setOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative flex items-center h-7 rounded-md text-[var(--text-muted)]" ref={dropdownRef}>
      {/* Left: spawn default shell */}
      <button
        className="flex h-7 w-7 items-center justify-center rounded-l-md hover:bg-[var(--hover-bg-strong)] hover:text-[var(--text)] transition-colors"
        onClick={onCreateDefault}
        title="New terminal (default shell)"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {/* Right: shell picker dropdown */}
      <button
        className="flex h-7 w-5 items-center justify-center rounded-r-md hover:bg-[var(--hover-bg-strong)] hover:text-[var(--text)] transition-colors border-l border-[var(--border)]/50"
        onClick={() => setOpen(!open)}
        title="Select shell"
      >
        <ChevronDown className="h-3 w-3" />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
          <div className="px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)]">Shells</div>
          <div className="h-px bg-[var(--border)] my-1" />
          {shells.map((shell) => (
            <button
              key={shell.id}
              className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--hover-bg-strong)] transition-colors"
              onClick={() => {
                onSelectShell(shell);
                setOpen(false);
              }}
            >
              <span className="flex-1 text-left">{shell.name}</span>
              {shell.id === defaultShellId ? (
                <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
              ) : (
                <span
                  className="opacity-0 group-hover:opacity-100 hover:text-yellow-500 transition-opacity cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetDefault(shell);
                  }}
                  title="Set as default"
                >
                  <Star className="h-3 w-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
