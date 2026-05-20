import { create } from 'zustand';
import type { AttachmentItem, AttachmentStatus } from '@/types';
import { FileAttachmentConfig } from '@/lib/constants';

interface FileStoreState {
  pendingFiles: AttachmentItem[];
  addFile: (file: AttachmentItem) => boolean;
  addFiles: (files: AttachmentItem[]) => boolean;
  removeFile: (id: string) => void;
  updateFileStatus: (id: string, status: AttachmentStatus, error?: string) => void;
  clearFiles: () => void;
  isProcessing: () => boolean;
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  pendingFiles: [],

  addFile: (file) => {
    const { pendingFiles } = get();
    if (pendingFiles.length >= FileAttachmentConfig.MAX_FILES) {
      return false;
    }
    set({ pendingFiles: [...pendingFiles, file] });
    return true;
  },

  addFiles: (files) => {
    const { pendingFiles } = get();
    if (pendingFiles.length + files.length > FileAttachmentConfig.MAX_FILES) {
      return false;
    }
    set({ pendingFiles: [...pendingFiles, ...files] });
    return true;
  },

  removeFile: (id) => {
    set((state) => ({
      pendingFiles: state.pendingFiles.filter((f) => f.id !== id),
    }));
  },

  updateFileStatus: (id, status, error) => {
    set((state) => ({
      pendingFiles: state.pendingFiles.map((f) =>
        f.id === id ? { ...f, status, error } : f
      ),
    }));
  },

  clearFiles: () => {
    set({ pendingFiles: [] });
  },

  isProcessing: () => {
    return get().pendingFiles.some((f) => f.status === 'processing');
  },
}));
