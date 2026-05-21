use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;

use super::types::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, McpError};

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

pub fn next_id() -> u64 {
    REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

pub fn build_initialize_request(client_name: &str, client_version: &str) -> JsonRpcRequest {
    let mut client_info = serde_json::Map::new();
    client_info.insert("name".to_string(), Value::String(client_name.to_string()));
    client_info.insert(
        "version".to_string(),
        Value::String(client_version.to_string()),
    );

    let mut params = serde_json::Map::new();
    params.insert(
        "protocolVersion".to_string(),
        Value::String("2024-11-05".to_string()),
    );
    params.insert("capabilities".to_string(), Value::Object(serde_json::Map::new()));
    params.insert("clientInfo".to_string(), Value::Object(client_info));

    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: next_id(),
        method: "initialize".to_string(),
        params: Some(Value::Object(params)),
    }
}

pub fn build_tools_list_request() -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: next_id(),
        method: "tools/list".to_string(),
        params: None,
    }
}

pub fn build_tool_call_request(name: &str, arguments: serde_json::Value) -> JsonRpcRequest {
    let mut params = serde_json::Map::new();
    params.insert("name".to_string(), Value::String(name.to_string()));
    params.insert("arguments".to_string(), arguments);

    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: next_id(),
        method: "tools/call".to_string(),
        params: Some(Value::Object(params)),
    }
}

pub fn build_initialized_notification() -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".to_string(),
        method: "notifications/initialized".to_string(),
        params: None,
    }
}

pub fn parse_response(raw: &str) -> Result<JsonRpcResponse, McpError> {
    serde_json::from_str(raw).map_err(|e| McpError::InvalidResponse(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_initialize_request() {
        let req = build_initialize_request("enowx-coder", "0.1.0");
        assert_eq!(req.method, "initialize");
        assert_eq!(req.jsonrpc, "2.0");
        let params = req.params.expect("params should be present");
        assert_eq!(params["protocolVersion"], "2024-11-05");
        assert_eq!(params["clientInfo"]["name"], "enowx-coder");
        assert_eq!(params["clientInfo"]["version"], "0.1.0");
    }

    #[test]
    fn test_build_tools_list_request() {
        let req = build_tools_list_request();
        assert_eq!(req.method, "tools/list");
        assert!(req.params.is_none());
    }

    #[test]
    fn test_build_tool_call_request() {
        let mut args_map = serde_json::Map::new();
        args_map.insert(
            "path".to_string(),
            Value::String("/tmp/test.txt".to_string()),
        );
        let args = Value::Object(args_map);
        let req = build_tool_call_request("read_file", args.clone());
        assert_eq!(req.method, "tools/call");
        let params = req.params.expect("params should be present");
        assert_eq!(params["name"], "read_file");
        assert_eq!(params["arguments"], args);
    }

    #[test]
    fn test_parse_response_valid() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]},"error":null}"#;
        let resp = parse_response(raw).expect("should parse valid JSON-RPC response");
        assert_eq!(resp.jsonrpc, "2.0");
        assert_eq!(resp.id, Some(1));
        assert!(resp.result.is_some());
    }

    #[test]
    fn test_parse_response_invalid() {
        let raw = "not json at all";
        let result = parse_response(raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_response_with_error_field() {
        let raw = r#"{"jsonrpc":"2.0","id":5,"result":null,"error":{"code":-32601,"message":"Method not found","data":null}}"#;
        let resp = parse_response(raw).unwrap();
        assert_eq!(resp.id, Some(5));
        let err = resp.error.expect("error field should be present");
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }

    #[test]
    fn test_parse_response_malformed_json_returns_invalid_response() {
        let raw = r#"{"jsonrpc": "2.0", "id": }"#; // malformed
        let result = parse_response(raw);
        assert!(result.is_err());
        let err_str = format!("{}", result.unwrap_err());
        assert!(err_str.contains("Invalid response"));
    }

    #[test]
    fn test_request_ids_are_incrementing() {
        let id1 = next_id();
        let id2 = next_id();
        let id3 = next_id();
        assert!(id2 > id1);
        assert!(id3 > id2);
    }
}
