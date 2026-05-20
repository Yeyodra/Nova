use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub message_id: Option<String>, // NULL until linked to a message on send
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub file_path: String,
    pub extracted_text: Option<String>,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_attachment_serialization() {
        let a = Attachment {
            id: "att-123".to_string(),
            message_id: None, // NULL until linked to a message
            file_name: "test.png".to_string(),
            file_size: 1024,
            mime_type: "image/png".to_string(),
            file_path: "/path/to/file.png".to_string(),
            extracted_text: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("att-123"));
        assert!(json.contains("fileName")); // camelCase
        assert!(json.contains("messageId")); // camelCase
    }
}
