use std::sync::Arc;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::mcp::{server_store, service::McpService, types::*};
use crate::state::AppState;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpStatusChangedEvent {
    server_id: String,
    status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpErrorEvent {
    server_id: String,
    tool_name: String,
    error: String,
}

#[tauri::command]
pub async fn list_mcp_servers(state: State<'_, AppState>) -> AppResult<Vec<McpServerConfig>> {
    server_store::list_servers(state.pool()).await
}

#[tauri::command]
pub async fn add_mcp_server(
    state: State<'_, AppState>,
    config: McpServerConfig,
) -> AppResult<McpServerConfig> {
    if config.name.trim().is_empty() {
        return Err(AppError::Validation("Server name is required".into()));
    }

    if config.transport_type != "stdio" && config.transport_type != "http" {
        return Err(AppError::Validation(format!(
            "Invalid transport type: {}",
            config.transport_type
        )));
    }

    if config.transport_type == "stdio" && config.command.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::Validation(
            "Command is required for stdio transport".into(),
        ));
    }

    if config.transport_type == "http" && config.url.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::Validation(
            "URL is required for HTTP transport".into(),
        ));
    }

    server_store::insert_server(state.pool(), &config).await
}

#[tauri::command]
pub async fn update_mcp_server(
    state: State<'_, AppState>,
    mcp_service: State<'_, Arc<McpService>>,
    app: AppHandle,
    config: McpServerConfig,
) -> AppResult<()> {
    server_store::update_server(state.pool(), &config).await?;

    // If server is currently connected, disconnect it so it picks up new config on next connect
    let status = mcp_service.get_status(&config.id);
    if status == McpConnectionStatus::Connected {
        let _ = mcp_service.disconnect(&config.id).await;
        let _ = app.emit(
            "mcp:status-changed",
            McpStatusChangedEvent {
                server_id: config.id,
                status: "disconnected".into(),
            },
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn remove_mcp_server(
    state: State<'_, AppState>,
    mcp_service: State<'_, Arc<McpService>>,
    app: AppHandle,
    id: String,
) -> AppResult<()> {
    // Disconnect if connected
    let status = mcp_service.get_status(&id);
    if status == McpConnectionStatus::Connected {
        let _ = mcp_service.disconnect(&id).await;
        let _ = app.emit(
            "mcp:status-changed",
            McpStatusChangedEvent {
                server_id: id.clone(),
                status: "disconnected".into(),
            },
        );
    }

    server_store::delete_server(state.pool(), &id).await
}

#[tauri::command]
pub async fn toggle_mcp_server(
    state: State<'_, AppState>,
    mcp_service: State<'_, Arc<McpService>>,
    app: AppHandle,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    server_store::toggle_server(state.pool(), &id, enabled).await?;

    // If disabling, disconnect the server
    if !enabled {
        let status = mcp_service.get_status(&id);
        if status == McpConnectionStatus::Connected {
            let _ = mcp_service.disconnect(&id).await;
            let _ = app.emit(
                "mcp:status-changed",
                McpStatusChangedEvent {
                    server_id: id,
                    status: "disconnected".into(),
                },
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn test_mcp_connection(
    mcp_service: State<'_, Arc<McpService>>,
    config: McpServerConfig,
) -> AppResult<Vec<McpTool>> {
    // Connect temporarily
    mcp_service.connect(&config).await?;

    // List tools
    let tools = match mcp_service.list_tools(&config.id).await {
        Ok(tools) => tools,
        Err(e) => {
            // Cleanup on failure
            let _ = mcp_service.disconnect(&config.id).await;
            return Err(e.into());
        }
    };

    // Disconnect — this was just a test
    let _ = mcp_service.disconnect(&config.id).await;

    Ok(tools)
}

#[tauri::command]
pub async fn get_mcp_tools(
    mcp_service: State<'_, Arc<McpService>>,
    server_id: String,
) -> AppResult<Vec<McpTool>> {
    let tools = mcp_service.list_tools(&server_id).await?;
    Ok(tools)
}

#[tauri::command]
pub async fn call_mcp_tool(
    state: State<'_, AppState>,
    mcp_service: State<'_, Arc<McpService>>,
    app: AppHandle,
    server_id: String,
    tool_name: String,
    arguments: Value,
) -> AppResult<McpToolResult> {
    match mcp_service
        .call_tool(&server_id, &tool_name, arguments, state.pool())
        .await
    {
        Ok(result) => Ok(result),
        Err(e) => {
            let _ = app.emit(
                "mcp:error",
                McpErrorEvent {
                    server_id,
                    tool_name,
                    error: e.to_string(),
                },
            );
            Err(e.into())
        }
    }
}
