use std::path::Path;

use crate::error::{AppError, AppResult};

const MAX_EXTRACTED_CHARS: usize = 50_000;

/// Main dispatcher: extract text based on file extension
pub fn extract_text(path: &Path) -> AppResult<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "txt" | "md" => extract_txt(path),
        "pdf" => extract_pdf(path),
        _ => Err(AppError::Validation(format!(
            "Unsupported file type for text extraction: .{ext}"
        ))),
    }
}

fn extract_txt(path: &Path) -> AppResult<String> {
    let content = std::fs::read_to_string(path).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(truncate_text(content))
}

fn extract_pdf(path: &Path) -> AppResult<String> {
    match pdf_extract::extract_text(path) {
        Ok(text) => {
            let trimmed = text.trim().to_string();
            if trimmed.is_empty() {
                Ok("[No text content could be extracted from this PDF]".to_string())
            } else {
                Ok(truncate_text(trimmed))
            }
        }
        Err(_) => {
            // Graceful fallback — don't crash on corrupt/image-only PDFs
            Ok("[Text extraction failed for this PDF]".to_string())
        }
    }
}

fn truncate_text(text: String) -> String {
    if text.chars().count() > MAX_EXTRACTED_CHARS {
        let truncated: String = text.chars().take(MAX_EXTRACTED_CHARS).collect();
        format!("{truncated}\n\n[... truncated at {MAX_EXTRACTED_CHARS} characters]")
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_extract_text_from_txt() {
        let mut file = NamedTempFile::with_suffix(".txt").unwrap();
        write!(file, "Hello, world! This is a test file.").unwrap();

        let result = extract_text(file.path()).unwrap();
        assert_eq!(result, "Hello, world! This is a test file.");
    }

    #[test]
    fn test_extract_text_from_md() {
        let mut file = NamedTempFile::with_suffix(".md").unwrap();
        write!(file, "# Heading\n\nSome markdown content.").unwrap();

        let result = extract_text(file.path()).unwrap();
        assert_eq!(result, "# Heading\n\nSome markdown content.");
    }

    #[test]
    fn test_extract_empty_pdf() {
        // Minimal valid PDF with no text streams
        let pdf_bytes = b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF";

        let mut file = NamedTempFile::with_suffix(".pdf").unwrap();
        file.write_all(pdf_bytes).unwrap();
        file.flush().unwrap();

        let result = extract_text(file.path()).unwrap();
        // Should return a graceful message, not panic
        assert!(
            result.contains("[No text content could be extracted from this PDF]")
                || result.contains("[Text extraction failed for this PDF]")
        );
    }

    #[test]
    fn test_extract_large_file_truncation() {
        let mut file = NamedTempFile::with_suffix(".txt").unwrap();
        let large_content = "a".repeat(60_000);
        write!(file, "{}", large_content).unwrap();

        let result = extract_text(file.path()).unwrap();
        assert!(result.contains("[... truncated at 50000 characters]"));
        // The truncated content + suffix should be longer than MAX but the actual text part is MAX
        assert!(result.len() > MAX_EXTRACTED_CHARS);
        // Verify the first part is correct
        assert!(result.starts_with("aaaa"));
    }

    #[test]
    fn test_unsupported_format() {
        let file = NamedTempFile::with_suffix(".exe").unwrap();

        let result = extract_text(file.path());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Unsupported file type"));
    }
}
