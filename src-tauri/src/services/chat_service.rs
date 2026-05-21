// serde_json::json! macro internally uses .unwrap() in its expansion.
// This module uses json! extensively for OpenAI API payloads — allowing at module level
// to avoid repetitive per-call annotations. Manual unwrap/expect calls are still forbidden.
#![allow(clippy::disallowed_methods)]

use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Attachment, Message, MessageWithAttachments},
};

use super::file_service;

use super::{http_client, now_rfc3339, provider_service};
use base64::Engine;

/// Keywords that trigger full visual/preview system prompt injection
const VISUAL_KEYWORDS: &[&str] = &[
    "chart", "diagram", "graph", "visuali", "svg", "plot", "widget",
    "mockup", "wireframe", "flowchart", "draw", "gambar", "buat grafik",
    "bikin chart", "bikin diagram", "buatkan", "tampilkan", "tabel",
    "html:preview", "interactive", "infographic", "dashboard", "canvas",
    "pie chart", "bar chart", "line chart", "perbandingan", "statistik",
];

fn needs_visual_guide(content: &str) -> bool {
    let lower = content.to_lowercase();
    VISUAL_KEYWORDS.iter().any(|kw| lower.contains(kw))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatUsageEvent {
    session_id: String,
    usage: TokenUsage,
}

#[derive(Debug, Default)]
struct UsageAccumulator {
    prompt_tokens: u32,
    completion_tokens: u32,
}

impl UsageAccumulator {
    fn finish(self) -> Option<TokenUsage> {
        let total = self.prompt_tokens + self.completion_tokens;
        if total == 0 {
            None
        } else {
            Some(TokenUsage {
                prompt_tokens: self.prompt_tokens,
                completion_tokens: self.completion_tokens,
                total_tokens: total,
            })
        }
    }
}

/// Internal: get raw messages for LLM context (no attachments needed)
pub async fn get_messages_raw(db: &SqlitePool, session_id: &str) -> AppResult<Vec<Message>> {
    let messages = sqlx::query_as::<_, Message>(
        "SELECT id, session_id, role, content, created_at FROM messages \
         WHERE session_id = ?1 ORDER BY created_at ASC",
    )
    .bind(session_id)
    .fetch_all(db)
    .await?;

    Ok(messages)
}

/// API: get messages with attachments for frontend display
pub async fn get_messages(db: &SqlitePool, session_id: &str) -> AppResult<Vec<MessageWithAttachments>> {
    let messages = sqlx::query_as::<_, Message>(
        "SELECT id, session_id, role, content, created_at FROM messages \
         WHERE session_id = ?1 ORDER BY created_at ASC",
    )
    .bind(session_id)
    .fetch_all(db)
    .await?;

    let attachments = sqlx::query_as::<_, Attachment>(
        "SELECT a.id, a.message_id, a.file_name, a.file_size, a.mime_type, a.file_path, a.extracted_text, a.created_at \
         FROM attachments a \
         INNER JOIN messages m ON a.message_id = m.id \
         WHERE m.session_id = ?1 \
         ORDER BY a.created_at ASC",
    )
    .bind(session_id)
    .fetch_all(db)
    .await?;

    let mut attachment_map: std::collections::HashMap<String, Vec<Attachment>> =
        std::collections::HashMap::new();
    for att in attachments {
        if let Some(ref msg_id) = att.message_id {
            attachment_map.entry(msg_id.clone()).or_default().push(att);
        }
    }

    let result = messages
        .into_iter()
        .map(|m| {
            let atts = attachment_map.remove(&m.id).unwrap_or_default();
            MessageWithAttachments {
                id: m.id,
                session_id: m.session_id,
                role: m.role,
                content: m.content,
                created_at: m.created_at,
                attachments: atts,
            }
        })
        .collect();

    Ok(result)
}

/// Return a trimmed conversation window suitable for sending to the LLM.
///
/// Applies the same sliding-window + token-budget strategy used by the agent
/// runner so that the chat path doesn't blow up token usage on long sessions.
///
/// Rules:
///   - Keep at most the last `MAX_HISTORY_PAIRS` user/assistant exchanges.
///   - Strip `html:preview` fenced blocks from assistant messages (huge, not
///     useful as context).
///   - Truncate individual messages that exceed per-role char limits.
///   - Stop accumulating once the total char budget is reached.
fn trim_history_for_llm(history: &[Message]) -> Vec<Message> {
    const MAX_HISTORY_PAIRS: usize = 20;
    const MAX_TOTAL_CHARS: usize = 32_000; // ≈ 8 K tokens
    const MAX_USER_MSG_CHARS: usize = 2_000;
    const MAX_ASSISTANT_MSG_CHARS: usize = 4_000;

    // Separate system messages (always kept) from chat messages
    let system_msgs: Vec<&Message> = history.iter().filter(|m| m.role == "system").collect();
    let chat_msgs: Vec<&Message> = history.iter().filter(|m| m.role != "system").collect();

    // Sliding window: keep only the most recent N*2 chat messages
    let window_start = chat_msgs.len().saturating_sub(MAX_HISTORY_PAIRS * 2);
    let windowed = &chat_msgs[window_start..];

    let mut result: Vec<Message> = Vec::with_capacity(system_msgs.len() + windowed.len());
    let mut total_chars: usize = 0;

    // Always include system messages first (they're tiny)
    for msg in &system_msgs {
        total_chars += msg.content.len();
        result.push((*msg).clone());
    }

    for msg in windowed {
        if total_chars >= MAX_TOTAL_CHARS {
            break;
        }

        let cleaned = if msg.role == "assistant" {
            strip_preview_blocks_chat(&msg.content)
        } else {
            msg.content.clone()
        };

        let max_len = if msg.role == "user" {
            MAX_USER_MSG_CHARS
        } else {
            MAX_ASSISTANT_MSG_CHARS
        };

        let truncated = if cleaned.len() > max_len {
            let cut = &cleaned[..max_len];
            let last_space = cut.rfind(' ').unwrap_or(max_len);
            format!("{}… [truncated]", &cleaned[..last_space])
        } else {
            cleaned
        };

        total_chars += truncated.len();

        result.push(Message {
            id: msg.id.clone(),
            session_id: msg.session_id.clone(),
            role: msg.role.clone(),
            content: truncated,
            created_at: msg.created_at.clone(),
        });
    }

    result
}

/// Strip ```html:preview … ``` fenced blocks from assistant output.
/// These are rendered widgets that can be thousands of tokens and add no
/// conversational value when sent back as context.
fn strip_preview_blocks_chat(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut chars = content.char_indices().peekable();
    let fence_tag = "```html:preview";

    while let Some(&(i, _)) = chars.peek() {
        if content[i..].starts_with(fence_tag) {
            // Skip past the opening fence line
            while let Some(&(_, c)) = chars.peek() {
                chars.next();
                if c == '\n' {
                    break;
                }
            }
            // Skip until closing ```
            let mut found_close = false;
            while let Some(&(j, _)) = chars.peek() {
                if content[j..].starts_with("```") {
                    // consume the closing ```
                    for _ in 0..3 {
                        chars.next();
                    }
                    // consume rest of line
                    while let Some(&(_, c)) = chars.peek() {
                        chars.next();
                        if c == '\n' {
                            break;
                        }
                    }
                    found_close = true;
                    break;
                }
                chars.next();
            }
            result.push_str("[interactive preview]");
            if !found_close {
                break;
            }
        } else {
            let (_, c) = chars.next().unwrap();
            result.push(c);
        }
    }

    result
}

#[allow(clippy::too_many_arguments)]
pub async fn send_message(
    db: &SqlitePool,
    session_id: &str,
    content: &str,
    provider_id: Option<&str>,
    model_id: Option<&str>,
    attachment_ids: Vec<String>,
    on_token: Channel<String>,
    app_handle: &AppHandle,
    cancel_token: CancellationToken,
) -> AppResult<()> {
    let result = send_message_inner(
        db,
        session_id,
        content,
        provider_id,
        model_id,
        attachment_ids,
        on_token,
        app_handle,
        cancel_token,
    )
    .await;
    match &result {
        Err(AppError::Cancelled) => {
            let _ = app_handle.emit("chat-done", "cancelled");
            return Ok(());
        }
        Err(ref error) => {
            let _ = app_handle.emit("chat-error", error.to_string());
        }
        _ => {}
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn send_message_inner(
    db: &SqlitePool,
    session_id: &str,
    content: &str,
    provider_id: Option<&str>,
    model_id: Option<&str>,
    attachment_ids: Vec<String>,
    on_token: Channel<String>,
    app_handle: &AppHandle,
    cancel_token: CancellationToken,
) -> AppResult<()> {
    let normalized = content.trim();
    if normalized.is_empty() {
        return Err(AppError::Validation(
            "Message content cannot be empty".to_string(),
        ));
    }

    let user_message = Message {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        role: "user".to_string(),
        content: normalized.to_string(),
        created_at: now_rfc3339(),
    };

    sqlx::query(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&user_message.id)
    .bind(&user_message.session_id)
    .bind(&user_message.role)
    .bind(&user_message.content)
    .bind(&user_message.created_at)
    .execute(db)
    .await?;

    // Link pending attachments to this message
    if !attachment_ids.is_empty() {
        let placeholders: String = attachment_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "UPDATE attachments SET message_id = ? WHERE id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&query).bind(&user_message.id);
        for id in &attachment_ids {
            q = q.bind(id);
        }
        q.execute(db).await?;
    }

    let provider = provider_service::get_provider_for_chat(db, provider_id).await?;

    // Pre-flight: check API key is configured (except for local providers like Ollama)
    if provider.provider_type != "ollama"
        && provider
            .api_key
            .as_deref()
            .is_none_or(|k| k.trim().is_empty())
    {
        return Err(AppError::Validation(format!(
            "API key not configured for '{}'. Go to Settings → Providers and enter your API key.",
            provider.name
        )));
    }

    let raw_history = get_messages_raw(db, session_id).await?;
    let history = trim_history_for_llm(&raw_history);

    // Debug: log context size so token bloat is easy to spot
    let total_chars: usize = history.iter().map(|m| m.content.len()).sum();
    let est_tokens = total_chars / 4; // rough estimate: 1 token ≈ 4 chars
    log::debug!(
        "chat context: {} msgs (raw {}), ~{} chars (~{} tokens)",
        history.len(),
        raw_history.len(),
        total_chars,
        est_tokens,
    );

    // Use caller-supplied model_id if provided, otherwise fall back to provider default
    let model = model_id.unwrap_or(&provider.model);

    // Fetch attachments for multimodal support
    let last_user_attachments: Vec<Attachment> = if attachment_ids.is_empty() {
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

    log::info!(
        "chat route: provider={} type={} api_format={} → {}",
        provider.name,
        provider.provider_type,
        provider.api_format,
        if provider.uses_anthropic_format() { "anthropic" } else { "openai" },
    );

    let (assistant_output, token_usage) = if provider.uses_anthropic_format() {
        send_anthropic(
            history,
            model,
            provider.api_key.as_deref(),
            &provider.provider_type,
            &provider.base_url,
            &last_user_attachments,
            &on_token,
            &cancel_token,
        )
        .await?
    } else {
        let supports_stream_usage = provider.provider_type == "openai";
        send_openai_compatible(
            &provider.base_url,
            model,
            provider.api_key.as_deref(),
            supports_stream_usage,
            history,
            &last_user_attachments,
            &on_token,
            &cancel_token,
        )
        .await?
    };

    if let Some(usage) = token_usage {
        let _ = app_handle.emit(
            "chat-usage",
            ChatUsageEvent {
                session_id: session_id.to_string(),
                usage,
            },
        );
    }

    let assistant_message = Message {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        role: "assistant".to_string(),
        content: assistant_output,
        created_at: now_rfc3339(),
    };

    sqlx::query(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&assistant_message.id)
    .bind(&assistant_message.session_id)
    .bind(&assistant_message.role)
    .bind(&assistant_message.content)
    .bind(&assistant_message.created_at)
    .execute(db)
    .await?;

    let _ = app_handle.emit("chat-done", assistant_message.id.clone());
    Ok(())
}

// ─── Multimodal content builders ─────────────────────────────────────────────

/// Build OpenAI multimodal content for a user message with attachments.
/// Images become image_url parts, documents have their text prepended as XML.
/// Returns plain string Value when no images (backward compatible).
fn build_openai_message_content(text: &str, attachments: &[Attachment]) -> Value {
    let images: Vec<&Attachment> = attachments
        .iter()
        .filter(|a| a.mime_type.starts_with("image/"))
        .collect();
    let documents: Vec<&Attachment> = attachments
        .iter()
        .filter(|a| !a.mime_type.starts_with("image/"))
        .collect();

    // Build text content with document context prepended
    let mut full_text = String::new();
    if !documents.is_empty() {
        full_text.push_str("<files_info>\n");
        for doc in &documents {
            if let Some(ref extracted) = doc.extracted_text {
                full_text.push_str(&format!(
                    "<file name=\"{}\" type=\"{}\">\n{}\n</file>\n",
                    doc.file_name, doc.mime_type, extracted
                ));
            }
        }
        full_text.push_str("</files_info>\n\n");
    }
    full_text.push_str(text);

    // If no images, return just the text (backward compatible)
    if images.is_empty() {
        return serde_json::json!(full_text);
    }

    // Build content array with text + image_url parts
    let mut content_parts: Vec<Value> =
        vec![serde_json::json!({ "type": "text", "text": full_text })];

    for img in &images {
        let path = std::path::Path::new(&img.file_path);
        // compress_image always outputs JPEG, so use "image/jpeg" for the data URI
        let (data, mime) = match file_service::compress_image(path, 1920, 85) {
            Ok(compressed) => (compressed, "image/jpeg".to_string()),
            Err(e) => {
                // Fallback: read raw file bytes with original mime type
                log::warn!("Image compression failed for {}: {}, using raw file", img.file_name, e);
                match std::fs::read(path) {
                    Ok(raw) => (raw, img.mime_type.clone()),
                    Err(_) => continue, // Skip only if file is truly unreadable
                }
            }
        };
        let data_uri = file_service::encode_to_base64(&data, &mime);
        content_parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": data_uri, "detail": "auto" }
        }));
    }

    serde_json::json!(content_parts)
}

/// Build Anthropic multimodal content blocks for a user message with attachments.
fn build_anthropic_message_content(text: &str, attachments: &[Attachment]) -> Vec<Value> {
    let images: Vec<&Attachment> = attachments
        .iter()
        .filter(|a| a.mime_type.starts_with("image/"))
        .collect();
    let documents: Vec<&Attachment> = attachments
        .iter()
        .filter(|a| !a.mime_type.starts_with("image/"))
        .collect();

    // Build text with document context
    let mut full_text = String::new();
    if !documents.is_empty() {
        full_text.push_str("<files_info>\n");
        for doc in &documents {
            if let Some(ref extracted) = doc.extracted_text {
                full_text.push_str(&format!(
                    "<file name=\"{}\" type=\"{}\">\n{}\n</file>\n",
                    doc.file_name, doc.mime_type, extracted
                ));
            }
        }
        full_text.push_str("</files_info>\n\n");
    }
    full_text.push_str(text);

    let mut content_blocks: Vec<Value> = Vec::new();

    // Add image blocks first (Anthropic convention)
    for img in &images {
        let path = std::path::Path::new(&img.file_path);
        let (data, mime) = match file_service::compress_image(path, 1920, 85) {
            Ok(compressed) => (compressed, "image/jpeg".to_string()),
            Err(e) => {
                log::warn!("Image compression failed for {}: {}, using raw file", img.file_name, e);
                match std::fs::read(path) {
                    Ok(raw) => (raw, img.mime_type.clone()),
                    Err(_) => continue,
                }
            }
        };
        let b64_data = base64::engine::general_purpose::STANDARD.encode(&data);
        content_blocks.push(serde_json::json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime,
                "data": b64_data
            }
        }));
    }

    // Add text block
    content_blocks.push(serde_json::json!({ "type": "text", "text": full_text }));

    content_blocks
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn send_openai_compatible(
    base_url: &str,
    model: &str,
    api_key: Option<&str>,
    include_usage: bool,
    history: Vec<Message>,
    last_user_attachments: &[Attachment],
    on_token: &Channel<String>,
    cancel_token: &CancellationToken,
) -> AppResult<(String, Option<TokenUsage>)> {
    let client = http_client::streaming_client()?;
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let last_user_idx = history.iter().rposition(|m| m.role == "user");

    let messages: Vec<Value> = history
        .iter()
        .enumerate()
        .map(|(i, m)| {
            if Some(i) == last_user_idx && !last_user_attachments.is_empty() {
                serde_json::json!({
                    "role": m.role,
                    "content": build_openai_message_content(&m.content, last_user_attachments)
                })
            } else {
                serde_json::json!({ "role": m.role, "content": m.content })
            }
        })
        .collect();

    let mut payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "presence_penalty": 0.0,
        "frequency_penalty": 0.0,
        "stream": true,
    });

    if include_usage {
        payload["stream_options"] = serde_json::json!({ "include_usage": true });
    }

    // Lazy system prompt: only inject full preview guide when user asks for visuals
    let last_user_content = history.iter().rev().find(|m| m.role == "user").map(|m| m.content.as_str()).unwrap_or("");
    let system_instructions = if needs_visual_guide(last_user_content) {
        concat!(
            "IMPORTANT: Reply using the same language as the user's latest message. If user writes Indonesian, answer in Indonesian. Never switch to another language unless the user explicitly asks you to.\n\n",
            "INTERACTIVE PREVIEW: When the user asks for a visualization, diagram, chart, interactive demo, or any visual HTML content, output it as a fenced code block with tag `html:preview`. The app renders it as a live iframe preview with a full design system pre-loaded (CSS variables, SVG color ramp classes, pre-styled form elements, light/dark mode).\n\n",
            "Design rules: flat (no gradients/shadows/glow), use CSS vars for colors (var(--color-text-primary), var(--color-background-secondary), etc). system-ui font, 2 weights (400/500), sentence case. Structure: style → content → script last.\n\n",
            "SVG diagrams: use pre-loaded classes — `.t` (14px text), `.ts` (12px), `.th` (14px bold), `.box` (neutral), `.node` (clickable), `.arr` (arrow), `.leader` (dashed). Color ramps: `class=\"c-blue\"` on `<g>` wrapping shape+text — auto light/dark. Available: c-purple, c-teal, c-coral, c-blue, c-amber, c-green, c-red, c-gray, c-pink. Max 2-3 ramps per diagram.\n\n",
            "Chart.js: wrap canvas in div with position:relative + explicit height. Load UMD from cdnjs.cloudflare.com with onload callback. Disable default legend, build custom HTML legend with 10px colored squares.\n\n",
            "Interactive: form elements pre-styled. Use sendPrompt(text) for drill-down. CDN: cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh only.\n\n",
            "Always output COMPLETE standalone HTML (DOCTYPE, html, head, body). No titles/prose inside widget — explanations go in your response text."
        )
    } else {
        concat!(
            "IMPORTANT: Reply using the same language as the user's latest message. If user writes Indonesian, answer in Indonesian. Never switch to another language unless the user explicitly asks you to.\n\n",
            "You can create interactive visualizations (charts, diagrams, widgets) by outputting a fenced code block with the language tag `html:preview`. The preview iframe has a full design system pre-loaded with CSS variables, SVG color ramp classes, and light/dark mode support. Use this when the user asks for any visual or interactive content."
        )
    };
    let payload_with_system = if let Some(arr) = payload.get("messages").and_then(Value::as_array) {
        let mut updated = arr.clone();
        updated.insert(
            0,
            serde_json::json!({
                "role": "system",
                "content": system_instructions,
            }),
        );
        let mut p = payload.clone();
        p["messages"] = Value::Array(updated);
        p
    } else {
        payload
    };

    let mut request = client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .json(&payload_with_system);

    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        request = request.header(AUTHORIZATION, format!("Bearer {key}"));
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("{status}: {body}")));
    }

    stream_openai_sse(response, on_token, cancel_token).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn send_anthropic(
    history: Vec<Message>,
    model: &str,
    api_key: Option<&str>,
    provider_type: &str,
    base_url: &str,
    last_user_attachments: &[Attachment],
    on_token: &Channel<String>,
    cancel_token: &CancellationToken,
) -> AppResult<(String, Option<TokenUsage>)> {
    let client = http_client::streaming_client()?;

    let (system_msgs, chat_msgs): (Vec<_>, Vec<_>) =
        history.iter().partition(|m| m.role == "system");

    // Find the last user message index within chat_msgs
    let last_user_idx = chat_msgs.iter().rposition(|m| m.role == "user");

    // Build messages as Anthropic content-block format for cache_control support
    let mut messages: Vec<Value> = chat_msgs
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "user" || m.role == "assistant")
        .map(|(i, m)| {
            if Some(i) == last_user_idx && !last_user_attachments.is_empty() {
                let content_blocks = build_anthropic_message_content(&m.content, last_user_attachments);
                serde_json::json!({
                    "role": m.role,
                    "content": content_blocks
                })
            } else {
                serde_json::json!({
                    "role": m.role,
                    "content": [{ "type": "text", "text": m.content }]
                })
            }
        })
        .collect();

    // Prompt caching: mark last user message with cache_control so the entire
    // conversation prefix is cached across turns (like Claude Desktop does).
    if let Some(last_msg) = messages.last_mut() {
        if last_msg.get("role").and_then(Value::as_str) == Some("user") {
            if let Some(content) = last_msg.get_mut("content").and_then(Value::as_array_mut) {
                if let Some(last_block) = content.last_mut() {
                    last_block["cache_control"] = serde_json::json!({"type": "ephemeral"});
                }
            }
        }
    }

    let mut payload = serde_json::json!({
        "model": model,
        "max_tokens": 8096,
        "messages": messages,
        "temperature": 0.2,
        "stream": true,
    });

    // Lazy system prompt for Anthropic: same logic as OpenAI path
    let last_user_content_anthropic = chat_msgs.iter().rev().find(|m| m.role == "user").map(|m| m.content.as_str()).unwrap_or("");
    let system_instructions_anthropic = if needs_visual_guide(last_user_content_anthropic) {
        concat!(
            "IMPORTANT: Reply using the same language as the user's latest message. If user writes Indonesian, answer in Indonesian. Never switch to another language unless the user explicitly asks you to.\n\n",
            "INTERACTIVE PREVIEW: When the user asks for a visualization, diagram, chart, interactive demo, or any visual HTML content, output it as a fenced code block with tag `html:preview`. The app renders it as a live iframe preview with a full design system pre-loaded (CSS variables, SVG color ramp classes, pre-styled form elements, light/dark mode).\n\n",
            "Design rules: flat (no gradients/shadows/glow), use CSS vars for colors (var(--color-text-primary), var(--color-background-secondary), etc). system-ui font, 2 weights (400/500), sentence case. Structure: style → content → script last.\n\n",
            "SVG diagrams: use pre-loaded classes — `.t` (14px text), `.ts` (12px), `.th` (14px bold), `.box` (neutral), `.node` (clickable), `.arr` (arrow), `.leader` (dashed). Color ramps: `class=\"c-blue\"` on `<g>` wrapping shape+text — auto light/dark. Available: c-purple, c-teal, c-coral, c-blue, c-amber, c-green, c-red, c-gray, c-pink. Max 2-3 ramps per diagram.\n\n",
            "Chart.js: wrap canvas in div with position:relative + explicit height. Load UMD from cdnjs.cloudflare.com with onload callback. Disable default legend, build custom HTML legend with 10px colored squares.\n\n",
            "Interactive: form elements pre-styled. Use sendPrompt(text) for drill-down. CDN: cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh only.\n\n",
            "Always output COMPLETE standalone HTML (DOCTYPE, html, head, body). No titles/prose inside widget — explanations go in your response text."
        )
    } else {
        concat!(
            "IMPORTANT: Reply using the same language as the user's latest message. If user writes Indonesian, answer in Indonesian. Never switch to another language unless the user explicitly asks you to.\n\n",
            "You can create interactive visualizations (charts, diagrams, widgets) by outputting a fenced code block with the language tag `html:preview`. The preview iframe has a full design system pre-loaded with CSS variables, SVG color ramp classes, and light/dark mode support. Use this when the user asks for any visual or interactive content."
        )
    };
    // Prompt caching: system prompt as cached content block
    let system_text = if let Some(sys) = system_msgs.first() {
        format!("{}\n\n{}", sys.content, system_instructions_anthropic)
    } else {
        system_instructions_anthropic.to_string()
    };
    payload["system"] = serde_json::json!([
        {
            "type": "text",
            "text": system_text,
            "cache_control": {"type": "ephemeral"}
        }
    ]);

    // Resolve endpoint for Anthropic-format requests.
    //
    // - Anthropic direct: always use the canonical URL.
    // - enowxlabs built-in: base_url ends with /v1 → strip it, append /messages
    //   (enowxlabs gateway expects /messages at the root).
    // - Custom gateways: keep the base_url as-is and append /messages.
    //   If the user stored "http://host:port/v1" we keep /v1 so the final
    //   endpoint is "http://host:port/v1/messages" — most Anthropic-compatible
    //   proxies (e.g. LiteLLM, Claude Desktop gateway) expect this.
    let endpoint = if provider_type == "anthropic" {
        "https://api.anthropic.com/v1/messages".to_string()
    } else if provider_type == "enowxlabs" {
        // enowxlabs own gateway: strip /v1 suffix
        format!(
            "{}/messages",
            base_url
                .trim_end_matches('/')
                .trim_end_matches("/v1")
        )
    } else {
        // Custom / third-party gateway: preserve the full base_url path
        format!("{}/messages", base_url.trim_end_matches('/'))
    };

    log::info!("anthropic endpoint: {} (base_url={}, provider_type={})", endpoint, base_url, provider_type);

    let mut request = client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .json(&payload);

    // Auth: x-api-key for Anthropic direct, Bearer for gateways
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        if provider_type == "anthropic" {
            request = request.header("x-api-key", key);
        } else {
            request = request.header(AUTHORIZATION, format!("Bearer {key}"));
        }
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("Anthropic {status}: {body}")));
    }

    let (output, usage) = stream_anthropic_sse(response, on_token, cancel_token).await?;

    // Fallback: some gateways return message_start → message_stop without any
    // content_block events for certain models.  Retry non-streaming.
    if output.is_empty() {
        log::warn!("anthropic chat stream returned empty — retrying non-streaming");
        payload["stream"] = serde_json::json!(false);

        let mut retry_req = client
            .post(&endpoint)
            .header(CONTENT_TYPE, "application/json")
            .header("anthropic-version", "2023-06-01")
            .json(&payload);

        if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
            if provider_type == "anthropic" {
                retry_req = retry_req.header("x-api-key", key);
            } else {
                retry_req = retry_req.header(AUTHORIZATION, format!("Bearer {key}"));
            }
        }

        let retry_resp = retry_req.send().await?;
        if !retry_resp.status().is_success() {
            let status = retry_resp.status();
            let body = retry_resp.text().await.unwrap_or_default();
            return Err(AppError::Http(format!("Anthropic non-stream {status}: {body}")));
        }

        let body: Value = retry_resp.json().await?;
        if let Some(text) = body
            .get("content")
            .and_then(Value::as_array)
            .and_then(|arr| arr.first())
            .and_then(|block| block.get("text"))
            .and_then(Value::as_str)
        {
            let _ = on_token.send(text.to_string());
            return Ok((text.to_string(), usage));
        }

        return Ok((String::new(), usage));
    }

    Ok((output, usage))
}

async fn stream_openai_sse(
    response: reqwest::Response,
    on_token: &Channel<String>,
    cancel_token: &CancellationToken,
) -> AppResult<(String, Option<TokenUsage>)> {
    let mut stream = response.bytes_stream();
    let mut line_buffer = String::new();
    let mut output = String::new();
    let mut usage = UsageAccumulator::default();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                return Err(AppError::Cancelled);
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        line_buffer.push_str(&String::from_utf8_lossy(&bytes));

                        while let Some(pos) = line_buffer.find('\n') {
                            let mut line = line_buffer[..pos].to_string();
                            line_buffer.drain(..=pos);
                            if line.ends_with('\r') {
                                line.pop();
                            }

                            if parse_openai_sse_line(&line, on_token, &mut output, &mut usage)? {
                                return Ok((output, usage.finish()));
                            }
                        }
                    }
                    Some(Err(e)) => return Err(AppError::Http(e.to_string())),
                    None => break,
                }
            }
        }
    }

    if !line_buffer.is_empty() {
        parse_openai_sse_line(&line_buffer, on_token, &mut output, &mut usage)?;
    }

    Ok((output, usage.finish()))
}

fn parse_openai_sse_line(
    line: &str,
    on_token: &Channel<String>,
    output: &mut String,
    usage: &mut UsageAccumulator,
) -> AppResult<bool> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let Some(payload) = trimmed.strip_prefix("data:") else {
        return Ok(false);
    };
    let payload = payload.trim();
    if payload == "[DONE]" {
        return Ok(true);
    }

    let value: Value = serde_json::from_str(payload)?;

    if let Some(u) = value.get("usage") {
        if let Some(pt) = u.get("prompt_tokens").and_then(Value::as_u64) {
            usage.prompt_tokens = pt as u32;
        }
        if let Some(ct) = u.get("completion_tokens").and_then(Value::as_u64) {
            usage.completion_tokens = ct as u32;
        }
    }

    if let Some(token) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("delta"))
        .and_then(|d| d.get("content"))
        .and_then(Value::as_str)
    {
        output.push_str(token);
        let _ = on_token.send(token.to_string());
    }

    Ok(false)
}

async fn stream_anthropic_sse(
    response: reqwest::Response,
    on_token: &Channel<String>,
    cancel_token: &CancellationToken,
) -> AppResult<(String, Option<TokenUsage>)> {
    let mut stream = response.bytes_stream();
    let mut line_buffer = String::new();
    let mut output = String::new();
    // Track the most recent `event:` line so we can use it when parsing the
    // subsequent `data:` line.  Some gateways omit the `"type"` field from
    // the JSON payload, so we fall back to the SSE event name.
    let mut current_event = String::new();
    let mut usage = UsageAccumulator::default();
    let mut message_stop_received = false;

    'outer: loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                return Err(AppError::Cancelled);
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        line_buffer.push_str(&String::from_utf8_lossy(&bytes));

                        while let Some(pos) = line_buffer.find('\n') {
                            let mut line = line_buffer[..pos].to_string();
                            line_buffer.drain(..=pos);
                            if line.ends_with('\r') {
                                line.pop();
                            }

                            if parse_anthropic_sse_line(
                                &line,
                                &mut current_event,
                                on_token,
                                &mut output,
                                &mut usage,
                            )? {
                                message_stop_received = true;
                                break 'outer;
                            }
                        }
                    }
                    Some(Err(e)) => return Err(AppError::Http(e.to_string())),
                    None => break,
                }
            }
        }
    }

    if !message_stop_received {
        return Err(AppError::Http(
            "Stream ended without completion signal — connection may have been interrupted. Please retry.".to_string(),
        ));
    }

    Ok((output, usage.finish()))
}

/// Parse a single SSE line from an Anthropic-format stream.
///
/// `current_event` carries the most recent `event:` value across calls so that
/// the `data:` handler can fall back to it when the JSON payload lacks a
/// top-level `"type"` field (common with third-party gateways / proxies).
fn parse_anthropic_sse_line(
    line: &str,
    current_event: &mut String,
    on_token: &Channel<String>,
    output: &mut String,
    usage: &mut UsageAccumulator,
) -> AppResult<bool> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    // ── event: line ──────────────────────────────────────────────────
    if let Some(event) = trimmed.strip_prefix("event:") {
        let event = event.trim();
        *current_event = event.to_string();
        if event == "message_stop" {
            return Ok(true);
        }
        return Ok(false);
    }

    // ── data: line ───────────────────────────────────────────────────
    let Some(payload) = trimmed.strip_prefix("data:") else {
        return Ok(false);
    };
    let payload = payload.trim();

    let value: Value = serde_json::from_str(payload)?;

    // Prefer `"type"` from the JSON payload; fall back to the preceding
    // `event:` line when the gateway strips it.
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(current_event.as_str());

    match event_type {
        "message_start" => {
            if let Some(pt) = value
                .get("message")
                .and_then(|m| m.get("usage"))
                .and_then(|u| u.get("input_tokens"))
                .and_then(Value::as_u64)
            {
                usage.prompt_tokens = pt as u32;
            }
        }
        "message_delta" => {
            if let Some(ct) = value
                .get("usage")
                .and_then(|u| u.get("output_tokens"))
                .and_then(Value::as_u64)
            {
                usage.completion_tokens = ct as u32;
            }
        }
        "content_block_delta" => {
            if let Some(token) = value
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(Value::as_str)
            {
                output.push_str(token);
                let _ = on_token.send(token.to_string());
            }
        }
        "message_stop" => return Ok(true),
        _ => {}
    }

    Ok(false)
}

/// Generate a short title for a conversation using the same provider/model.
pub async fn generate_title(
    db: &SqlitePool,
    session_id: &str,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> AppResult<String> {
    let provider = provider_service::get_provider_for_chat(db, provider_id).await?;
    let model = model_id.unwrap_or(&provider.model);
    let history = get_messages_raw(db, session_id).await?;

    if history.is_empty() {
        return Ok("New Chat".to_string());
    }

    // Build a compact summary of the conversation (max first 2 exchanges)
    let snippet: Vec<Value> = history
        .iter()
        .filter(|m| m.role != "system")
        .take(4)
        .map(|m| {
            let content = if m.content.len() > 200 {
                format!("{}…", &m.content[..200])
            } else {
                m.content.clone()
            };
            serde_json::json!({ "role": m.role, "content": content })
        })
        .collect();

    let mut messages = vec![serde_json::json!({
        "role": "system",
        "content": "Generate a short title (2-5 words) for this conversation. Reply with ONLY the title, nothing else. No quotes, no punctuation at the end. Examples: 'React Auth Setup', 'Greeting', 'Python Bug Fix', 'Database Migration Help'."
    })];
    messages.extend(snippet);
    messages.push(serde_json::json!({
        "role": "user",
        "content": "Generate a short title for the conversation above."
    }));

    let title = if provider.uses_anthropic_format() {
        generate_title_anthropic(&provider, model, &messages).await?
    } else {
        generate_title_openai(&provider, model, &messages).await?
    };

    // Clean up: remove quotes, trim, cap length
    let cleaned = title
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim_end_matches('.')
        .trim();

    let final_title = if cleaned.is_empty() {
        "New Chat".to_string()
    } else if cleaned.len() > 50 {
        let cut = &cleaned[..50];
        let last_space = cut.rfind(' ').unwrap_or(50);
        format!("{}…", &cleaned[..last_space])
    } else {
        cleaned.to_string()
    };

    Ok(final_title)
}

async fn generate_title_openai(
    provider: &crate::models::Provider,
    model: &str,
    messages: &[Value],
) -> AppResult<String> {
    let client = http_client::request_client()?;
    let endpoint = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );

    let payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 20,
        "stream": false,
    });

    let mut request = client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .json(&payload);

    if let Some(key) = provider.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        request = request.header(AUTHORIZATION, format!("Bearer {key}"));
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("{status}: {body}")));
    }

    let body: Value = response.json().await?;
    let title = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("New Chat")
        .to_string();

    Ok(title)
}

async fn generate_title_anthropic(
    provider: &crate::models::Provider,
    model: &str,
    messages: &[Value],
) -> AppResult<String> {
    // Extract system message and user/assistant messages
    let system = messages
        .first()
        .and_then(|m| m["content"].as_str())
        .unwrap_or("");

    let non_system: Vec<Value> = messages
        .iter()
        .filter(|m| m["role"].as_str() != Some("system"))
        .cloned()
        .collect();

    let payload = serde_json::json!({
        "model": model,
        "max_tokens": 20,
        "system": system,
        "messages": non_system,
        "temperature": 0.3,
    });

    // Resolve endpoint: same logic as send_anthropic
    let endpoint = if provider.provider_type == "anthropic" {
        "https://api.anthropic.com/v1/messages".to_string()
    } else if provider.provider_type == "enowxlabs" {
        format!("{}/messages", provider.base_url.trim_end_matches('/').trim_end_matches("/v1"))
    } else {
        format!("{}/messages", provider.base_url.trim_end_matches('/'))
    };

    let client = http_client::request_client()?;
    let mut request = client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header("anthropic-version", "2023-06-01")
        .json(&payload);

    // Auth: x-api-key for Anthropic direct, Bearer for gateways
    if let Some(key) = provider.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        if provider.provider_type == "anthropic" {
            request = request.header("x-api-key", key);
        } else {
            request = request.header(AUTHORIZATION, format!("Bearer {key}"));
        }
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("{status}: {body}")));
    }

    let body: Value = response.json().await?;
    let title = body["content"][0]["text"]
        .as_str()
        .unwrap_or("New Chat")
        .to_string();

    Ok(title)
}

const EXCALIDRAW_SYSTEM_PROMPT: &str = r##"You generate Excalidraw diagram elements as JSON. Output ONLY a valid JSON array of Excalidraw elements. No markdown, no explanation, no code fences.

Each element needs these fields:
- id: unique string (use short ids like "a1", "b2", etc)
- type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line"
- x, y: position (number, start from 100,100, space elements 200px apart)
- width, height: size (rectangles: 200x80, text: auto based on content)
- strokeColor: "#1e1e1e"
- backgroundColor: "transparent" or color like "#a5d8ff", "#b2f2bb", "#ffd8a8", "#ffc9c9", "#d0bfff"
- fillStyle: "solid" for colored fills, "hachure" for sketch style
- strokeWidth: 2
- roughness: 1 (sketchy) or 0 (clean)
- opacity: 100
- angle: 0
- seed: random integer (1000-9999)
- version: 1
- versionNonce: random integer
- isDeleted: false
- groupIds: []
- boundElements: null or [{"id": "textId", "type": "text"}] for shapes with text inside
- updated: 1700000000000
- link: null
- locked: false
- frameId: null
- index: null

For TEXT elements, also include:
- fontSize: 20 (or 16 for smaller)
- fontFamily: 1
- text: "the text content"
- textAlign: "center"
- verticalAlign: "middle"
- containerId: "parentShapeId" (if inside a shape) or null
- originalText: same as text
- autoResize: true
- lineHeight: 1.25

For ARROW/LINE elements, also include:
- points: [[0,0],[200,0]] (relative points from x,y)
- startBinding: {"elementId": "sourceId", "focus": 0, "gap": 5, "fixedPoint": null} or null
- endBinding: {"elementId": "targetId", "focus": 0, "gap": 5, "fixedPoint": null} or null
- startArrowhead: null
- endArrowhead: "arrow" (for arrows) or null (for lines)
- lastCommittedPoint: null
- elbowed: false

RULES:
- Text inside shapes: create shape with boundElements:[{"id":"tId","type":"text"}] AND text with containerId:"shapeId"
- Space elements 200px+ apart
- Use arrows with startBinding/endBinding to connect shapes
- Output ONLY the JSON array"##;

/// Generate Excalidraw elements from a text prompt using the LLM.
pub async fn generate_excalidraw(
    db: &SqlitePool,
    prompt: &str,
    existing_elements: Option<&str>,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> AppResult<String> {
    let provider = provider_service::get_provider_for_chat(db, provider_id).await?;
    let model = model_id.unwrap_or(&provider.model);

    let mut messages = vec![
        serde_json::json!({"role": "system", "content": EXCALIDRAW_SYSTEM_PROMPT}),
    ];

    // If there are existing elements, include them so AI can edit
    if let Some(elements) = existing_elements {
        messages.push(serde_json::json!({
            "role": "user",
            "content": format!("Here are the current canvas elements:\n{}\n\nIMPORTANT: When I ask you to modify something, return ALL elements (modified + unmodified). Keep all existing element IDs, positions, and properties unless I specifically ask to change them.", elements)
        }));
        messages.push(serde_json::json!({
            "role": "assistant",
            "content": "I understand. I'll return the complete set of elements, only modifying what you ask for while preserving everything else exactly as-is."
        }));
    }

    messages.push(serde_json::json!({"role": "user", "content": prompt}));

    let client = http_client::request_client()?;
    let endpoint = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));

    let payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 4000,
        "stream": false,
    });

    let mut request = client
        .post(&endpoint)
        .header(CONTENT_TYPE, "application/json")
        .json(&payload);

    if let Some(key) = provider.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        request = request.header(AUTHORIZATION, format!("Bearer {key}"));
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("{status}: {body}")));
    }

    let body: Value = response.json().await?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("[]")
        .to_string();

    // Strip markdown code fences if AI added them
    let cleaned = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    Ok(cleaned)
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod multimodal_tests {
    use super::*;
    use crate::models::Attachment;

    fn make_image_attachment() -> Attachment {
        Attachment {
            id: "att-img-1".to_string(),
            message_id: Some("msg-1".to_string()),
            file_name: "photo.png".to_string(),
            file_size: 1024,
            mime_type: "image/png".to_string(),
            file_path: "".to_string(),
            extracted_text: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_doc_attachment() -> Attachment {
        Attachment {
            id: "att-doc-1".to_string(),
            message_id: Some("msg-1".to_string()),
            file_name: "report.pdf".to_string(),
            file_size: 2048,
            mime_type: "application/pdf".to_string(),
            file_path: "".to_string(),
            extracted_text: Some("This is the extracted PDF content.".to_string()),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_build_openai_multimodal_text_only() {
        let content = build_openai_message_content("Hello", &[]);
        assert_eq!(content, serde_json::json!("Hello"));
    }

    #[test]
    fn test_build_openai_multimodal_with_document() {
        let doc = make_doc_attachment();
        let content = build_openai_message_content("Summarize this", &[doc]);
        // Should be plain text (no images), but with XML prepended
        let text = content.as_str().unwrap();
        assert!(text.contains("<files_info>"));
        assert!(text.contains("report.pdf"));
        assert!(text.contains("This is the extracted PDF content."));
        assert!(text.contains("Summarize this"));
    }

    #[test]
    fn test_build_openai_multimodal_image_produces_array() {
        // Image with empty path will fail compress_image, so content array has only text
        let img = make_image_attachment();
        let content = build_openai_message_content("Look at this", &[img]);
        // Even though compress fails, the function still returns an array format
        // because images were present (just no image_url parts added)
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "Look at this");
    }

    #[test]
    fn test_build_anthropic_multimodal_text_only() {
        let blocks = build_anthropic_message_content("Hello", &[]);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "Hello");
    }

    #[test]
    fn test_build_anthropic_multimodal_with_document() {
        let doc = make_doc_attachment();
        let blocks = build_anthropic_message_content("Summarize this", &[doc]);
        assert_eq!(blocks.len(), 1); // Just text block (no image)
        let text = blocks[0]["text"].as_str().unwrap();
        assert!(text.contains("<files_info>"));
        assert!(text.contains("report.pdf"));
        assert!(text.contains("This is the extracted PDF content."));
        assert!(text.contains("Summarize this"));
    }

    #[test]
    fn test_build_openai_multimodal_text_only_backward_compat() {
        // No attachments = plain string content (not array)
        let content = build_openai_message_content("Just text", &[]);
        assert!(content.is_string());
        assert_eq!(content.as_str().unwrap(), "Just text");
    }

    #[test]
    fn test_build_anthropic_multimodal_image_produces_blocks() {
        // Image with empty path will fail compress_image, so only text block
        let img = make_image_attachment();
        let blocks = build_anthropic_message_content("Describe this", &[img]);
        // Only text block since compress fails on empty path
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "Describe this");
    }

    #[test]
    fn test_build_openai_multimodal_mixed_doc_and_image() {
        let doc = make_doc_attachment();
        let img = make_image_attachment();
        let content = build_openai_message_content("Analyze", &[doc, img]);
        // Has images → returns array format
        let arr = content.as_array().unwrap();
        assert_eq!(arr[0]["type"], "text");
        let text = arr[0]["text"].as_str().unwrap();
        assert!(text.contains("<files_info>"));
        assert!(text.contains("report.pdf"));
        assert!(text.contains("Analyze"));
    }
}
