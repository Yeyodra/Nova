pub mod http;
pub mod stdio;

use async_trait::async_trait;

use crate::mcp::types::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, McpError};

#[async_trait]
pub trait McpTransport: Send + Sync {
    async fn send(&self, request: JsonRpcRequest) -> Result<JsonRpcResponse, McpError>;
    async fn notify(&self, notification: JsonRpcNotification) -> Result<(), McpError>;
    async fn close(&self) -> Result<(), McpError>;
    fn is_connected(&self) -> bool;
}
