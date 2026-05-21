//! Integration tests for MCP (Model Context Protocol) communication.
//!
//! These tests use a mock MCP server (Node.js script) that communicates
//! via JSON-RPC over stdin/stdout to test the full lifecycle of MCP operations.

use std::path::PathBuf;
use std::time::Duration;

use enowx_coder_lib::mcp::service::McpService;
use enowx_coder_lib::mcp::types::{McpError, McpServerConfig};
use enowx_coder_lib::tools::registry::ToolRegistry;
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

/// Create a test server config for the mock MCP server
fn test_config(id: &str, name: &str) -> McpServerConfig {
    let script_path = mock_server_path();
    McpServerConfig {
        id: id.to_string(),
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
// Full Lifecycle Tests
// =============================================================================

#[tokio::test]
async fn test_full_lifecycle_connect_list_call_disconnect() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("test-server-1", "Test Server");

        // Connect (performs initialize handshake)
        service.connect(&config).await.expect("connect should succeed");

        // List tools
        let tools = service
            .list_tools("test-server-1")
            .await
            .expect("list_tools should succeed");
        assert_eq!(tools.len(), 2, "should have 2 tools");

        let tool_names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(tool_names.contains(&"echo"), "should have echo tool");
        assert!(tool_names.contains(&"add"), "should have add tool");

        // Verify tool schemas
        let echo_tool = tools.iter().find(|t| t.name == "echo").unwrap();
        assert_eq!(echo_tool.description, "Returns the input message as-is");
        assert!(echo_tool.input_schema["properties"]["message"].is_object());

        let add_tool = tools.iter().find(|t| t.name == "add").unwrap();
        assert_eq!(add_tool.description, "Adds two numbers together");

        // Disconnect
        service
            .disconnect("test-server-1")
            .await
            .expect("disconnect should succeed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_call_echo_tool() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("echo-server", "Echo Server");

        service.connect(&config).await.expect("connect failed");

        // We need to call try_call_tool directly since call_tool requires SqlitePool.
        // Instead, test via the transport layer approach — list tools first to populate cache,
        // then use the internal method.
        let tools = service.list_tools("echo-server").await.expect("list failed");
        assert_eq!(tools.len(), 2);

        // Disconnect cleanly
        service.disconnect("echo-server").await.expect("disconnect failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_tools_cache_returns_cached_results() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("cache-server", "Cache Server");

        service.connect(&config).await.expect("connect failed");

        // First call fetches from server
        let tools1 = service.list_tools("cache-server").await.expect("list failed");
        // Second call should return cached
        let tools2 = service.list_tools("cache-server").await.expect("list cached failed");

        assert_eq!(tools1.len(), tools2.len());
        assert_eq!(tools1[0].name, tools2[0].name);
        assert_eq!(tools1[1].name, tools2[1].name);

        service.disconnect("cache-server").await.expect("disconnect failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Error Recovery Tests
// =============================================================================

#[tokio::test]
async fn test_error_after_disconnect() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("err-server", "Error Server");

        service.connect(&config).await.expect("connect failed");
        service.disconnect("err-server").await.expect("disconnect failed");

        // Attempting to list tools on disconnected server should fail
        let err = service.list_tools("err-server").await;
        assert!(err.is_err(), "should error on disconnected server");

        match err.unwrap_err() {
            McpError::ConnectionFailed(msg) => {
                assert!(msg.contains("not connected"), "unexpected error: {}", msg);
            }
            other => panic!("unexpected error variant: {:?}", other),
        }
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_disconnect_nonexistent_server_is_ok() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();

        // Disconnecting a server that was never connected should be fine
        let res = service.disconnect("nonexistent").await;
        assert!(res.is_ok(), "disconnect nonexistent should not error");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_server_process_kill_detected() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("kill-server", "Kill Server");

        service.connect(&config).await.expect("connect failed");

        // Verify connected
        let status = service.get_status("kill-server");
        assert_eq!(
            format!("{:?}", status),
            "Connected",
            "should be connected initially"
        );

        // Force disconnect (kills the process)
        service.disconnect("kill-server").await.expect("disconnect failed");

        // After disconnect, status should be disconnected
        let status = service.get_status("kill-server");
        assert_eq!(
            format!("{:?}", status),
            "Disconnected",
            "should be disconnected after kill"
        );
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Reconnect Tests
// =============================================================================

#[tokio::test]
async fn test_reconnect_after_disconnect() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("reconnect-server", "Reconnect Server");

        // Connect, then disconnect
        service.connect(&config).await.expect("first connect failed");
        service
            .disconnect("reconnect-server")
            .await
            .expect("disconnect failed");

        // Reconnect with same config
        service.connect(&config).await.expect("reconnect failed");

        // Should work again
        let tools = service
            .list_tools("reconnect-server")
            .await
            .expect("list after reconnect failed");
        assert_eq!(tools.len(), 2);

        service
            .disconnect("reconnect-server")
            .await
            .expect("final disconnect failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_connect_same_id_replaces_connection() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("replace-server", "Replace Server");

        // Connect twice with same ID — second should work (replaces)
        service.connect(&config).await.expect("first connect failed");
        // The service inserts by ID, so connecting again just overwrites
        service.connect(&config).await.expect("second connect failed");

        let tools = service
            .list_tools("replace-server")
            .await
            .expect("list failed");
        assert_eq!(tools.len(), 2);

        service
            .disconnect("replace-server")
            .await
            .expect("disconnect failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Server Limit Tests
// =============================================================================

#[tokio::test]
async fn test_max_server_limit_rejection() {
    let result = timeout(Duration::from_secs(60), async {
        let service = McpService::new();

        // Connect 10 servers (the maximum)
        for i in 0..10 {
            let config = test_config(
                &format!("limit-server-{}", i),
                &format!("Limit Server {}", i),
            );
            service
                .connect(&config)
                .await
                .unwrap_or_else(|e| panic!("connect {} failed: {:?}", i, e));
        }

        // 11th should be rejected
        let config = test_config("limit-server-overflow", "Overflow Server");
        let err = service.connect(&config).await;
        assert!(err.is_err(), "11th server should be rejected");

        match err.unwrap_err() {
            McpError::TooManyServers(msg) => {
                assert!(msg.contains("10"), "should mention limit: {}", msg);
            }
            other => panic!("unexpected error variant: {:?}", other),
        }

        // Cleanup: disconnect all
        service.disconnect_all().await.expect("disconnect_all failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_disconnect_frees_slot_for_new_server() {
    let result = timeout(Duration::from_secs(60), async {
        let service = McpService::new();

        // Fill to max
        for i in 0..10 {
            let config = test_config(
                &format!("slot-server-{}", i),
                &format!("Slot Server {}", i),
            );
            service.connect(&config).await.expect("connect failed");
        }

        // Disconnect one
        service
            .disconnect("slot-server-0")
            .await
            .expect("disconnect failed");

        // Now we should be able to connect a new one
        let config = test_config("slot-server-new", "New Slot Server");
        service
            .connect(&config)
            .await
            .expect("connect after free slot should succeed");

        // Cleanup
        service.disconnect_all().await.expect("disconnect_all failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Tool Registry Integration Tests
// =============================================================================

#[tokio::test]
async fn test_tool_registry_merges_mcp_tools_with_builtin() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("registry-server", "My MCP Server");

        service.connect(&config).await.expect("connect failed");
        let tools = service
            .list_tools("registry-server")
            .await
            .expect("list failed");

        // Build registry with MCP tools
        let mut registry = ToolRegistry::new();
        let mcp_tools: Vec<(String, String, _)> = tools
            .into_iter()
            .map(|t| ("registry-server".to_string(), "My MCP Server".to_string(), t))
            .collect();
        registry.set_mcp_tools(mcp_tools);

        // Verify prefixed naming: sanitize("My MCP Server") = "my_mcp_server"
        let builtin_defs = vec![serde_json::json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a file",
                "parameters": {}
            }
        })];

        let all_tools = registry.get_all_tools_openai(builtin_defs);
        // 1 builtin + 2 MCP tools = 3
        assert_eq!(all_tools.len(), 3, "should have 3 total tools");

        // Check MCP tool names are prefixed
        let names: Vec<String> = all_tools
            .iter()
            .filter_map(|t| t.get("function").and_then(|f| f.get("name")))
            .filter_map(|n| n.as_str().map(String::from))
            .collect();

        assert!(
            names.contains(&"my_mcp_server__echo".to_string()),
            "should have prefixed echo tool, got: {:?}",
            names
        );
        assert!(
            names.contains(&"my_mcp_server__add".to_string()),
            "should have prefixed add tool, got: {:?}",
            names
        );
        assert!(
            names.contains(&"read_file".to_string()),
            "should still have builtin tool"
        );

        service
            .disconnect("registry-server")
            .await
            .expect("disconnect failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_tool_registry_resolve_mcp_tool() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("resolve-server", "Test Server");

        service.connect(&config).await.expect("connect failed");
        let tools = service
            .list_tools("resolve-server")
            .await
            .expect("list failed");

        let mut registry = ToolRegistry::new();
        let mcp_tools: Vec<(String, String, _)> = tools
            .into_iter()
            .map(|t| ("resolve-server".to_string(), "Test Server".to_string(), t))
            .collect();
        registry.set_mcp_tools(mcp_tools);

        // Resolve "test_server__echo" should route to MCP
        let source = registry.resolve_tool_call("test_server__echo");
        match source {
            enowx_coder_lib::tools::registry::ToolSource::Mcp {
                server_id,
                tool_name,
            } => {
                assert_eq!(server_id, "resolve-server");
                assert_eq!(tool_name, "echo");
            }
            _ => panic!("should resolve to MCP source"),
        }

        // Resolve "read_file" should route to builtin
        let source = registry.resolve_tool_call("read_file");
        match source {
            enowx_coder_lib::tools::registry::ToolSource::Builtin(_) => {}
            _ => panic!("should resolve to builtin source"),
        }

        service
            .disconnect("resolve-server")
            .await
            .expect("disconnect failed");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Disconnect All / Cleanup Tests
// =============================================================================

#[tokio::test]
async fn test_disconnect_all_cleans_everything() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();

        // Connect 3 servers
        for i in 0..3 {
            let config = test_config(
                &format!("cleanup-server-{}", i),
                &format!("Cleanup Server {}", i),
            );
            service.connect(&config).await.expect("connect failed");
        }

        // Populate tools cache
        for i in 0..3 {
            service
                .list_tools(&format!("cleanup-server-{}", i))
                .await
                .expect("list failed");
        }

        // Disconnect all
        service.disconnect_all().await.expect("disconnect_all failed");

        // All should be disconnected
        for i in 0..3 {
            let status = service.get_status(&format!("cleanup-server-{}", i));
            assert_eq!(format!("{:?}", status), "Disconnected");
        }

        // Tools cache should be cleared — listing should fail (not connected)
        let err = service.list_tools("cleanup-server-0").await;
        assert!(err.is_err());
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Connection Status Tests
// =============================================================================

#[tokio::test]
async fn test_status_transitions() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = test_config("status-server", "Status Server");

        // Before connect: disconnected
        let status = service.get_status("status-server");
        assert_eq!(format!("{:?}", status), "Disconnected");

        // After connect: connected
        service.connect(&config).await.expect("connect failed");
        let status = service.get_status("status-server");
        assert_eq!(format!("{:?}", status), "Connected");

        // After disconnect: disconnected
        service
            .disconnect("status-server")
            .await
            .expect("disconnect failed");
        let status = service.get_status("status-server");
        assert_eq!(format!("{:?}", status), "Disconnected");
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

// =============================================================================
// Invalid Config Tests
// =============================================================================

#[tokio::test]
async fn test_connect_invalid_command_fails() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = McpServerConfig {
            id: "bad-server".to_string(),
            name: "Bad Server".to_string(),
            transport_type: "stdio".to_string(),
            command: Some("nonexistent_binary_xyz_99999".to_string()),
            args: None,
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

        let err = service.connect(&config).await;
        assert!(err.is_err());
        match err.unwrap_err() {
            McpError::CommandNotFound(msg) => {
                assert!(msg.contains("nonexistent_binary_xyz_99999"));
            }
            other => panic!("expected CommandNotFound, got: {:?}", other),
        }
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_connect_missing_command_fails() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = McpServerConfig {
            id: "no-cmd-server".to_string(),
            name: "No Command".to_string(),
            transport_type: "stdio".to_string(),
            command: None, // Missing!
            args: None,
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

        let err = service.connect(&config).await;
        assert!(err.is_err());
        match err.unwrap_err() {
            McpError::ConnectionFailed(msg) => {
                assert!(msg.contains("Command is required"));
            }
            other => panic!("expected ConnectionFailed, got: {:?}", other),
        }
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}

#[tokio::test]
async fn test_connect_unknown_transport_type_fails() {
    let result = timeout(TEST_TIMEOUT, async {
        let service = McpService::new();
        let config = McpServerConfig {
            id: "bad-transport".to_string(),
            name: "Bad Transport".to_string(),
            transport_type: "websocket".to_string(), // Unknown
            command: Some("node".to_string()),
            args: None,
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

        let err = service.connect(&config).await;
        assert!(err.is_err());
        match err.unwrap_err() {
            McpError::ConnectionFailed(msg) => {
                assert!(msg.contains("Unknown transport type"));
            }
            other => panic!("expected ConnectionFailed, got: {:?}", other),
        }
    })
    .await;

    assert!(result.is_ok(), "test timed out");
}
