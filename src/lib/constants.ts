export const FileAttachmentConfig = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_FILES: 5,
  ALLOWED_IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'],
  ALLOWED_DOC_TYPES: ['application/pdf', 'text/plain', 'text/markdown'],
} as const;
