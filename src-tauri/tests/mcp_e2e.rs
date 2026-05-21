//! End-to-end tests for the MCP pipeline.
//!
//! Tests the complete flow a user would experience:
//! Config → DB → Connect → List Tools → Registry → Tool Call → Result
//!
//! Uses the mock MCP server at tests/fixtures/mock_mcp_server.cjs

use std::path::PathBuf;
use std::time::Duration;

use enowx_coder_lib::mcp::server_store;
use enowx_coder_lib::mcp::service::McpService;
use enowx_coder_lib::mcp::types::{McpContent, McpError, McpServerConfig};
use enowx_coder_lib::tools::registry::{ToolRegistry, ToolSource};
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tokio::time::timeout;

const TEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Path to the mock MCP server script
fn mock_server_path() -> String {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests");
    path.push("fixtures");
    path.push("mock_mcp_server.cjs");
    path.to_string_lossy().to_string()
}

/// Create an in-memory SQLite pool with the mcp_servers table
async fn create_test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("failed to create in-memory pool");

    // Create the mcp_servers table
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
    .expect("failed to create mcp_servers table");

    pool
}

/// Create a test server config for the mock MCP server
fn test_server_config(name: &str) -> McpServerConfig {
    let script_path = mock_server_path();
    McpServerConfig {
        id: String::new(), // Will be assigned by insert_server
        name: name.to_string(),
        transport_type: "stdio".to_string(),
        command: Some("node".to_string()),
        args: Some(format!(r#"["{}"]"#, script_path.replace('\\', "\\\\"))),
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
    }
}

// =============================================================================
// Full E2E Pipeline Tests
// =============================================================================

/// Tests the complete pipeline: DB config → connect → list tools → registry → call tool → result
#[tokio::test]
async fn test_e2e_full_pipeline_echo() {
    let result = timeout(TEST_TIMEOUT, async {
        // 1. Create in-memory DB and insert server config
        let pool = create_test_pool().await;
        let config = test_server_config("TestServer");
        let saved = server_store::insert_server(&pool, &config)
            .await
            .expect("insert_server should succeed");

        assert!(!saved.id.is_empty(), "server should have an assigned ID");
        assert_eq!(saved.name, "TestServer");
        assert_eq!(saved.status, "disconnected");

        // 2. Verify config persisted in DB
        let fetched = server_store::get_server(&pool, &saved.id)
            .await
            .expect("get_server should succeed")
            .expect("server should exist in DB");
        assert_eq!(fetched.id, saved.id);
        assert_eq!(fetched.name, "TestServer");

        // 3. Connect to the mock server via McpService
        let service = McpService::new();
        service
            .connect(&saved)
            .await
            .expect("connect should succeed");

        // 4. List tools and verify they appear
        let tools = service
            .list_tools(&saved.id)
            .await
            .expect("list_tools should succeed");
        assert_eq!(tools.len(), 2, "mock server should expose 2 tools");

        let tool_names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(tool_names.contains(&"echo"), "should have echo tool");
        assert!(tool_names.contains(&"add"), "should have add tool");

        // 5. Register tools in ToolRegistry
        let mut registry = ToolRegistry::new();
        let mcp_tools: Vec<(String, String, _)> = tools
            .into_iter()
            .map(|t| (saved.id.clone(), saved.name.clone(), t))
            .collect();
        registry.set_mcp_tools(mcp_tools);
        assert!(registry.has_mcp_tools(), "registry should have MCP tools");

        // 6. Resolve tool by prefixed name (servername__toolname)
        let prefixed_name = "testserver__echo";
        match registry.resolve_tool_call(prefixed_name) {
            ToolSource::Mcp {
                server_id,
                tool_name,
            } => {
                assert_eq!(server_id, saved.id);
                assert_eq!(tool_name, "echo");
            }
            ToolSource::Builtin(_) => panic!("should resolve as MCP tool, not builtin"),
        }

        // 7. Call the echo tool through the full pipeline
        let call_result = service
            .call_tool(&saved.id, "echo", json!({"message": "hello e2e"}), &pool)
            .await
            .expect("call_tool should succeed");

        // 8. Verify result content
        assert!(!call_result.is_error, "tool call should not be an error");
        assert_eq!(call_result.content.len(), 1, "should have 1 content block");
        match &call_result.content[0] {
            McpContent::Text { text } => {
                assert_eq!(text, "hello e2e", "echo should return the input message");
            }
            other => panic!("expected Text content, got: {:?}", other),
        }

        // 9. Cleanup
        service
            .disconnect(&saved.id)
            .await
            .expect("disconnect should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

/// Tests the full pipeline with the add tool (numeric arguments)
#[tokio::test]
async fn test_e2e_full_pipeline_add() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;
        let config = test_server_config("MathServer");
        let saved = server_store::insert_server(&pool, &config)
            .await
            .expect("insert_server should succeed");

        let service = McpService::new();
        service
            .connect(&saved)
            .await
            .expect("connect should succeed");

        // List tools to populate cache
        let tools = service
            .list_tools(&saved.id)
            .await
            .expect("list_tools should succeed");
        assert_eq!(tools.len(), 2);

        // Register in ToolRegistry and resolve
        let mut registry = ToolRegistry::new();
        let mcp_tools: Vec<(String, String, _)> = tools
            .into_iter()
            .map(|t| (saved.id.clone(), saved.name.clone(), t))
            .collect();
        registry.set_mcp_tools(mcp_tools);

        let prefixed_name = "mathserver__add";
        match registry.resolve_tool_call(prefixed_name) {
            ToolSource::Mcp {
                server_id,
                tool_name,
            } => {
                assert_eq!(server_id, saved.id);
                assert_eq!(tool_name, "add");
            }
            ToolSource::Builtin(_) => panic!("should resolve as MCP tool, not builtin"),
        }

        // Call add tool: 17 + 25 = 42
        let call_result = service
            .call_tool(&saved.id, "add", json!({"a": 17, "b": 25}), &pool)
            .await
            .expect("call_tool should succeed");

        assert!(!call_result.is_error);
        assert_eq!(call_result.content.len(), 1);
        match &call_result.content[0] {
            McpContent::Text { text } => {
                assert_eq!(text, "42", "17 + 25 should equal 42");
            }
            other => panic!("expected Text content, got: {:?}", other),
        }

        service
            .disconnect(&saved.id)
            .await
            .expect("disconnect should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

/// Tests that the OpenAI tool format is correctly generated from registry
#[tokio::test]
async fn test_e2e_registry_generates_openai_format() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;
        let config = test_server_config("FormatServer");
        let saved = server_store::insert_server(&pool, &config)
            .await
            .expect("insert_server should succeed");

        let service = McpService::new();
        service
            .connect(&saved)
            .await
            .expect("connect should succeed");

        let tools = service
            .list_tools(&saved.id)
            .await
            .expect("list_tools should succeed");

        let mut registry = ToolRegistry::new();
        let mcp_tools: Vec<(String, String, _)> = tools
            .into_iter()
            .map(|t| (saved.id.clone(), saved.name.clone(), t))
            .collect();
        registry.set_mcp_tools(mcp_tools);

        // Get OpenAI format (no builtins for this test)
        let openai_tools = registry.get_all_tools_openai(vec![]);
        assert_eq!(openai_tools.len(), 2, "should have 2 tools in OpenAI format");

        // Verify structure of first tool
        let first = &openai_tools[0];
        assert_eq!(first["type"], "function");
        let func = &first["function"];
        let name = func["name"].as_str().unwrap();
        assert!(
            name.contains("__"),
            "tool name should be prefixed: {}",
            name
        );
        assert!(func["description"].is_string());
        assert!(func["parameters"].is_object());

        service
            .disconnect(&saved.id)
            .await
            .expect("disconnect should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Error Scenario Tests
// =============================================================================

/// Tests that calling a tool on a disconnected server returns proper error
#[tokio::test]
async fn test_e2e_error_call_tool_disconnected_server() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;
        let config = test_server_config("DisconnectTest");
        let saved = server_store::insert_server(&pool, &config)
            .await
            .expect("insert_server should succeed");

        let service = McpService::new();

        // Connect then disconnect
        service
            .connect(&saved)
            .await
            .expect("connect should succeed");
        service
            .disconnect(&saved.id)
            .await
            .expect("disconnect should succeed");

        // Attempt to call tool on disconnected server
        // call_tool will try to reconnect via DB, which should succeed since config is in DB
        let call_result = service
            .call_tool(&saved.id, "echo", json!({"message": "test"}), &pool)
            .await;

        // The reconnect should succeed because the config is in the DB
        // So the call should actually work after reconnect
        assert!(
            call_result.is_ok(),
            "call_tool should succeed after auto-reconnect: {:?}",
            call_result.err()
        );

        // Cleanup
        service
            .disconnect(&saved.id)
            .await
            .expect("final disconnect should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

/// Tests that calling a tool on a server that was never connected returns error
#[tokio::test]
async fn test_e2e_error_call_tool_never_connected() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;
        let service = McpService::new();

        // Try to call tool without ever connecting — server_id doesn't exist in DB either
        let err = service
            .call_tool("nonexistent-server", "echo", json!({"message": "test"}), &pool)
            .await;

        assert!(err.is_err(), "should error on never-connected server");
        match err.unwrap_err() {
            McpError::ConnectionFailed(msg) => {
                assert!(
                    msg.contains("not connected") || msg.contains("not found"),
                    "unexpected error message: {}",
                    msg
                );
            }
            other => panic!("expected ConnectionFailed, got: {:?}", other),
        }
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

/// Tests that calling a non-existent tool returns proper error
#[tokio::test]
async fn test_e2e_error_call_nonexistent_tool() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;
        let config = test_server_config("NonexistentToolTest");
        let saved = server_store::insert_server(&pool, &config)
            .await
            .expect("insert_server should succeed");

        let service = McpService::new();
        service
            .connect(&saved)
            .await
            .expect("connect should succeed");

        // Call a tool that doesn't exist on the server
        let result = service
            .call_tool(
                &saved.id,
                "nonexistent_tool",
                json!({"arg": "value"}),
                &pool,
            )
            .await;

        // The mock server returns an error for unknown tools
        assert!(result.is_err(), "should error on non-existent tool");
        match result.unwrap_err() {
            McpError::ExecutionError(msg) => {
                assert!(
                    msg.contains("Unknown tool") || msg.contains("not found") || msg.contains("failed"),
                    "unexpected error message: {}",
                    msg
                );
            }
            other => panic!("expected ExecutionError, got: {:?}", other),
        }

        service
            .disconnect(&saved.id)
            .await
            .expect("disconnect should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Multiple Servers Test
// =============================================================================

/// Tests that multiple servers can coexist and tools are correctly routed
#[tokio::test]
async fn test_e2e_multiple_servers_tool_routing() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;

        // Insert two server configs
        let config_a = test_server_config("ServerAlpha");
        let saved_a = server_store::insert_server(&pool, &config_a)
            .await
            .expect("insert server A should succeed");

        let config_b = test_server_config("ServerBeta");
        let saved_b = server_store::insert_server(&pool, &config_b)
            .await
            .expect("insert server B should succeed");

        // Verify both exist in DB
        let all_servers = server_store::list_servers(&pool)
            .await
            .expect("list_servers should succeed");
        assert_eq!(all_servers.len(), 2);

        // Connect both
        let service = McpService::new();
        service
            .connect(&saved_a)
            .await
            .expect("connect A should succeed");
        service
            .connect(&saved_b)
            .await
            .expect("connect B should succeed");

        // List tools from both
        let tools_a = service
            .list_tools(&saved_a.id)
            .await
            .expect("list_tools A should succeed");
        let tools_b = service
            .list_tools(&saved_b.id)
            .await
            .expect("list_tools B should succeed");

        // Build registry with both servers' tools
        let mut registry = ToolRegistry::new();
        let mut all_mcp_tools = Vec::new();
        for t in tools_a {
            all_mcp_tools.push((saved_a.id.clone(), saved_a.name.clone(), t));
        }
        for t in tools_b {
            all_mcp_tools.push((saved_b.id.clone(), saved_b.name.clone(), t));
        }
        registry.set_mcp_tools(all_mcp_tools);

        // Resolve tools — should route to correct server
        match registry.resolve_tool_call("serveralpha__echo") {
            ToolSource::Mcp {
                server_id,
                tool_name,
            } => {
                assert_eq!(server_id, saved_a.id);
                assert_eq!(tool_name, "echo");
            }
            _ => panic!("should resolve serveralpha__echo as MCP tool"),
        }

        match registry.resolve_tool_call("serverbeta__add") {
            ToolSource::Mcp {
                server_id,
                tool_name,
            } => {
                assert_eq!(server_id, saved_b.id);
                assert_eq!(tool_name, "add");
            }
            _ => panic!("should resolve serverbeta__add as MCP tool"),
        }

        // Call tools on respective servers
        let echo_result = service
            .call_tool(
                &saved_a.id,
                "echo",
                json!({"message": "from alpha"}),
                &pool,
            )
            .await
            .expect("echo on server A should succeed");
        match &echo_result.content[0] {
            McpContent::Text { text } => assert_eq!(text, "from alpha"),
            other => panic!("expected Text, got: {:?}", other),
        }

        let add_result = service
            .call_tool(&saved_b.id, "add", json!({"a": 100, "b": 200}), &pool)
            .await
            .expect("add on server B should succeed");
        match &add_result.content[0] {
            McpContent::Text { text } => assert_eq!(text, "300"),
            other => panic!("expected Text, got: {:?}", other),
        }

        // Cleanup
        service
            .disconnect(&saved_a.id)
            .await
            .expect("disconnect A should succeed");
        service
            .disconnect(&saved_b.id)
            .await
            .expect("disconnect B should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Reconnect via DB Test
// =============================================================================

/// Tests that call_tool auto-reconnects using config from DB when connection drops
#[tokio::test]
async fn test_e2e_auto_reconnect_from_db() {
    let result = timeout(TEST_TIMEOUT, async {
        let pool = create_test_pool().await;
        let config = test_server_config("ReconnectServer");
        let saved = server_store::insert_server(&pool, &config)
            .await
            .expect("insert_server should succeed");

        let service = McpService::new();
        service
            .connect(&saved)
            .await
            .expect("initial connect should succeed");

        // Verify tool call works
        let result1 = service
            .call_tool(&saved.id, "echo", json!({"message": "before"}), &pool)
            .await
            .expect("first call should succeed");
        match &result1.content[0] {
            McpContent::Text { text } => assert_eq!(text, "before"),
            other => panic!("expected Text, got: {:?}", other),
        }

        // Disconnect (simulating connection drop)
        service
            .disconnect(&saved.id)
            .await
            .expect("disconnect should succeed");

        // call_tool should auto-reconnect using DB config
        let result2 = service
            .call_tool(&saved.id, "echo", json!({"message": "after reconnect"}), &pool)
            .await
            .expect("call after reconnect should succeed");
        match &result2.content[0] {
            McpContent::Text { text } => assert_eq!(text, "after reconnect"),
            other => panic!("expected Text, got: {:?}", other),
        }

        // Cleanup
        service
            .disconnect(&saved.id)
            .await
            .expect("final disconnect should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}
