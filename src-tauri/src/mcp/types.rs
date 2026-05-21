use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransportType {
    Stdio,
    Http,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum McpConnectionStatus {
    Connected,
    Disconnected,
    Connecting,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport_type: String,
    pub command: Option<String>,
    pub args: Option<String>,
    pub env_vars: Option<String>,
    pub url: Option<String>,
    pub headers: Option<String>,
    pub auth_type: String,
    pub auth_token: Option<String>,
    pub enabled: bool,
    pub status: String,
    pub tools_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCall {
    pub server_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpContent {
    Text { text: String },
    Image { data: String, mime_type: String },
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum McpError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    #[error("Command not found: {0}")]
    CommandNotFound(String),
    #[error("Timeout: {0}")]
    Timeout(String),
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
    #[error("Tool not found: {0}")]
    ToolNotFound(String),
    #[error("Execution error: {0}")]
    ExecutionError(String),
    #[error("Too many servers: {0}")]
    TooManyServers(String),
    #[error("Too many tools: {0}")]
    TooManyTools(String),
    #[error("Protocol error: {0}")]
    ProtocolError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<u64>,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_transport_type_serializes_lowercase() {
        let stdio = McpTransportType::Stdio;
        let http = McpTransportType::Http;
        assert_eq!(serde_json::to_string(&stdio).unwrap(), r#""stdio""#);
        assert_eq!(serde_json::to_string(&http).unwrap(), r#""http""#);
    }

    #[test]
    fn test_transport_type_deserializes() {
        let stdio: McpTransportType = serde_json::from_str(r#""stdio""#).unwrap();
        let http: McpTransportType = serde_json::from_str(r#""http""#).unwrap();
        assert_eq!(stdio, McpTransportType::Stdio);
        assert_eq!(http, McpTransportType::Http);
    }

    #[test]
    fn test_connection_status_serializes_camel_case() {
        assert_eq!(
            serde_json::to_string(&McpConnectionStatus::Connected).unwrap(),
            r#""connected""#
        );
        assert_eq!(
            serde_json::to_string(&McpConnectionStatus::Disconnected).unwrap(),
            r#""disconnected""#
        );
        assert_eq!(
            serde_json::to_string(&McpConnectionStatus::Connecting).unwrap(),
            r#""connecting""#
        );
        assert_eq!(
            serde_json::to_string(&McpConnectionStatus::Error).unwrap(),
            r#""error""#
        );
    }

    #[test]
    fn test_mcp_server_config_serializes_camel_case() {
        let config = McpServerConfig {
            id: "test-id".to_string(),
            name: "Test Server".to_string(),
            transport_type: "stdio".to_string(),
            command: Some("node".to_string()),
            args: Some(r#"["server.js"]"#.to_string()),
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

        let json = serde_json::to_value(&config).unwrap();
        // Verify camelCase keys
        assert!(json.get("transportType").is_some());
        assert!(json.get("authType").is_some());
        assert!(json.get("toolsCount").is_some());
        assert!(json.get("createdAt").is_some());
        assert!(json.get("updatedAt").is_some());
        assert!(json.get("envVars").is_some());
        // Verify no snake_case keys leaked
        assert!(json.get("transport_type").is_none());
        assert!(json.get("auth_type").is_none());
    }

    #[test]
    fn test_mcp_tool_round_trip() {
        let tool = McpTool {
            name: "read_file".to_string(),
            description: "Read a file from disk".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }),
        };

        let serialized = serde_json::to_string(&tool).unwrap();
        let deserialized: McpTool = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.name, "read_file");
        assert_eq!(deserialized.description, "Read a file from disk");
        assert_eq!(deserialized.input_schema, tool.input_schema);
    }

    #[test]
    fn test_mcp_tool_result_with_text_content() {
        let result = McpToolResult {
            content: vec![McpContent::Text {
                text: "Hello world".to_string(),
            }],
            is_error: false,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["isError"], false);
        assert_eq!(json["content"][0]["type"], "text");
        assert_eq!(json["content"][0]["text"], "Hello world");
    }

    #[test]
    fn test_mcp_tool_result_with_image_content() {
        let result = McpToolResult {
            content: vec![McpContent::Image {
                data: "base64data".to_string(),
                mime_type: "image/png".to_string(),
            }],
            is_error: false,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["content"][0]["type"], "image");
        assert_eq!(json["content"][0]["data"], "base64data");
        // rename_all on internally tagged enum renames tag values, not fields
        assert_eq!(json["content"][0]["mime_type"], "image/png");
    }

    #[test]
    fn test_mcp_tool_result_error() {
        let result = McpToolResult {
            content: vec![McpContent::Text {
                text: "Something went wrong".to_string(),
            }],
            is_error: true,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["isError"], true);
    }

    #[test]
    fn test_mcp_error_serializes_with_tag() {
        let err = McpError::ConnectionFailed("refused".to_string());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "connectionFailed");
        assert_eq!(json["message"], "refused");

        let err2 = McpError::ToolNotFound("missing_tool".to_string());
        let json2 = serde_json::to_value(&err2).unwrap();
        assert_eq!(json2["kind"], "toolNotFound");
        assert_eq!(json2["message"], "missing_tool");
    }

    #[test]
    fn test_mcp_error_all_variants() {
        let variants: Vec<(McpError, &str)> = vec![
            (McpError::ConnectionFailed("x".into()), "connectionFailed"),
            (McpError::CommandNotFound("x".into()), "commandNotFound"),
            (McpError::Timeout("x".into()), "timeout"),
            (McpError::InvalidResponse("x".into()), "invalidResponse"),
            (McpError::ToolNotFound("x".into()), "toolNotFound"),
            (McpError::ExecutionError("x".into()), "executionError"),
            (McpError::TooManyServers("x".into()), "tooManyServers"),
            (McpError::TooManyTools("x".into()), "tooManyTools"),
            (McpError::ProtocolError("x".into()), "protocolError"),
        ];

        for (err, expected_kind) in variants {
            let json = serde_json::to_value(&err).unwrap();
            assert_eq!(json["kind"], expected_kind, "Failed for {:?}", err);
        }
    }

    #[test]
    fn test_json_rpc_request_serialization() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 42,
            method: "tools/list".to_string(),
            params: None,
        };

        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], 42);
        assert_eq!(json["method"], "tools/list");
        // params should be absent (skip_serializing_if)
        assert!(json.get("params").is_none());
    }

    #[test]
    fn test_json_rpc_response_with_error() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"result":null,"error":{"code":-32600,"message":"Invalid Request","data":null}}"#;
        let resp: JsonRpcResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(resp.id, Some(1));
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32600);
        assert_eq!(err.message, "Invalid Request");
    }
}
