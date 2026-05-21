pub mod agent_service;
pub mod cleanup_service;
pub mod compare_service;
pub mod extraction_service;
pub mod file_service;
pub mod chat_service;
pub mod drawing_service;
pub mod http_client;
pub mod model_service;
pub mod project_service;
pub mod provider_model_service;
pub mod provider_service;
pub mod session_service;
pub mod settings_service;
pub mod shell_service;
pub mod terminal_service;

pub(crate) fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
