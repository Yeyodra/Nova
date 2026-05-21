import React from 'react';
import { X } from '@phosphor-icons/react';
import { useCompareStore } from '@/stores/useCompareStore';
import { useUIStore } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils';

export const CompareHistory: React.FC = () => {
  const {
    compareSessions,
    activeCompareSessionId,
    setActiveCompareSession,
    removeCompareSession,
  } = useCompareStore();

  if (compareSessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-[12px] text-[var(--text-subtle)]">No compare sessions yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1">
      {compareSessions.map((session) => {
        const isActive = session.id === activeCompareSessionId;

        return (
          <div
            key={session.id}
            className={cn(
              'group flex items-center gap-2 px-3 py-2 rounded-[var(--radius)] cursor-pointer hover:bg-[var(--fill-tertiary)] transition-colors',
              isActive && 'bg-[var(--fill-tertiary)]'
            )}
            onClick={() => {
              setActiveCompareSession(session.id);
              useUIStore.getState().setMainView('compare');
            }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-[var(--text)] truncate">
                {session.title}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-[var(--text-subtle)]">
                  {formatDate(session.createdAt)}
                </span>
                <span className="text-[11px] text-[var(--text-subtle)] bg-[var(--fill-secondary)] px-1.5 py-0.5 rounded-[var(--radius-sm)]">
                  {Array.isArray(session.modelIds) ? session.modelIds.length : 0} {(Array.isArray(session.modelIds) ? session.modelIds.length : 0) === 1 ? 'model' : 'models'}
                </span>
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                removeCompareSession(session.id);
              }}
              className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-[var(--radius-sm)] flex items-center justify-center text-[var(--text-subtle)] hover:text-red-400 hover:bg-[var(--fill-secondary)] transition-all shrink-0"
              title="Delete session"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
