use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CompareSession {
    pub id: String,
    pub title: String,
    pub model_ids: String, // JSON array stored as TEXT in SQLite
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CompareMessage {
    pub id: String,
    pub compare_session_id: String,
    pub role: String, // 'user' or 'assistant'
    pub content: String,
    pub model_id: Option<String>,    // NULL for user messages
    pub provider_id: Option<String>, // NULL for user messages
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_session_serialization() {
        let s = CompareSession {
            id: "cs-123".to_string(),
            title: "Test Compare".to_string(),
            model_ids: r#"["gpt-4","claude-3"]"#.to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("cs-123"));
        assert!(json.contains("modelIds")); // camelCase
        assert!(json.contains("createdAt")); // camelCase
    }

    #[test]
    fn test_compare_message_serialization() {
        let m = CompareMessage {
            id: "cm-456".to_string(),
            compare_session_id: "cs-123".to_string(),
            role: "assistant".to_string(),
            content: "Hello from GPT-4".to_string(),
            model_id: Some("gpt-4".to_string()),
            provider_id: Some("openai".to_string()),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("cm-456"));
        assert!(json.contains("compareSessionId")); // camelCase
        assert!(json.contains("modelId")); // camelCase
        assert!(json.contains("providerId")); // camelCase
    }
}
