use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use sqlx::SqlitePool;
use tokio::sync::Mutex;

use super::protocol::{build_initialize_request, build_initialized_notification, build_tool_call_request, build_tools_list_request};
use super::server_store;
use super::transport::http::HttpTransport;
use super::transport::stdio::StdioTransport;
use super::transport::McpTransport;
use super::types::{McpConnectionStatus, McpContent, McpError, McpServerConfig, McpTool, McpToolResult};

const MAX_SERVERS: usize = 10;
const MAX_TOTAL_TOOLS: usize = 200;

pub struct McpService {
    connections: Arc<Mutex<HashMap<String, Box<dyn McpTransport>>>>,
    tools_cache: Arc<Mutex<HashMap<String, Vec<McpTool>>>>,
}

impl Default for McpService {
    fn default() -> Self {
        Self::new()
    }
}

impl McpService {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            tools_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn connect(&self, config: &McpServerConfig) -> Result<(), McpError> {
        let mut conns = self.connections.lock().await;

        if conns.len() >= MAX_SERVERS {
            return Err(McpError::TooManyServers(format!(
                "Maximum of {} active server connections reached",
                MAX_SERVERS
            )));
        }

        let transport: Box<dyn McpTransport> = match config.transport_type.as_str() {
            "stdio" => {
                let command = config.command.as_deref().ok_or_else(|| {
                    McpError::ConnectionFailed("Command is required for stdio transport".to_string())
                })?;

                let args: Vec<String> = config
                    .args
                    .as_deref()
                    .map(|a| serde_json::from_str(a).unwrap_or_default())
                    .unwrap_or_default();

                let env_vars: Option<HashMap<String, String>> = config
                    .env_vars
                    .as_deref()
                    .and_then(|e| serde_json::from_str(e).ok());

                let t = StdioTransport::new(command, &args, env_vars.as_ref()).await?;
                Box::new(t)
            }
            "http" => {
                let url = config.url.as_deref().ok_or_else(|| {
                    McpError::ConnectionFailed("URL is required for HTTP transport".to_string())
                })?;

                let headers: Option<HashMap<String, String>> = config
                    .headers
                    .as_deref()
                    .and_then(|h| serde_json::from_str(h).ok());

                let t = HttpTransport::new(url, config.auth_token.as_deref(), headers.as_ref())?;
                Box::new(t)
            }
            other => {
                return Err(McpError::ConnectionFailed(format!(
                    "Unknown transport type: {}",
                    other
                )));
            }
        };

        // Perform initialize handshake
        let init_request = build_initialize_request("enowx-coder", "0.1.0");
        let response = transport.send(init_request).await?;

        if let Some(err) = response.error {
            return Err(McpError::ProtocolError(format!(
                "Initialize failed: {}",
                err.message
            )));
        }

        // Send initialized notification (required by MCP protocol)
        let initialized_notif = build_initialized_notification();
        transport.notify(initialized_notif).await?;
        // Brief delay to let server process the notification
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        conns.insert(config.id.clone(), transport);
        Ok(())
    }

    pub async fn disconnect(&self, server_id: &str) -> Result<(), McpError> {
        let mut conns = self.connections.lock().await;

        if let Some(transport) = conns.remove(server_id) {
            transport.close().await?;
        }

        // Clear tools cache for this server
        let mut cache = self.tools_cache.lock().await;
        cache.remove(server_id);

        Ok(())
    }

    pub async fn disconnect_all(&self) -> Result<(), McpError> {
        let mut conns = self.connections.lock().await;
        let mut cache = self.tools_cache.lock().await;

        for (_, transport) in conns.drain() {
            let _ = transport.close().await;
        }
        cache.clear();

        Ok(())
    }

    pub async fn list_tools(&self, server_id: &str) -> Result<Vec<McpTool>, McpError> {
        // Check cache first
        {
            let cache = self.tools_cache.lock().await;
            if let Some(tools) = cache.get(server_id) {
                return Ok(tools.clone());
            }
        }

        // Fetch from server
        let conns = self.connections.lock().await;
        let transport = conns.get(server_id).ok_or_else(|| {
            McpError::ConnectionFailed(format!("Server '{}' is not connected", server_id))
        })?;

        let request = build_tools_list_request();
        let response = transport.send(request).await?;

        if let Some(err) = response.error {
            return Err(McpError::ProtocolError(format!(
                "tools/list failed: {}",
                err.message
            )));
        }

        let tools = parse_tools_from_response(response.result)?;

        // Check total tools limit
        drop(conns);
        let mut cache = self.tools_cache.lock().await;
        let existing_count: usize = cache.values().map(|v| v.len()).sum();
        if existing_count + tools.len() > MAX_TOTAL_TOOLS {
            return Err(McpError::TooManyTools(format!(
                "Total tools would exceed limit of {}",
                MAX_TOTAL_TOOLS
            )));
        }

        cache.insert(server_id.to_string(), tools.clone());
        Ok(tools)
    }

    pub async fn call_tool(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: Value,
        pool: &SqlitePool,
    ) -> Result<McpToolResult, McpError> {
        // First attempt
        match self.try_call_tool(server_id, tool_name, &arguments).await {
            Ok(result) => Ok(result),
            Err(McpError::ConnectionFailed(_) | McpError::Timeout(_)) => {
                // Retry with fresh connection
                self.reconnect_server(server_id, pool).await?;
                self.try_call_tool(server_id, tool_name, &arguments).await
            }
            Err(e) => Err(e),
        }
    }

    async fn try_call_tool(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: &Value,
    ) -> Result<McpToolResult, McpError> {
        let conns = self.connections.lock().await;
        let transport = conns.get(server_id).ok_or_else(|| {
            McpError::ConnectionFailed(format!("Server '{}' is not connected", server_id))
        })?;

        let request = build_tool_call_request(tool_name, arguments.clone());
        let response = transport.send(request).await?;

        if let Some(err) = response.error {
            return Err(McpError::ExecutionError(format!(
                "Tool call failed: {}",
                err.message
            )));
        }

        parse_tool_result(response.result)
    }

    async fn reconnect_server(&self, server_id: &str, pool: &SqlitePool) -> Result<(), McpError> {
        // Disconnect existing
        self.disconnect(server_id).await?;

        // Fetch config from DB
        let config = server_store::get_server(pool, server_id)
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("Failed to fetch server config: {}", e)))?
            .ok_or_else(|| {
                McpError::ConnectionFailed(format!("Server '{}' not found in database", server_id))
            })?;

        self.connect(&config).await
    }

    pub fn get_status(&self, server_id: &str) -> McpConnectionStatus {
        // Use try_lock to avoid blocking — if locked, assume connecting
        match self.connections.try_lock() {
            Ok(conns) => match conns.get(server_id) {
                Some(transport) => {
                    if transport.is_connected() {
                        McpConnectionStatus::Connected
                    } else {
                        McpConnectionStatus::Disconnected
                    }
                }
                None => McpConnectionStatus::Disconnected,
            },
            Err(_) => McpConnectionStatus::Connecting,
        }
    }

    pub async fn get_all_tools(&self) -> Vec<(String, McpTool)> {
        let cache = self.tools_cache.lock().await;
        let mut result = Vec::new();

        for (server_id, tools) in cache.iter() {
            for tool in tools {
                result.push((server_id.clone(), tool.clone()));
            }
        }

        result
    }
}

fn parse_tools_from_response(result: Option<Value>) -> Result<Vec<McpTool>, McpError> {
    let result = result.ok_or_else(|| {
        McpError::InvalidResponse("tools/list returned no result".to_string())
    })?;

    let tools_array = result
        .get("tools")
        .and_then(|t| t.as_array())
        .ok_or_else(|| {
            McpError::InvalidResponse("tools/list result missing 'tools' array".to_string())
        })?;

    let mut tools = Vec::with_capacity(tools_array.len());
    for tool_value in tools_array {
        let name = tool_value
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();

        let description = tool_value
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or_default()
            .to_string();

        let input_schema = tool_value
            .get("inputSchema")
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));

        tools.push(McpTool {
            name,
            description,
            input_schema,
        });
    }

    Ok(tools)
}

fn parse_tool_result(result: Option<Value>) -> Result<McpToolResult, McpError> {
    let result = result.ok_or_else(|| {
        McpError::InvalidResponse("tools/call returned no result".to_string())
    })?;

    let is_error = result.get("isError").and_then(|e| e.as_bool()).unwrap_or(false);

    let content = result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let content_type = item.get("type").and_then(|t| t.as_str())?;
                    match content_type {
                        "text" => {
                            let text = item.get("text").and_then(|t| t.as_str())?.to_string();
                            Some(McpContent::Text { text })
                        }
                        "image" => {
                            let data = item.get("data").and_then(|d| d.as_str())?.to_string();
                            let mime_type = item
                                .get("mimeType")
                                .and_then(|m| m.as_str())
                                .unwrap_or("image/png")
                                .to_string();
                            Some(McpContent::Image { data, mime_type })
                        }
                        _ => None,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(McpToolResult { content, is_error })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_mcp_service_new_creates_empty_state() {
        let service = McpService::new();
        let tools = service.get_all_tools().await;
        assert!(tools.is_empty());
    }

    #[test]
    fn test_get_status_returns_disconnected_for_unknown_server() {
        let service = McpService::new();
        let status = service.get_status("nonexistent-server");
        assert_eq!(status, McpConnectionStatus::Disconnected);
    }

    #[tokio::test]
    async fn test_get_all_tools_returns_empty_when_no_cache() {
        let service = McpService::new();
        let tools = service.get_all_tools().await;
        assert!(tools.is_empty());
    }

    #[tokio::test]
    async fn test_connect_limit_reached() {
        let service = McpService::new();
        // Manually fill connections to MAX_SERVERS
        {
            let mut conns = service.connections.lock().await;
            for i in 0..MAX_SERVERS {
                // Insert dummy entries — we use a minimal mock-like approach
                // We can't create real transports, but we can test the limit logic
                // by inserting placeholder keys
                conns.insert(format!("server-{}", i), Box::new(DummyTransport));
            }
        }

        let config = McpServerConfig {
            id: "overflow-server".to_string(),
            name: "Overflow".to_string(),
            transport_type: "stdio".to_string(),
            command: Some("echo".to_string()),
            args: None,
            env_vars: None,
            url: None,
            headers: None,
            auth_type: "none".to_string(),
            auth_token: None,
            enabled: true,
            status: "disconnected".to_string(),
            tools_count: 0,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };

        let result = service.connect(&config).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, McpError::TooManyServers(_)));
    }

    #[test]
    fn test_parse_tools_from_response_valid() {
        let result = Some(json!({
            "tools": [
                {
                    "name": "read_file",
                    "description": "Read a file",
                    "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}}
                },
                {
                    "name": "write_file",
                    "description": "Write a file",
                    "inputSchema": {"type": "object"}
                }
            ]
        }));

        let tools = parse_tools_from_response(result).unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "read_file");
        assert_eq!(tools[1].name, "write_file");
    }

    #[test]
    fn test_parse_tools_from_response_none() {
        let result = parse_tools_from_response(None);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_tools_from_response_missing_tools_array() {
        let result = parse_tools_from_response(Some(json!({"other": "data"})));
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_tool_result_text() {
        let result = Some(json!({
            "content": [{"type": "text", "text": "Hello"}],
            "isError": false
        }));

        let parsed = parse_tool_result(result).unwrap();
        assert!(!parsed.is_error);
        assert_eq!(parsed.content.len(), 1);
        match &parsed.content[0] {
            McpContent::Text { text } => assert_eq!(text, "Hello"),
            _ => panic!("Expected Text content"),
        }
    }

    #[test]
    fn test_parse_tool_result_image() {
        let result = Some(json!({
            "content": [{"type": "image", "data": "abc123", "mimeType": "image/jpeg"}],
            "isError": false
        }));

        let parsed = parse_tool_result(result).unwrap();
        match &parsed.content[0] {
            McpContent::Image { data, mime_type } => {
                assert_eq!(data, "abc123");
                assert_eq!(mime_type, "image/jpeg");
            }
            _ => panic!("Expected Image content"),
        }
    }

    #[test]
    fn test_parse_tool_result_error_flag() {
        let result = Some(json!({
            "content": [{"type": "text", "text": "Error occurred"}],
            "isError": true
        }));

        let parsed = parse_tool_result(result).unwrap();
        assert!(parsed.is_error);
    }

    #[test]
    fn test_parse_tool_result_none() {
        let result = parse_tool_result(None);
        assert!(result.is_err());
    }

    /// Minimal dummy transport for testing connection limits
    struct DummyTransport;

    #[async_trait::async_trait]
    impl McpTransport for DummyTransport {
        async fn send(
            &self,
            _request: super::super::types::JsonRpcRequest,
        ) -> Result<super::super::types::JsonRpcResponse, McpError> {
            unimplemented!("dummy")
        }

        async fn notify(
            &self,
            _notification: super::super::types::JsonRpcNotification,
        ) -> Result<(), McpError> {
            Ok(())
        }

        async fn close(&self) -> Result<(), McpError> {
            Ok(())
        }

        fn is_connected(&self) -> bool {
            true
        }
    }
}
