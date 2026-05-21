use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::ipc::Channel;
use tokio::task::JoinSet;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Attachment, CompareMessage, CompareSession, Message, Provider},
};

use super::{chat_service, now_rfc3339};

/// Configuration for a single model in a compare request.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareModelConfig {
    pub provider_id: String,
    pub model_id: String,
}

// ─── CRUD: Sessions ───────────────────────────────────────────────────────────

pub async fn create_session(db: &SqlitePool, model_ids: Vec<String>) -> AppResult<CompareSession> {
    let now = now_rfc3339();
    let model_ids_json = serde_json::to_string(&model_ids).unwrap_or_default();

    let session = CompareSession {
        id: Uuid::new_v4().to_string(),
        title: "New Compare".to_string(),
        model_ids: model_ids_json,
        created_at: now.clone(),
        updated_at: now,
    };

    sqlx::query(
        "INSERT INTO compare_sessions (id, title, model_ids, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&session.id)
    .bind(&session.title)
    .bind(&session.model_ids)
    .bind(&session.created_at)
    .bind(&session.updated_at)
    .execute(db)
    .await?;

    Ok(session)
}

pub async fn get_session(db: &SqlitePool, id: &str) -> AppResult<CompareSession> {
    sqlx::query_as::<_, CompareSession>(
        "SELECT id, title, model_ids, created_at, updated_at FROM compare_sessions WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Compare session not found: {id}")))
}

pub async fn list_sessions(db: &SqlitePool) -> AppResult<Vec<CompareSession>> {
    let sessions = sqlx::query_as::<_, CompareSession>(
        "SELECT id, title, model_ids, created_at, updated_at FROM compare_sessions ORDER BY updated_at DESC",
    )
    .fetch_all(db)
    .await?;

    Ok(sessions)
}

pub async fn delete_session(db: &SqlitePool, id: &str) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM compare_sessions WHERE id = ?1")
        .bind(id)
        .execute(db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "Compare session not found: {id}"
        )));
    }

    Ok(())
}

// ─── CRUD: Messages ───────────────────────────────────────────────────────────

pub async fn get_messages(db: &SqlitePool, session_id: &str) -> AppResult<Vec<CompareMessage>> {
    let messages = sqlx::query_as::<_, CompareMessage>(
        "SELECT id, compare_session_id, role, content, model_id, provider_id, created_at \
         FROM compare_messages WHERE compare_session_id = ?1 ORDER BY created_at ASC",
    )
    .bind(session_id)
    .fetch_all(db)
    .await?;

    Ok(messages)
}

pub async fn save_user_message(
    db: &SqlitePool,
    session_id: &str,
    content: &str,
) -> AppResult<CompareMessage> {
    let now = now_rfc3339();
    let msg = CompareMessage {
        id: Uuid::new_v4().to_string(),
        compare_session_id: session_id.to_string(),
        role: "user".to_string(),
        content: content.to_string(),
        model_id: None,
        provider_id: None,
        created_at: now,
    };

    sqlx::query(
        "INSERT INTO compare_messages (id, compare_session_id, role, content, model_id, provider_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&msg.id)
    .bind(&msg.compare_session_id)
    .bind(&msg.role)
    .bind(&msg.content)
    .bind(&msg.model_id)
    .bind(&msg.provider_id)
    .bind(&msg.created_at)
    .execute(db)
    .await?;

    Ok(msg)
}

pub async fn save_assistant_message(
    db: &SqlitePool,
    session_id: &str,
    content: &str,
    model_id: &str,
    provider_id: &str,
) -> AppResult<CompareMessage> {
    let now = now_rfc3339();
    let msg = CompareMessage {
        id: Uuid::new_v4().to_string(),
        compare_session_id: session_id.to_string(),
        role: "assistant".to_string(),
        content: content.to_string(),
        model_id: Some(model_id.to_string()),
        provider_id: Some(provider_id.to_string()),
        created_at: now,
    };

    sqlx::query(
        "INSERT INTO compare_messages (id, compare_session_id, role, content, model_id, provider_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&msg.id)
    .bind(&msg.compare_session_id)
    .bind(&msg.role)
    .bind(&msg.content)
    .bind(&msg.model_id)
    .bind(&msg.provider_id)
    .bind(&msg.created_at)
    .execute(db)
    .await?;

    Ok(msg)
}

// ─── Parallel Streaming ───────────────────────────────────────────────────────

/// Sends a user message to multiple models in parallel, streaming each response
/// to its own channel. Individual task failures don't kill others.
#[allow(clippy::too_many_arguments)]
pub async fn send_compare(
    db: &SqlitePool,
    session_id: &str,
    content: &str,
    models: Vec<CompareModelConfig>,
    channels: Vec<Channel<String>>,
    cancel_token: CancellationToken,
    attachment_ids: Vec<String>,
) -> AppResult<()> {
    // Save user message first
    save_user_message(db, session_id, content).await?;

    // Fetch attachments if any
    let attachments: Vec<Attachment> = if attachment_ids.is_empty() {
        Vec::new()
    } else {
        let placeholders: String = attachment_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "SELECT id, message_id, file_name, file_size, mime_type, file_path, extracted_text, created_at \
             FROM attachments WHERE id IN ({})",
            placeholders
        );
        let mut q = sqlx::query_as::<_, Attachment>(&query);
        for id in &attachment_ids {
            q = q.bind(id);
        }
        q.fetch_all(db).await.unwrap_or_default()
    };

    // Fetch all previous messages for this session to build per-model conversation history
    let all_messages = get_messages(db, session_id).await?;

    let mut join_set: JoinSet<()> = JoinSet::new();

    for (i, model_config) in models.into_iter().enumerate() {
        let db = db.clone();
        let session_id = session_id.to_string();
        let cancel = cancel_token.clone();
        let channel = channels[i].clone();
        let attachments_clone = attachments.clone();

        // Build per-model history: all user messages + this model's assistant messages, interleaved
        let user_messages: Vec<&CompareMessage> = all_messages
            .iter()
            .filter(|m| m.role == "user")
            .collect();
        let model_assistant_messages: Vec<&CompareMessage> = all_messages
            .iter()
            .filter(|m| m.role == "assistant" && m.model_id.as_deref() == Some(&model_config.model_id))
            .collect();

        let mut history: Vec<Message> = Vec::new();
        for (idx, user_msg) in user_messages.iter().enumerate() {
            history.push(Message {
                id: user_msg.id.clone(),
                session_id: session_id.clone(),
                role: "user".to_string(),
                content: user_msg.content.clone(),
                created_at: user_msg.created_at.clone(),
            });
            if let Some(asst) = model_assistant_messages.get(idx) {
                history.push(Message {
                    id: asst.id.clone(),
                    session_id: session_id.clone(),
                    role: "assistant".to_string(),
                    content: asst.content.clone(),
                    created_at: asst.created_at.clone(),
                });
            }
        }

        join_set.spawn(async move {
            let result = timeout(
                Duration::from_secs(120),
                execute_single_model(
                    &db,
                    &session_id,
                    &model_config,
                    history,
                    &attachments_clone,
                    &channel,
                    &cancel,
                    i,
                ),
            )
            .await;

            match result {
                Ok(Ok(_)) => {
                    // Success — message already saved in execute_single_model
                }
                Ok(Err(e)) => {
                    // Model returned an error — prefix error with index too
                    let _ = channel.send(format!("{}:ERROR:{}", i, e));
                }
                Err(_) => {
                    // Timeout — prefix error with index too
                    let _ = channel
                        .send(format!("{}:ERROR:Request timed out after 120 seconds", i));
                }
            }
        });
    }

    // Wait for all tasks to complete
    while join_set.join_next().await.is_some() {}

    Ok(())
}

/// Execute streaming for a single model, save result to DB on success.
async fn execute_single_model(
    db: &SqlitePool,
    session_id: &str,
    model_config: &CompareModelConfig,
    history: Vec<Message>,
    attachments: &[Attachment],
    channel: &Channel<String>,
    cancel_token: &CancellationToken,
    model_index: usize,
) -> AppResult<(String, Option<chat_service::TokenUsage>)> {
    // Resolve provider
    let provider = sqlx::query_as::<_, Provider>(
        "SELECT id, name, provider_type, base_url, api_key, model, is_default, is_builtin, is_enabled, api_format, created_at, updated_at \
         FROM providers WHERE id = ?1",
    )
    .bind(&model_config.provider_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!("Provider not found: {}", model_config.provider_id))
    })?;

    // Determine effective base_url
    let effective_base_url = crate::models::fixed_base_url(&provider.provider_type)
        .map(|s| s.to_string())
        .unwrap_or_else(|| provider.base_url.clone());

    let token_prefix = format!("{}:", model_index);

    // Dispatch based on api_format
    let result = if provider.uses_anthropic_format() {
        chat_service::send_anthropic(
            history,
            &model_config.model_id,
            provider.api_key.as_deref(),
            &provider.provider_type,
            &effective_base_url,
            attachments,
            channel,
            cancel_token,
            &token_prefix,
        )
        .await?
    } else {
        chat_service::send_openai_compatible(
            &effective_base_url,
            &model_config.model_id,
            provider.api_key.as_deref(),
            true,
            history,
            attachments,
            channel,
            cancel_token,
            &token_prefix,
        )
        .await?
    };

    // Save assistant message on success
    let (full_content, _usage) = &result;
    save_assistant_message(
        db,
        session_id,
        full_content,
        &model_config.model_id,
        &model_config.provider_id,
    )
    .await?;

    Ok(result)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    async fn setup_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        // Run compare migration
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS compare_sessions (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT 'New Compare',
                model_ids TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS compare_messages (
                id TEXT PRIMARY KEY NOT NULL,
                compare_session_id TEXT NOT NULL REFERENCES compare_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model_id TEXT,
                provider_id TEXT,
                created_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_create_and_get_session() {
        let db = setup_db().await;

        let model_ids = vec!["gpt-4".to_string(), "claude-3".to_string()];
        let session = create_session(&db, model_ids.clone()).await.unwrap();

        assert_eq!(session.title, "New Compare");
        assert!(!session.id.is_empty());

        // Verify model_ids stored as JSON
        let parsed: Vec<String> = serde_json::from_str(&session.model_ids).unwrap();
        assert_eq!(parsed, model_ids);

        // Get session by ID
        let fetched = get_session(&db, &session.id).await.unwrap();
        assert_eq!(fetched.id, session.id);
        assert_eq!(fetched.model_ids, session.model_ids);
    }

    #[tokio::test]
    async fn test_list_sessions() {
        let db = setup_db().await;

        // Create multiple sessions
        create_session(&db, vec!["gpt-4".to_string()])
            .await
            .unwrap();
        create_session(&db, vec!["claude-3".to_string()])
            .await
            .unwrap();

        let sessions = list_sessions(&db).await.unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[tokio::test]
    async fn test_delete_session() {
        let db = setup_db().await;

        let session = create_session(&db, vec!["gpt-4".to_string()])
            .await
            .unwrap();
        delete_session(&db, &session.id).await.unwrap();

        let result = get_session(&db, &session.id).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_save_and_get_messages() {
        let db = setup_db().await;

        let session = create_session(&db, vec!["gpt-4".to_string()])
            .await
            .unwrap();

        // Save user message
        let user_msg = save_user_message(&db, &session.id, "Hello, compare!")
            .await
            .unwrap();
        assert_eq!(user_msg.role, "user");
        assert!(user_msg.model_id.is_none());
        assert!(user_msg.provider_id.is_none());

        // Save assistant message
        let asst_msg =
            save_assistant_message(&db, &session.id, "Hi from GPT-4", "gpt-4", "openai-provider")
                .await
                .unwrap();
        assert_eq!(asst_msg.role, "assistant");
        assert_eq!(asst_msg.model_id, Some("gpt-4".to_string()));
        assert_eq!(
            asst_msg.provider_id,
            Some("openai-provider".to_string())
        );

        // Get all messages
        let messages = get_messages(&db, &session.id).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].role, "assistant");
    }
}
