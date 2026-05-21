use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::AppResult;
use crate::services::now_rfc3339;

use super::types::McpServerConfig;

const SELECT_COLS: &str =
    "id, name, transport_type, command, args, env_vars, url, headers, auth_type, auth_token, enabled, status, tools_count, created_at, updated_at";

pub async fn list_servers(pool: &SqlitePool) -> AppResult<Vec<McpServerConfig>> {
    let servers = sqlx::query_as::<_, McpServerConfig>(&format!(
        "SELECT {SELECT_COLS} FROM mcp_servers ORDER BY created_at DESC"
    ))
    .fetch_all(pool)
    .await?;

    Ok(servers)
}

pub async fn get_server(pool: &SqlitePool, id: &str) -> AppResult<Option<McpServerConfig>> {
    let server = sqlx::query_as::<_, McpServerConfig>(&format!(
        "SELECT {SELECT_COLS} FROM mcp_servers WHERE id = ?"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(server)
}

pub async fn insert_server(pool: &SqlitePool, config: &McpServerConfig) -> AppResult<McpServerConfig> {
    let now = now_rfc3339();
    let id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO mcp_servers (id, name, transport_type, command, args, env_vars, url, headers, auth_type, auth_token, enabled, status, tools_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&config.name)
    .bind(&config.transport_type)
    .bind(&config.command)
    .bind(&config.args)
    .bind(&config.env_vars)
    .bind(&config.url)
    .bind(&config.headers)
    .bind(&config.auth_type)
    .bind(&config.auth_token)
    .bind(config.enabled)
    .bind("disconnected")
    .bind(0)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(McpServerConfig {
        id,
        name: config.name.clone(),
        transport_type: config.transport_type.clone(),
        command: config.command.clone(),
        args: config.args.clone(),
        env_vars: config.env_vars.clone(),
        url: config.url.clone(),
        headers: config.headers.clone(),
        auth_type: config.auth_type.clone(),
        auth_token: config.auth_token.clone(),
        enabled: config.enabled,
        status: "disconnected".to_string(),
        tools_count: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub async fn update_server(pool: &SqlitePool, config: &McpServerConfig) -> AppResult<()> {
    let now = now_rfc3339();

    sqlx::query(
        "UPDATE mcp_servers SET name = ?, transport_type = ?, command = ?, args = ?, env_vars = ?, url = ?, headers = ?, auth_type = ?, auth_token = ?, enabled = ?, updated_at = ? WHERE id = ?"
    )
    .bind(&config.name)
    .bind(&config.transport_type)
    .bind(&config.command)
    .bind(&config.args)
    .bind(&config.env_vars)
    .bind(&config.url)
    .bind(&config.headers)
    .bind(&config.auth_type)
    .bind(&config.auth_token)
    .bind(config.enabled)
    .bind(&now)
    .bind(&config.id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn delete_server(pool: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM mcp_servers WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn toggle_server(pool: &SqlitePool, id: &str, enabled: bool) -> AppResult<()> {
    let now = now_rfc3339();

    sqlx::query("UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?")
        .bind(enabled)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn sample_config() -> McpServerConfig {
        McpServerConfig {
            id: String::new(), // will be overwritten by insert
            name: "Test Server".to_string(),
            transport_type: "stdio".to_string(),
            command: Some("node".to_string()),
            args: Some(r#"["index.js"]"#.to_string()),
            env_vars: None,
            url: None,
            headers: None,
            auth_type: "none".to_string(),
            auth_token: None,
            enabled: true,
            status: "disconnected".to_string(),
            tools_count: 0,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[tokio::test]
    async fn test_insert_server_creates_record_with_uuid() {
        let pool = test_pool().await;
        let config = sample_config();

        let result = insert_server(&pool, &config).await.unwrap();
        assert!(!result.id.is_empty());
        // UUID v4 format: 8-4-4-4-12
        assert_eq!(result.id.len(), 36);
        assert_eq!(result.name, "Test Server");
        assert_eq!(result.status, "disconnected");
        assert_eq!(result.tools_count, 0);
    }

    #[tokio::test]
    async fn test_list_servers_returns_inserted_records() {
        let pool = test_pool().await;

        // Insert two servers
        let mut config1 = sample_config();
        config1.name = "Server A".to_string();
        let mut config2 = sample_config();
        config2.name = "Server B".to_string();

        insert_server(&pool, &config1).await.unwrap();
        insert_server(&pool, &config2).await.unwrap();

        let servers = list_servers(&pool).await.unwrap();
        assert_eq!(servers.len(), 2);
        // Ordered by created_at DESC, so most recent first
        let names: Vec<&str> = servers.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"Server A"));
        assert!(names.contains(&"Server B"));
    }

    #[tokio::test]
    async fn test_get_server_by_id() {
        let pool = test_pool().await;
        let config = sample_config();

        let inserted = insert_server(&pool, &config).await.unwrap();
        let fetched = get_server(&pool, &inserted.id).await.unwrap();

        assert!(fetched.is_some());
        let fetched = fetched.unwrap();
        assert_eq!(fetched.id, inserted.id);
        assert_eq!(fetched.name, "Test Server");
    }

    #[tokio::test]
    async fn test_get_server_nonexistent_returns_none() {
        let pool = test_pool().await;
        let fetched = get_server(&pool, "nonexistent-id").await.unwrap();
        assert!(fetched.is_none());
    }

    #[tokio::test]
    async fn test_update_server_changes_fields() {
        let pool = test_pool().await;
        let config = sample_config();

        let mut inserted = insert_server(&pool, &config).await.unwrap();
        inserted.name = "Updated Name".to_string();
        inserted.transport_type = "http".to_string();
        inserted.url = Some("http://localhost:3000".to_string());
        inserted.command = None;

        update_server(&pool, &inserted).await.unwrap();

        let fetched = get_server(&pool, &inserted.id).await.unwrap().unwrap();
        assert_eq!(fetched.name, "Updated Name");
        assert_eq!(fetched.transport_type, "http");
        assert_eq!(fetched.url, Some("http://localhost:3000".to_string()));
        assert_eq!(fetched.command, None);
    }

    #[tokio::test]
    async fn test_delete_server_removes_record() {
        let pool = test_pool().await;
        let config = sample_config();

        let inserted = insert_server(&pool, &config).await.unwrap();
        delete_server(&pool, &inserted.id).await.unwrap();

        let fetched = get_server(&pool, &inserted.id).await.unwrap();
        assert!(fetched.is_none());
    }

    #[tokio::test]
    async fn test_toggle_server_changes_enabled_field() {
        let pool = test_pool().await;
        let config = sample_config();

        let inserted = insert_server(&pool, &config).await.unwrap();
        assert!(inserted.enabled);

        // Disable
        toggle_server(&pool, &inserted.id, false).await.unwrap();
        let fetched = get_server(&pool, &inserted.id).await.unwrap().unwrap();
        assert!(!fetched.enabled);

        // Re-enable
        toggle_server(&pool, &inserted.id, true).await.unwrap();
        let fetched = get_server(&pool, &inserted.id).await.unwrap().unwrap();
        assert!(fetched.enabled);
    }
}
