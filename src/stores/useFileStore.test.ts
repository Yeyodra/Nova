import { describe, it, expect, beforeEach } from 'vitest';
import { useFileStore } from './useFileStore';
import type { AttachmentItem } from '@/types';

const makeFile = (id: string, status: 'pending' | 'processing' | 'ready' | 'error' = 'ready'): AttachmentItem => ({
  id,
  fileName: `${id}.png`,
  fileSize: 1024,
  mimeType: 'image/png',
  filePath: `/path/${id}.png`,
  status,
});

describe('useFileStore', () => {
  beforeEach(() => {
    useFileStore.setState({ pendingFiles: [] });
  });

  it('initial state is empty', () => {
    const { pendingFiles } = useFileStore.getState();
    expect(pendingFiles).toEqual([]);
  });

  it('addFile adds to pendingFiles', () => {
    const file = makeFile('f1');
    const result = useFileStore.getState().addFile(file);
    expect(result).toBe(true);
    expect(useFileStore.getState().pendingFiles).toHaveLength(1);
    expect(useFileStore.getState().pendingFiles[0].id).toBe('f1');
  });

  it('removeFile removes by id', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1'), makeFile('f2')] });
    useFileStore.getState().removeFile('f1');
    expect(useFileStore.getState().pendingFiles).toHaveLength(1);
    expect(useFileStore.getState().pendingFiles[0].id).toBe('f2');
  });

  it('clearFiles empties pendingFiles', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1'), makeFile('f2')] });
    useFileStore.getState().clearFiles();
    expect(useFileStore.getState().pendingFiles).toEqual([]);
  });

  it('updateFileStatus updates status field', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1', 'pending')] });
    useFileStore.getState().updateFileStatus('f1', 'error', 'File too large');
    const file = useFileStore.getState().pendingFiles[0];
    expect(file.status).toBe('error');
    expect(file.error).toBe('File too large');
  });

  it('addFile rejects when at MAX_FILES (5)', () => {
    useFileStore.setState({
      pendingFiles: [makeFile('f1'), makeFile('f2'), makeFile('f3'), makeFile('f4'), makeFile('f5')],
    });
    const result = useFileStore.getState().addFile(makeFile('f6'));
    expect(result).toBe(false);
    expect(useFileStore.getState().pendingFiles).toHaveLength(5);
  });

  it('isProcessing returns true when any file is processing', () => {
    useFileStore.setState({ pendingFiles: [makeFile('f1', 'ready'), makeFile('f2', 'processing')] });
    expect(useFileStore.getState().isProcessing()).toBe(true);
  });
});
