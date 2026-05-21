import React, { useState } from 'react';
import { ProjectSwitcher } from '@/components/sidebar/ProjectSwitcher';
import { SessionList } from '@/components/sidebar/SessionList';
import { SidebarSimple, GearSix, MagnifyingGlass, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';

export const LeftSidebar: React.FC = () => {
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setMainView = useUIStore((s) => s.setMainView);
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar);
  const [searchQuery, setSearchQuery] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(true);

  return (
    <aside className="h-full bg-[var(--surface)] flex flex-col w-[var(--sidebar-width-left)] shadow-[1px_0_2px_rgba(0,0,0,0.15)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 shrink-0">
        <span className="font-semibold text-[14px] text-[var(--text)]">enowX Coder</span>
        <button
          onClick={toggleLeftSidebar}
          className="w-8 h-8 rounded-[var(--radius)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--fill-tertiary)] transition-colors"
          title="Toggle sidebar"
        >
          <SidebarSimple size={18} weight="fill" />
        </button>
      </div>

      {/* Project Switcher */}
      <div className="px-3 pb-2">
        <ProjectSwitcher />
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 px-3 h-9 rounded-[var(--radius)] bg-[var(--fill-quaternary)] border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors">
          <MagnifyingGlass size={14} className="text-[var(--text-subtle)] shrink-0" />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-subtle)] outline-none"
          />
        </div>
      </div>

      {/* Section Label — collapsible */}
      <button
        type="button"
        onClick={() => setHistoryExpanded(!historyExpanded)}
        className="flex items-center gap-1.5 px-4 pt-1 pb-1.5 w-full text-left text-[11px] uppercase tracking-wider font-medium text-[var(--text-subtle)] hover:text-[var(--text-muted)] select-none transition-colors"
      >
        <CaretRight
          size={10}
          weight="bold"
          className={cn(
            'transition-transform duration-200',
            historyExpanded && 'rotate-90'
          )}
        />
        History
      </button>

      {/* Session List */}
      {historyExpanded ? (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <SessionList searchQuery={searchQuery} />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Compare — simple clickable label */}
      <button
        type="button"
        onClick={() => setMainView('compare')}
        className="flex items-center gap-1.5 px-4 pt-1 pb-1.5 w-full text-left text-[11px] uppercase tracking-wider font-medium text-[var(--text-subtle)] hover:text-[var(--text-muted)] select-none transition-colors"
      >
        Compare
      </button>

      {/* Footer — Settings */}
      <div className="px-3 py-3 shrink-0">
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-9 h-9 rounded-[var(--radius)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--fill-tertiary)] transition-colors"
          title="Settings"
        >
          <GearSix size={20} />
        </button>
      </div>
    </aside>
  );
};
