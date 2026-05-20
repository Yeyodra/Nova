import { describe, it, expect } from 'vitest';
import type { AttachmentItem, AttachmentStatus } from './index';
import { FileAttachmentConfig } from '@/lib/constants';

describe('Attachment Types', () => {
  it('AttachmentItem has required fields', () => {
    const item: AttachmentItem = {
      id: 'test-id',
      fileName: 'test.png',
      fileSize: 1024,
      mimeType: 'image/png',
      filePath: '/path/to/file',
      status: 'ready',
    };
    expect(item.id).toBe('test-id');
    expect(item.status).toBe('ready');
  });

  it('AttachmentStatus has correct values', () => {
    const statuses: AttachmentStatus[] = ['pending', 'processing', 'ready', 'error'];
    expect(statuses).toHaveLength(4);
  });

  it('FileAttachmentConfig has correct limits', () => {
    expect(FileAttachmentConfig.MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    expect(FileAttachmentConfig.MAX_FILES).toBe(5);
    expect(FileAttachmentConfig.ALLOWED_IMAGE_TYPES).toContain('image/png');
    expect(FileAttachmentConfig.ALLOWED_DOC_TYPES).toContain('application/pdf');
  });
});
