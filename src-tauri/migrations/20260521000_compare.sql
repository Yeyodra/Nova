CREATE TABLE IF NOT EXISTS compare_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Compare',
    model_ids TEXT NOT NULL, -- JSON array of model IDs used
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compare_messages (
    id TEXT PRIMARY KEY NOT NULL,
    compare_session_id TEXT NOT NULL REFERENCES compare_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' or 'assistant'
    content TEXT NOT NULL,
    model_id TEXT, -- NULL for user messages, set for assistant responses
    provider_id TEXT, -- which provider was used
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_compare_messages_session ON compare_messages(compare_session_id);
