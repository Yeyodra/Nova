use serde::Serialize;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("JSON error: {0}")]
    Json(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("Tauri error: {0}")]
    Tauri(String),
    #[error("Internal error: {0}")]
    Internal(String),
    #[error("Cancelled")]
    Cancelled,
    #[error("File too large: {0}")]
    FileTooLarge(String),
    #[error("Too many files: {0}")]
    TooManyFiles(String),
    #[error("Unsupported file type: {0}")]
    UnsupportedFileType(String),
    #[error("Extraction failed: {0}")]
    ExtractionFailed(String),
    #[error("File not found: {0}")]
    FileNotFound(String),
}

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_string()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        Self::Database(value.to_string())
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(value: sqlx::migrate::MigrateError) -> Self {
        Self::Database(value.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        Self::Http(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(value: tauri::Error) -> Self {
        Self::Tauri(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_not_found_error() {
        let err = AppError::NotFound("resource".to_string());
        assert_eq!(err.to_string(), "Not found: resource");
    }

    #[test]
    fn test_validation_error() {
        let err = AppError::Validation("invalid input".to_string());
        assert_eq!(err.to_string(), "Validation error: invalid input");
    }

    #[test]
    fn test_cancelled_error() {
        let err = AppError::Cancelled;
        assert_eq!(err.to_string(), "Cancelled");
    }

    #[test]
    fn test_error_to_string() {
        let err: String = AppError::NotFound("test".to_string()).into();
        assert_eq!(err, "Not found: test");
    }

    #[test]
    fn test_file_too_large_error() {
        let err = AppError::FileTooLarge("10MB limit exceeded".to_string());
        assert_eq!(err.to_string(), "File too large: 10MB limit exceeded");
    }

    #[test]
    fn test_too_many_files_error() {
        let err = AppError::TooManyFiles("max 5 files".to_string());
        assert_eq!(err.to_string(), "Too many files: max 5 files");
    }

    #[test]
    fn test_unsupported_file_type_error() {
        let err = AppError::UnsupportedFileType("application/exe".to_string());
        assert_eq!(err.to_string(), "Unsupported file type: application/exe");
    }

    #[test]
    fn test_file_not_found_error() {
        let err = AppError::FileNotFound("/tmp/missing.txt".to_string());
        assert_eq!(err.to_string(), "File not found: /tmp/missing.txt");
    }
}
