-- Make message_id nullable to support pending attachments (not yet linked to a message)
-- SQLite doesn't support ALTER COLUMN, so we recreate the table
CREATE TABLE attachments_new (
    id TEXT PRIMARY KEY NOT NULL,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    extracted_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO attachments_new SELECT * FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
