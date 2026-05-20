use std::path::Path;

use sqlx::SqlitePool;

use crate::error::AppResult;

/// Delete all attachment FILES for a given message (DB records are handled by CASCADE)
pub async fn delete_message_attachments(pool: &SqlitePool, message_id: &str) -> AppResult<()> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT file_path FROM attachments WHERE message_id = ?")
            .bind(message_id)
            .fetch_all(pool)
            .await?;

    for (file_path,) in rows {
        let path = std::path::PathBuf::from(&file_path);
        if path.exists() {
            let _ = tokio::fs::remove_file(&path).await;
            // Also try to remove parent dir if empty (the attachment_id dir)
            if let Some(parent) = path.parent() {
                let _ = tokio::fs::remove_dir(parent).await; // only succeeds if empty
            }
        }
    }

    Ok(())
}

/// Delete all attachment FILES for all messages in a session
pub async fn delete_session_attachments(pool: &SqlitePool, session_id: &str) -> AppResult<()> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT a.file_path FROM attachments a INNER JOIN messages m ON a.message_id = m.id WHERE m.session_id = ?",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    for (file_path,) in rows {
        let path = std::path::PathBuf::from(&file_path);
        if path.exists() {
            let _ = tokio::fs::remove_file(&path).await;
            if let Some(parent) = path.parent() {
                let _ = tokio::fs::remove_dir(parent).await;
            }
        }
    }

    Ok(())
}

/// Find files on disk in the attachments directory that have no corresponding DB record.
/// Deletes them and returns total bytes freed.
pub async fn cleanup_orphaned_files(pool: &SqlitePool, attachments_dir: &Path) -> AppResult<u64> {
    // First, delete pending attachments older than 1 hour (user abandoned them)
    cleanup_abandoned_pending(pool, attachments_dir).await?;

    if !attachments_dir.exists() {
        return Ok(0);
    }

    let mut bytes_freed: u64 = 0;

    // Walk the attachments directory — each subdirectory is an attachment_id
    let mut entries = tokio::fs::read_dir(attachments_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            let attachment_id = entry_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();

            // Check if this attachment_id exists in DB
            let exists: bool =
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachments WHERE id = ?")
                    .bind(&attachment_id)
                    .fetch_one(pool)
                    .await
                    .unwrap_or(0)
                    > 0;

            if !exists {
                // Orphaned — calculate size then delete
                if let Ok(size) = get_dir_size(&entry_path).await {
                    bytes_freed += size;
                }
                let _ = tokio::fs::remove_dir_all(&entry_path).await;
            }
        }
    }

    Ok(bytes_freed)
}

/// Get total storage usage of the attachments directory in bytes
pub async fn get_storage_usage(attachments_dir: &Path) -> AppResult<u64> {
    if !attachments_dir.exists() {
        return Ok(0);
    }
    get_dir_size(attachments_dir).await
}

/// Delete pending attachments (message_id IS NULL) older than 1 hour — user abandoned them.
async fn cleanup_abandoned_pending(pool: &SqlitePool, attachments_dir: &Path) -> AppResult<()> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, file_path FROM attachments WHERE message_id IS NULL AND created_at < datetime('now', '-1 hour')",
    )
    .fetch_all(pool)
    .await?;

    for (id, file_path) in &rows {
        // Delete file from disk
        let path = std::path::PathBuf::from(file_path);
        if path.exists() {
            let _ = tokio::fs::remove_file(&path).await;
            if let Some(parent) = path.parent() {
                // Remove the attachment_id subdirectory if empty
                if parent != attachments_dir {
                    let _ = tokio::fs::remove_dir(parent).await;
                }
            }
        }
        // Delete DB record
        sqlx::query("DELETE FROM attachments WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Recursively calculate directory size
async fn get_dir_size(path: &Path) -> AppResult<u64> {
    let mut total: u64 = 0;
    let mut entries = tokio::fs::read_dir(path).await?;
    while let Some(entry) = entries.next_entry().await? {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            total += Box::pin(get_dir_size(&entry_path)).await?;
        } else if let Ok(metadata) = tokio::fs::metadata(&entry_path).await {
            total += metadata.len();
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY NOT NULL, message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, file_name TEXT NOT NULL, file_size INTEGER NOT NULL, mime_type TEXT NOT NULL, file_path TEXT NOT NULL, extracted_text TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn test_delete_message_attachments() {
        let pool = setup_test_db().await;
        let tmp_dir = TempDir::new().unwrap();

        // Create a file on disk
        let file_path = tmp_dir.path().join("att-1").join("test.png");
        std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        std::fs::File::create(&file_path)
            .unwrap()
            .write_all(b"image data")
            .unwrap();

        // Insert message + attachment
        sqlx::query("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('msg-1', 'ses-1', 'user', 'hello', '2026-01-01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO attachments (id, message_id, file_name, file_size, mime_type, file_path, created_at) VALUES ('att-1', 'msg-1', 'test.png', 1024, 'image/png', ?, '2026-01-01')")
            .bind(file_path.to_string_lossy().to_string())
            .execute(&pool).await.unwrap();

        assert!(file_path.exists());
        delete_message_attachments(&pool, "msg-1").await.unwrap();
        assert!(!file_path.exists());
    }

    #[tokio::test]
    async fn test_delete_session_attachments() {
        let pool = setup_test_db().await;
        let tmp_dir = TempDir::new().unwrap();

        let file_path = tmp_dir.path().join("att-2").join("doc.pdf");
        std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        std::fs::File::create(&file_path)
            .unwrap()
            .write_all(b"pdf data")
            .unwrap();

        sqlx::query("INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('msg-2', 'ses-2', 'user', 'hi', '2026-01-01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO attachments (id, message_id, file_name, file_size, mime_type, file_path, created_at) VALUES ('att-2', 'msg-2', 'doc.pdf', 2048, 'application/pdf', ?, '2026-01-01')")
            .bind(file_path.to_string_lossy().to_string())
            .execute(&pool).await.unwrap();

        assert!(file_path.exists());
        delete_session_attachments(&pool, "ses-2").await.unwrap();
        assert!(!file_path.exists());
    }

    #[tokio::test]
    async fn test_cleanup_orphaned_files() {
        let pool = setup_test_db().await;
        let tmp_dir = TempDir::new().unwrap();
        let attachments_dir = tmp_dir.path();

        // Create orphaned directory (no DB record)
        let orphan_dir = attachments_dir.join("orphan-id");
        std::fs::create_dir_all(&orphan_dir).unwrap();
        std::fs::File::create(orphan_dir.join("file.png"))
            .unwrap()
            .write_all(b"orphan data")
            .unwrap();

        let bytes_freed = cleanup_orphaned_files(&pool, attachments_dir).await.unwrap();
        assert!(bytes_freed > 0);
        assert!(!orphan_dir.exists());
    }

    #[tokio::test]
    async fn test_get_storage_usage() {
        let tmp_dir = TempDir::new().unwrap();
        let attachments_dir = tmp_dir.path();

        // Create some files
        let sub_dir = attachments_dir.join("att-1");
        std::fs::create_dir_all(&sub_dir).unwrap();
        std::fs::File::create(sub_dir.join("file1.png"))
            .unwrap()
            .write_all(&[0u8; 1000])
            .unwrap();
        std::fs::File::create(sub_dir.join("file2.png"))
            .unwrap()
            .write_all(&[0u8; 500])
            .unwrap();

        let usage = get_storage_usage(attachments_dir).await.unwrap();
        assert_eq!(usage, 1500);
    }
}
