//! Real MCP server integration test.
//! Tests against @modelcontextprotocol/server-everything (no credentials needed).
//! Run with: cargo test --test mcp_real -- --ignored --nocapture

use std::time::Duration;

use enowx_coder_lib::mcp::service::McpService;
use enowx_coder_lib::mcp::types::{McpContent, McpServerConfig};
use enowx_coder_lib::tools::registry::{ToolRegistry, ToolSource};
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tokio::time::timeout;

const TEST_TIMEOUT: Duration = Duration::from_secs(30);

async fn create_test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("failed to create in-memory pool");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            transport_type TEXT NOT NULL,
            command TEXT,
            args TEXT,
            env_vars TEXT,
            url TEXT,
            headers TEXT,
            auth_type TEXT NOT NULL DEFAULT 'none',
            auth_token TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'disconnected',
            tools_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .expect("failed to create table");

    pool
}

#[tokio::test]
#[ignore] // Requires npx + network access. Run with: cargo test --test mcp_real -- --ignored --nocapture
async fn test_real_mcp_server_everything() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;

        let config = McpServerConfig {
            id: "everything".to_string(),
            name: "Everything".to_string(),
            transport_type: "stdio".to_string(),
            command: Some("npx.cmd".to_string()),
            args: Some(r#"["-y", "@modelcontextprotocol/server-everything"]"#.to_string()),
            env_vars: None,
            url: None,
            headers: None,
            auth_type: "none".to_string(),
            auth_token: None,
            enabled: true,
            status: "disconnected".to_string(),
            tools_count: 0,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let service = McpService::new();

        // 1. Connect to real MCP server
        println!("1. Connecting to @modelcontextprotocol/server-everything...");
        service.connect(&config).await.expect("connect should succeed");
        println!("   ✓ Connected!");

        // 2. List tools
        println!("2. Listing tools...");
        let tools = service.list_tools("everything").await.expect("list_tools should succeed");
        println!("   ✓ Found {} tools:", tools.len());
        for t in &tools {
            println!("     - {}: {}", t.name, t.description);
        }
        assert!(!tools.is_empty(), "should have tools");
        assert!(tools.iter().any(|t| t.name == "echo"), "should have echo tool");

        // 3. Register in ToolRegistry and verify resolution
        println!("3. Registering in ToolRegistry...");
        let mut registry = ToolRegistry::new();
        let mcp_tools: Vec<(String, String, _)> = tools
            .iter()
            .map(|t| ("everything".to_string(), "Everything".to_string(), t.clone()))
            .collect();
        registry.set_mcp_tools(mcp_tools);
        assert!(registry.has_mcp_tools());

        // Verify tool resolution
        match registry.resolve_tool_call("everything__echo") {
            ToolSource::Mcp { server_id, tool_name } => {
                assert_eq!(server_id, "everything");
                assert_eq!(tool_name, "echo");
                println!("   ✓ Resolved everything__echo → server_id={}, tool_name={}", server_id, tool_name);
            }
            _ => panic!("should resolve as MCP tool"),
        }

        // 4. Call echo tool
        println!("4. Calling echo tool...");
        let result = service
            .call_tool("everything", "echo", json!({"message": "Hello from enowX-Coder!"}), &pool)
            .await
            .expect("call_tool should succeed");
        println!("   ✓ Result: {:?}", result.content);
        assert!(!result.is_error, "should not be an error");
        match &result.content[0] {
            McpContent::Text { text } => {
                assert!(text.contains("Hello from enowX-Coder!"), "echo should return our message, got: {}", text);
                println!("   ✓ Echo returned: {}", text);
            }
            _ => panic!("expected text content"),
        }

        // 5. Verify OpenAI format tool definitions
        println!("5. Verifying OpenAI format tool definitions...");
        let openai_tools = registry.get_all_tools_openai(vec![]);
        assert!(!openai_tools.is_empty(), "should have OpenAI tool defs");
        let echo_def = openai_tools.iter().find(|t| {
            t.get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                == Some("everything__echo")
        });
        assert!(echo_def.is_some(), "should have everything__echo in OpenAI format");
        println!("   ✓ OpenAI format has {} tool definitions", openai_tools.len());

        // 6. Disconnect
        println!("6. Disconnecting...");
        service.disconnect("everything").await.expect("disconnect should succeed");
        println!("   ✓ Disconnected!");

        println!("\n🎉 REAL MCP SERVER TEST PASSED — Full pipeline verified!");
    })
    .await;

    result.expect("test timed out after 30s");
}
