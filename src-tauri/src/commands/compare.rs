use tauri::ipc::Channel;
use tauri::State;

use crate::{
    error::AppResult,
    models::{CompareMessage, CompareSession},
    services::compare_service,
    state::AppState,
};
use crate::services::compare_service::CompareModelConfig;

#[tauri::command]
pub async fn create_compare_session(
    state: State<'_, AppState>,
    model_ids: Vec<String>,
) -> AppResult<CompareSession> {
    compare_service::create_session(state.pool(), model_ids).await
}

#[tauri::command]
pub async fn list_compare_sessions(
    state: State<'_, AppState>,
) -> AppResult<Vec<CompareSession>> {
    compare_service::list_sessions(state.pool()).await
}

#[tauri::command]
pub async fn get_compare_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<CompareMessage>> {
    compare_service::get_messages(state.pool(), &session_id).await
}

#[tauri::command]
pub async fn delete_compare_session(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<()> {
    compare_service::delete_session(state.pool(), &session_id).await
}

#[tauri::command]
pub async fn send_compare_message(
    state: State<'_, AppState>,
    session_id: String,
    content: String,
    model_configs: Vec<CompareModelConfig>,
    attachment_ids: Option<Vec<String>>,
    on_token: Channel<String>,
) -> AppResult<()> {
    let cancel_token = state.cancellations.register(format!("compare:{session_id}"));

    // Each model gets a clone of the same channel; messages are prefixed with
    // model index by the service so the frontend can demux.
    let channels: Vec<Channel<String>> = model_configs.iter().map(|_| on_token.clone()).collect();

    let result = compare_service::send_compare(
        state.pool(),
        &session_id,
        &content,
        model_configs,
        channels,
        cancel_token,
        attachment_ids.unwrap_or_default(),
    )
    .await;

    state.cancellations.remove(&format!("compare:{session_id}"));
    result
}

#[tauri::command]
pub async fn cancel_compare(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.cancellations.cancel(&format!("compare:{session_id}"));
    Ok(())
}
