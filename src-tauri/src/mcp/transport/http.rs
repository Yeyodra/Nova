use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;

use crate::mcp::protocol::parse_response;
use crate::mcp::types::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, McpError};

use super::McpTransport;

const USER_AGENT: &str = concat!("enowX-Coder/", env!("CARGO_PKG_VERSION"));
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub struct HttpTransport {
    client: Client,
    url: String,
    auth_token: Option<String>,
    custom_headers: HashMap<String, String>,
    connected: AtomicBool,
}

impl HttpTransport {
    pub fn new(
        url: &str,
        auth_token: Option<&str>,
        headers: Option<&HashMap<String, String>>,
    ) -> Result<Self, McpError> {
        Self::with_timeouts(url, auth_token, headers, CONNECT_TIMEOUT, REQUEST_TIMEOUT)
    }

    fn with_timeouts(
        url: &str,
        auth_token: Option<&str>,
        headers: Option<&HashMap<String, String>>,
        connect_timeout: Duration,
        request_timeout: Duration,
    ) -> Result<Self, McpError> {
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(connect_timeout)
            .timeout(request_timeout)
            .build()
            .map_err(|e| McpError::ConnectionFailed(format!("Failed to build HTTP client: {e}")))?;

        Ok(Self {
            client,
            url: url.to_string(),
            auth_token: auth_token.map(|t| t.to_string()),
            custom_headers: headers.cloned().unwrap_or_default(),
            connected: AtomicBool::new(true),
        })
    }
}

#[async_trait]
impl McpTransport for HttpTransport {
    async fn send(&self, request: JsonRpcRequest) -> Result<JsonRpcResponse, McpError> {
        let body = serde_json::to_string(&request)
            .map_err(|e| McpError::InvalidResponse(format!("Failed to serialize request: {e}")))?;

        let mut req_builder = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            req_builder = req_builder.header("Authorization", format!("Bearer {token}"));
        }

        for (key, value) in &self.custom_headers {
            req_builder = req_builder.header(key, value);
        }

        let response = req_builder.body(body).send().await.map_err(|e| {
            if e.is_timeout() {
                McpError::Timeout(format!("Request timed out: {e}"))
            } else {
                McpError::ConnectionFailed(format!("Network error: {e}"))
            }
        })?;

        let status = response.status();
        let response_body = response
            .text()
            .await
            .map_err(|e| McpError::ConnectionFailed(format!("Failed to read response body: {e}")))?;

        if status.is_server_error() {
            return Err(McpError::ConnectionFailed(format!(
                "Server error (HTTP {status}): {response_body}"
            )));
        }

        if status.is_client_error() {
            return Err(McpError::ExecutionError(format!(
                "Client error (HTTP {status}): {response_body}"
            )));
        }

        parse_response(&response_body)
    }

    async fn notify(&self, notification: JsonRpcNotification) -> Result<(), McpError> {
        let body = serde_json::to_string(&notification)
            .map_err(|e| McpError::InvalidResponse(format!("Failed to serialize notification: {e}")))?;

        let mut req_builder = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json");

        if let Some(token) = &self.auth_token {
            req_builder = req_builder.header("Authorization", format!("Bearer {token}"));
        }

        for (key, value) in &self.custom_headers {
            req_builder = req_builder.header(key, value);
        }

        // Send notification — we don't expect a meaningful response
        req_builder.body(body).send().await.map_err(|e| {
            if e.is_timeout() {
                McpError::Timeout(format!("Notification timed out: {e}"))
            } else {
                McpError::ConnectionFailed(format!("Network error sending notification: {e}"))
            }
        })?;

        Ok(())
    }

    async fn close(&self) -> Result<(), McpError> {
        self.connected.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_http_transport_new_creates_connected_instance() {
        let transport = HttpTransport::new("http://localhost:9999", None, None).unwrap();
        assert!(transport.is_connected());
    }

    #[tokio::test]
    async fn test_http_transport_new_with_auth_token() {
        let transport =
            HttpTransport::new("http://localhost:9999", Some("my-secret-token"), None).unwrap();
        assert!(transport.is_connected());
        assert_eq!(transport.auth_token, Some("my-secret-token".to_string()));
    }

    #[tokio::test]
    async fn test_http_transport_new_with_custom_headers() {
        let mut headers = HashMap::new();
        headers.insert("X-Custom".to_string(), "value123".to_string());
        let transport =
            HttpTransport::new("http://localhost:9999", None, Some(&headers)).unwrap();
        assert_eq!(
            transport.custom_headers.get("X-Custom"),
            Some(&"value123".to_string())
        );
    }

    #[tokio::test]
    async fn test_http_transport_send_success() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]},"error":null}"#,
            ))
            .mount(&mock_server)
            .await;

        let transport = HttpTransport::new(&mock_server.uri(), None, None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "tools/list".to_string(),
            params: None,
        };

        let response = transport.send(request).await.unwrap();
        assert_eq!(response.jsonrpc, "2.0");
        assert_eq!(response.id, Some(1));
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_http_transport_send_with_bearer_auth() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(header("Authorization", "Bearer test-token"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"jsonrpc":"2.0","id":1,"result":{},"error":null}"#,
            ))
            .mount(&mock_server)
            .await;

        let transport =
            HttpTransport::new(&mock_server.uri(), Some("test-token"), None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: None,
        };

        let response = transport.send(request).await.unwrap();
        assert_eq!(response.jsonrpc, "2.0");
    }

    #[tokio::test]
    async fn test_http_transport_send_with_custom_headers() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(header("X-Api-Key", "secret"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"jsonrpc":"2.0","id":1,"result":{},"error":null}"#,
            ))
            .mount(&mock_server)
            .await;

        let mut headers = HashMap::new();
        headers.insert("X-Api-Key".to_string(), "secret".to_string());
        let transport =
            HttpTransport::new(&mock_server.uri(), None, Some(&headers)).unwrap();

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "test".to_string(),
            params: None,
        };

        let response = transport.send(request).await.unwrap();
        assert_eq!(response.jsonrpc, "2.0");
    }

    #[tokio::test]
    async fn test_http_transport_send_server_error_returns_connection_failed() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
            .mount(&mock_server)
            .await;

        let transport = HttpTransport::new(&mock_server.uri(), None, None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "test".to_string(),
            params: None,
        };

        let result = transport.send(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, McpError::ConnectionFailed(_)));
        let msg = format!("{}", err);
        assert!(msg.contains("Server error"));
    }

    #[tokio::test]
    async fn test_http_transport_send_client_error_returns_execution_error() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
            .mount(&mock_server)
            .await;

        let transport = HttpTransport::new(&mock_server.uri(), None, None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "test".to_string(),
            params: None,
        };

        let result = transport.send(request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, McpError::ExecutionError(_)));
    }

    #[tokio::test]
    async fn test_http_transport_send_invalid_json_response() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not valid json"))
            .mount(&mock_server)
            .await;

        let transport = HttpTransport::new(&mock_server.uri(), None, None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "test".to_string(),
            params: None,
        };

        let result = transport.send(request).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpError::InvalidResponse(_)));
    }

    #[tokio::test]
    async fn test_http_transport_send_network_error() {
        // Connect to a port that's not listening
        let transport = HttpTransport::new("http://127.0.0.1:1", None, None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "test".to_string(),
            params: None,
        };

        let result = transport.send(request).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpError::ConnectionFailed(_)));
    }

    #[tokio::test]
    async fn test_http_transport_close_sets_disconnected() {
        let transport = HttpTransport::new("http://localhost:9999", None, None).unwrap();
        assert!(transport.is_connected());

        transport.close().await.unwrap();
        assert!(!transport.is_connected());
    }

    #[tokio::test]
    async fn test_http_transport_sends_content_type_json() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(header("Content-Type", "application/json"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"jsonrpc":"2.0","id":1,"result":null,"error":null}"#,
            ))
            .mount(&mock_server)
            .await;

        let transport = HttpTransport::new(&mock_server.uri(), None, None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "test".to_string(),
            params: None,
        };

        let response = transport.send(request).await.unwrap();
        assert_eq!(response.jsonrpc, "2.0");
    }

    #[tokio::test]
    async fn test_http_transport_response_with_jsonrpc_error() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"jsonrpc":"2.0","id":1,"result":null,"error":{"code":-32601,"message":"Method not found","data":null}}"#,
            ))
            .mount(&mock_server)
            .await;

        let transport = HttpTransport::new(&mock_server.uri(), None, None).unwrap();
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "nonexistent".to_string(),
            params: None,
        };

        let response = transport.send(request).await.unwrap();
        let err = response.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }
}
