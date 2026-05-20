import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '@/stores/useSessionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useChatStore } from '@/stores/useChatStore';
import { useAgentStore } from '@/stores/useAgentStore';
import { FolderSimple, ChatCircleText, Trash, CaretRight, Plus } from '@phosphor-icons/react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/utils';
import { generateId } from '@/lib/utils';
import { Session } from '@/types';

interface SessionListProps {
  searchQuery?: string;
}

export const SessionList: React.FC<SessionListProps> = ({ searchQuery = '' }) => {
  const { sessions, activeSessionId, setActiveSessionId, removeSession, addSession, setSessions } = useSessionStore();
  const { projects, activeProjectId, removeProject, setActiveProjectId } = useProjectStore();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    return new Set(activeProjectId ? [activeProjectId] : []);
  });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setExpandedProjects((prev) => new Set(prev).add(activeProjectId));
  }, [activeProjectId]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const handleNewSession = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    const now = new Date().toISOString();
    const session = { id: generateId(), projectId, title: 'New Chat', createdAt: now, updatedAt: now };
    addSession(session);
    setActiveSessionId(session.id);
    setExpandedProjects((prev) => new Set(prev).add(projectId));

    try {
      const createdSession = await invoke<Session>('create_session', { projectId, title: 'New Chat' });
      const currentSessions = useSessionStore.getState().sessions;
      setSessions(currentSessions.map((existing) => (existing.id === session.id ? createdSession : existing)));
      setActiveSessionId(createdSession.id);
    } catch (error) {
      console.error('Failed to persist session creation:', error);
    }
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeleteTarget(sessionId);
  };

  const confirmDeleteSession = async () => {
    if (!deleteTarget) return;
    const sessionId = deleteTarget;
    setDeleteTarget(null);

    const wasActive = activeSessionId === sessionId;
    removeSession(sessionId);
    if (wasActive) {
      useChatStore.getState().setMessages([]);
      useAgentStore.getState().setAgentRuns([]);
    }

    try {
      await invoke('delete_session', { id: sessionId });
    } catch (error) {
      console.error('Failed to persist session deletion:', error);
    }
  };

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setDeleteProjectTarget(projectId);
  };

  const confirmDeleteProject = async () => {
    if (!deleteProjectTarget) return;
    const projectId = deleteProjectTarget;
    setDeleteProjectTarget(null);

    // Remove all sessions belonging to this project
    const projectSessions = sessions.filter((s) => s.projectId === projectId);
    for (const session of projectSessions) {
      removeSession(session.id);
    }

    // If active project is being deleted, clear state
    if (activeProjectId === projectId) {
      setActiveProjectId(null as unknown as string);
      useChatStore.getState().setMessages([]);
      useAgentStore.getState().setAgentRuns([]);
    }

    removeProject(projectId);

    try {
      await invoke('delete_project', { id: projectId });
    } catch (error) {
      console.error('Failed to persist project deletion:', error);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <FolderSimple size={28} weight="duotone" className="text-[var(--text-subtle)] mb-2" />
        <p className="text-[12px] text-[var(--text-subtle)]">Open a folder to start</p>
      </div>
    );
  }

  const query = searchQuery.toLowerCase().trim();

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1">
      {projects.map((project) => {
        const projectSessions = sessions
          .filter((s) => s.projectId === project.id)
          .filter((s) => !query || s.title.toLowerCase().includes(query));
        const isExpanded = expandedProjects.has(project.id);

        // Hide project if search active and no matching sessions
        if (query && projectSessions.length === 0) return null;

        return (
          <div key={project.id} className="mb-1">
            <div
              className="group flex items-center gap-2 px-3 h-9 rounded-[var(--radius)] cursor-pointer hover:bg-[var(--fill-tertiary)] transition-colors"
              onClick={() => toggleProject(project.id)}
              title={project.name}
            >
              <CaretRight
                size={12}
                weight="bold"
                className={cn(
                  'text-[var(--text-subtle)] transition-transform shrink-0',
                  isExpanded && 'rotate-90'
                )}
              />
              <FolderSimple
                size={16}
                weight={isExpanded ? 'fill' : 'regular'}
                className="text-[var(--text-muted)] shrink-0"
              />
              <span className="text-[13px] font-medium text-[var(--text-muted)] truncate flex-1 group-hover:text-[var(--text)]">
                {project.name.split(/[/\\]/).filter(Boolean).pop() ?? project.name}
              </span>
              <button
                onClick={(e) => handleNewSession(e, project.id)}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-[var(--radius-sm)] flex items-center justify-center hover:bg-[var(--fill-secondary)] text-[var(--text-subtle)] hover:text-[var(--text)] transition-all"
                title="New chat"
              >
                <Plus size={13} />
              </button>
              <button
                onClick={(e) => handleDeleteProject(e, project.id)}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-[var(--radius-sm)] flex items-center justify-center hover:bg-[var(--fill-secondary)] text-[var(--text-subtle)] hover:text-[var(--danger)] transition-all"
                title="Delete project"
              >
                <Trash size={13} />
              </button>
            </div>

            {isExpanded && (
              <div className="ml-3 pl-3 border-l border-[var(--fill-secondary)] mt-0.5 mb-1">
                {projectSessions.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-subtle)] px-3 py-2">No chats yet</p>
                ) : (
                  projectSessions.map((session) => (
                    <div
                      key={session.id}
                      className={cn(
                        'group flex items-center gap-2.5 px-3 h-10 rounded-[var(--radius)] cursor-pointer transition-colors text-[13px]',
                        activeSessionId === session.id
                          ? 'bg-[var(--fill-secondary)] text-[var(--text)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--fill-tertiary)] hover:text-[var(--text)]'
                      )}
                      onClick={() => setActiveSessionId(session.id)}
                    >
                      <ChatCircleText
                        size={16}
                        weight={activeSessionId === session.id ? 'fill' : 'regular'}
                        className="shrink-0"
                      />
                      <span className="truncate flex-1">{session.title}</span>
                      <button
                        onClick={(e) => {
                          void handleDeleteSession(e, session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-[var(--radius-sm)] flex items-center justify-center hover:bg-[var(--fill-secondary)] transition-all text-[var(--text-subtle)] hover:text-[var(--danger)]"
                        title="Delete chat"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Chat"
        message={`Are you sure you want to delete "${sessions.find(s => s.id === deleteTarget)?.title ?? 'this chat'}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => void confirmDeleteSession()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={deleteProjectTarget !== null}
        title="Delete Project"
        message={`Are you sure you want to delete "${(projects.find(p => p.id === deleteProjectTarget)?.name ?? '').split(/[/\\]/).filter(Boolean).pop() ?? 'this project'}" and all its chats? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => void confirmDeleteProject()}
        onCancel={() => setDeleteProjectTarget(null)}
      />
    </div>
  );
};
