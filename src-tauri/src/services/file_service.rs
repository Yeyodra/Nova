use std::path::{Path, PathBuf};

use base64::Engine;

use crate::error::{AppError, AppResult};

/// Copy a file to the attachments directory: {attachments_dir}/{attachment_id}/{filename}
pub async fn copy_to_attachments(
    attachments_dir: &Path,
    source: &Path,
    attachment_id: &str,
) -> AppResult<PathBuf> {
    let dest_dir = attachments_dir.join(attachment_id);
    tokio::fs::create_dir_all(&dest_dir).await?;

    let filename = source
        .file_name()
        .ok_or_else(|| AppError::Validation("Source path has no filename".to_string()))?;

    let dest_path = dest_dir.join(filename);
    tokio::fs::copy(source, &dest_path).await?;

    Ok(dest_path)
}

/// Compress an image to max dimension and JPEG quality. Returns compressed bytes.
pub fn compress_image(path: &Path, max_dimension: u32, quality: u8) -> AppResult<Vec<u8>> {
    let img = image::open(path).map_err(|e| AppError::Io(e.to_string()))?;

    let resized = if img.width() > max_dimension || img.height() > max_dimension {
        img.resize(
            max_dimension,
            max_dimension,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };

    let mut buf = std::io::Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    resized
        .write_with_encoder(encoder)
        .map_err(|e| AppError::Io(e.to_string()))?;

    Ok(buf.into_inner())
}

/// Encode bytes to base64 data URI: "data:{mime};base64,{data}"
pub fn encode_to_base64(data: &[u8], mime_type: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    format!("data:{mime_type};base64,{encoded}")
}

/// Delete an attachment file from disk
pub async fn delete_attachment(path: &Path) -> AppResult<()> {
    tokio::fs::remove_file(path)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

/// Validate file size (must be ≤ max_size bytes)
pub fn validate_file(path: &Path, max_size: u64) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::FileNotFound(
            path.to_string_lossy().to_string(),
        ));
    }
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > max_size {
        return Err(AppError::FileTooLarge(format!(
            "File '{}' is {} bytes, maximum allowed is {} bytes",
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown"),
            metadata.len(),
            max_size
        )));
    }
    Ok(())
}

/// Validate file count (must be ≤ max_files)
pub fn validate_file_count(count: usize, max_files: usize) -> AppResult<()> {
    if count > max_files {
        return Err(AppError::TooManyFiles(format!(
            "Cannot attach {count} files, maximum is {max_files}"
        )));
    }
    Ok(())
}

/// Validate MIME type against allowlist
pub fn validate_mime_type(mime_type: &str) -> AppResult<()> {
    const ALLOWED_TYPES: &[&str] = &[
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "application/pdf",
        "text/plain",
        "text/markdown",
    ];
    if !ALLOWED_TYPES.contains(&mime_type) {
        return Err(AppError::UnsupportedFileType(format!(
            "File type '{}' is not supported. Allowed: images (png, jpg, gif, webp, bmp) and documents (pdf, txt, md)",
            mime_type
        )));
    }
    Ok(())
}

/// Detect MIME type from file extension
pub fn detect_mime_type(path: &Path) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::{NamedTempFile, TempDir};

    #[test]
    fn test_validate_file_size_ok() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"small content").unwrap();
        file.flush().unwrap();

        let result = validate_file(file.path(), 10 * 1024 * 1024); // 10MB limit
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_file_size_too_large() {
        let mut file = NamedTempFile::new().unwrap();
        // Write 11MB of data
        let data = vec![0u8; 11 * 1024 * 1024];
        file.write_all(&data).unwrap();
        file.flush().unwrap();

        let result = validate_file(file.path(), 10 * 1024 * 1024); // 10MB limit
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("File too large"));
    }

    #[test]
    fn test_validate_file_count_ok() {
        let result = validate_file_count(3, 5);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_file_count_exceeded() {
        let result = validate_file_count(6, 5);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Too many files"));
    }

    #[test]
    fn test_encode_to_base64() {
        let data = b"hello";
        let result = encode_to_base64(data, "text/plain");
        assert!(result.starts_with("data:text/plain;base64,"));
        // "hello" in base64 is "aGVsbG8="
        assert!(result.ends_with("aGVsbG8="));
    }

    #[test]
    fn test_detect_mime_type() {
        assert_eq!(detect_mime_type(Path::new("test.png")), "image/png");
        assert_eq!(detect_mime_type(Path::new("test.pdf")), "application/pdf");
        assert_eq!(detect_mime_type(Path::new("test.jpg")), "image/jpeg");
        assert_eq!(
            detect_mime_type(Path::new("test.unknown_ext")),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_compress_image() {
        // Create a 4000x3000 RGB image
        let img = image::DynamicImage::new_rgb8(4000, 3000);
        let tmp_dir = TempDir::new().unwrap();
        let tmp_path = tmp_dir.path().join("test_image.png");
        img.save(&tmp_path).unwrap();

        let compressed = compress_image(&tmp_path, 1920, 85).unwrap();
        assert!(!compressed.is_empty());

        // Verify output dimensions are ≤ 1920px
        let output = image::load_from_memory(&compressed).unwrap();
        assert!(output.width() <= 1920);
        assert!(output.height() <= 1920);
    }

    #[tokio::test]
    async fn test_copy_to_attachments() {
        let tmp_dir = TempDir::new().unwrap();
        let attachments_dir = tmp_dir.path().join("attachments");

        // Create a source file
        let mut source = NamedTempFile::new().unwrap();
        source.write_all(b"file content").unwrap();
        source.flush().unwrap();

        let result =
            copy_to_attachments(&attachments_dir, source.path(), "att-123").await;
        assert!(result.is_ok());

        let dest = result.unwrap();
        assert!(dest.exists());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "file content");
        assert!(dest.to_string_lossy().contains("att-123"));
    }

    #[tokio::test]
    async fn test_delete_attachment() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"to be deleted").unwrap();
        file.flush().unwrap();

        // Keep the file on disk by persisting it
        let (_, persisted_path) = file.keep().unwrap();

        assert!(persisted_path.exists());
        let result = delete_attachment(&persisted_path).await;
        assert!(result.is_ok());
        assert!(!persisted_path.exists());
    }

    #[test]
    fn test_validate_mime_type_allowed() {
        assert!(validate_mime_type("image/png").is_ok());
        assert!(validate_mime_type("image/jpeg").is_ok());
        assert!(validate_mime_type("image/gif").is_ok());
        assert!(validate_mime_type("image/webp").is_ok());
        assert!(validate_mime_type("image/bmp").is_ok());
        assert!(validate_mime_type("application/pdf").is_ok());
        assert!(validate_mime_type("text/plain").is_ok());
        assert!(validate_mime_type("text/markdown").is_ok());
    }

    #[test]
    fn test_validate_mime_type_rejected() {
        let result = validate_mime_type("application/exe");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not supported"));
    }

    #[test]
    fn test_validate_mime_type_octet_stream_rejected() {
        let result = validate_mime_type("application/octet-stream");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_file_not_found() {
        let result = validate_file(Path::new("/nonexistent/file.txt"), 10 * 1024 * 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("File not found"));
    }
}
