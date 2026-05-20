use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{
    error::{AppError, AppResult},
    models::Attachment,
    services::{extraction_service, file_service},
    state::AppState,
};

/// Result of attaching files — supports partial failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachResult {
    pub attachments: Vec<Attachment>,
    pub errors: Vec<FileError>,
}

/// Per-file error when attachment fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileError {
    pub file_path: String,
    pub error: String,
}

/// Attach files: validate, copy to app_data, detect MIME, extract text from docs.
/// Returns AttachResult with successfully processed files and per-file errors.
#[tauri::command]
pub async fn attach_files(
    app: AppHandle,
    state: State<'_, AppState>,
    file_paths: Vec<String>,
) -> AppResult<AttachResult> {
    // Hard reject: too many files
    file_service::validate_file_count(file_paths.len(), 5)?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let attachments_dir = data_dir.join("attachments");

    let mut attachments = Vec::new();
    let mut errors = Vec::new();

    for file_path_str in &file_paths {
        match process_single_file(file_path_str, &attachments_dir, &state).await {
            Ok(attachment) => attachments.push(attachment),
            Err(e) => errors.push(FileError {
                file_path: file_path_str.clone(),
                error: e.to_string(),
            }),
        }
    }

    Ok(AttachResult {
        attachments,
        errors,
    })
}

/// Process a single file: validate, copy, detect MIME, extract text, persist to DB.
async fn process_single_file(
    file_path_str: &str,
    attachments_dir: &Path,
    state: &State<'_, AppState>,
) -> AppResult<Attachment> {
    let source = PathBuf::from(file_path_str);

    // Validate file exists and size
    file_service::validate_file(&source, 10 * 1024 * 1024)?;

    // Detect and validate MIME type
    let mime_type = file_service::detect_mime_type(&source);
    file_service::validate_mime_type(&mime_type)?;

    let attachment_id = uuid::Uuid::new_v4().to_string();

    let dest =
        file_service::copy_to_attachments(attachments_dir, &source, &attachment_id).await?;

    let extracted_text = if mime_type.starts_with("image/") {
        None
    } else {
        extraction_service::extract_text(&dest).ok()
    };

    let metadata = std::fs::metadata(&source)?;
    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let attachment = Attachment {
        id: attachment_id,
        message_id: None, // Linked when message is sent
        file_name,
        file_size: metadata.len() as i64,
        mime_type,
        file_path: dest.to_string_lossy().to_string(),
        extracted_text,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    sqlx::query(
        "INSERT INTO attachments (id, message_id, file_name, file_size, mime_type, file_path, extracted_text, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&attachment.id)
    .bind(&attachment.file_name)
    .bind(attachment.file_size)
    .bind(&attachment.mime_type)
    .bind(&attachment.file_path)
    .bind(&attachment.extracted_text)
    .bind(&attachment.created_at)
    .execute(state.pool())
    .await?;

    Ok(attachment)
}

/// Remove a single attachment: delete file from disk + DB record
#[tauri::command]
pub async fn remove_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> AppResult<()> {
    let attachment: Attachment = sqlx::query_as(
        "SELECT id, message_id, file_name, file_size, mime_type, file_path, extracted_text, created_at FROM attachments WHERE id = ?",
    )
    .bind(&attachment_id)
    .fetch_optional(state.pool())
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Attachment {attachment_id} not found")))?;

    let path = PathBuf::from(&attachment.file_path);
    if path.exists() {
        file_service::delete_attachment(&path).await?;
    }

    sqlx::query("DELETE FROM attachments WHERE id = ?")
        .bind(&attachment_id)
        .execute(state.pool())
        .await?;

    Ok(())
}

/// Get all attachments for a message
#[tauri::command]
pub async fn get_attachments_for_message(
    state: State<'_, AppState>,
    message_id: String,
) -> AppResult<Vec<Attachment>> {
    let attachments = sqlx::query_as::<_, Attachment>(
        "SELECT id, message_id, file_name, file_size, mime_type, file_path, extracted_text, created_at FROM attachments WHERE message_id = ? ORDER BY created_at",
    )
    .bind(&message_id)
    .fetch_all(state.pool())
    .await?;

    Ok(attachments)
}

/// Get base64 data URI for an attachment (compresses images first)
#[tauri::command]
pub async fn get_attachment_base64(
    state: State<'_, AppState>,
    attachment_id: String,
) -> AppResult<String> {
    let attachment: Attachment = sqlx::query_as(
        "SELECT id, message_id, file_name, file_size, mime_type, file_path, extracted_text, created_at FROM attachments WHERE id = ?",
    )
    .bind(&attachment_id)
    .fetch_optional(state.pool())
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Attachment {attachment_id} not found")))?;

    let path = PathBuf::from(&attachment.file_path);

    let (data, mime) = if attachment.mime_type.starts_with("image/") {
        match file_service::compress_image(&path, 1920, 85) {
            Ok(compressed) => (compressed, "image/jpeg".to_string()),
            Err(_) => (std::fs::read(&path)?, attachment.mime_type.clone()),
        }
    } else {
        (std::fs::read(&path)?, attachment.mime_type.clone())
    };

    Ok(file_service::encode_to_base64(&data, &mime))
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_file_commands_compile() {
        // Verifies the module compiles correctly.
        // Full integration tests require a Tauri app context with DB.
        assert!(true);
    }
}
