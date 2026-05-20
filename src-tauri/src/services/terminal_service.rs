use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use log::{error, info};
use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

// --- Event Payloads ---

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutputPayload {
    session_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitPayload {
    session_id: String,
    exit_code: Option<u32>,
}

// --- Session ---

struct PtySession {
    #[allow(dead_code)] // Must stay alive to keep ConPTY handle open on Windows
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
    reader_handle: Option<thread::JoinHandle<()>>,
}

// --- Service ---

#[derive(Clone)]
pub struct TerminalService {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl Default for TerminalService {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalService {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(
        &self,
        app_handle: AppHandle,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        shell_path: Option<String>,
        shell_id: Option<String>,
    ) -> AppResult<String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Internal(format!("Failed to open PTY: {e}")))?;

        let mut cmd = Self::build_shell_command(shell_path.as_deref(), shell_id.as_deref());

        if let Some(ref dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Internal(format!("Failed to spawn shell: {e}")))?;

        // Drop slave — we only need the master side
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Internal(format!("Failed to take PTY writer: {e}")))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Internal(format!("Failed to clone PTY reader: {e}")))?;

        // Spawn reader thread
        let sid = session_id.clone();
        let handle = app_handle.clone();
        let sessions_ref = self.sessions.clone();

        let reader_handle = thread::spawn(move || {
            // Give frontend time to register event listeners before emitting data
            thread::sleep(std::time::Duration::from_millis(150));

            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let payload = PtyOutputPayload {
                            session_id: sid.clone(),
                            data: buf[..n].to_vec(),
                        };
                        if let Err(e) = handle.emit("pty-output", &payload) {
                            error!("Failed to emit pty-output: {e}");
                        }
                    }
                    Err(e) => {
                        error!("PTY read error for session {}: {e}", sid);
                        break;
                    }
                }
            }

            // Process exited — try to get exit code
            let exit_code = if let Ok(mut sessions) = sessions_ref.lock() {
                sessions
                    .get_mut(&sid)
                    .and_then(|s| s.child.try_wait().ok().flatten())
                    .map(|status| status.exit_code())
            } else {
                None
            };

            let payload = PtyExitPayload {
                session_id: sid.clone(),
                exit_code,
            };
            if let Err(e) = handle.emit("pty-exit", &payload) {
                error!("Failed to emit pty-exit: {e}");
            }

            info!("PTY reader thread exiting for session {}", sid);
        });

        let session = PtySession {
            master: pair.master,
            writer,
            child,
            reader_handle: Some(reader_handle),
        };

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(session_id.clone(), session);
        } else {
            return Err(AppError::Internal(
                "Failed to acquire sessions lock".to_string(),
            ));
        }

        info!("Created terminal session: {}", session_id);
        Ok(session_id)
    }

    pub fn write_session(&self, session_id: &str, data: &[u8]) -> AppResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Internal("Failed to acquire sessions lock".to_string()))?;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::NotFound(format!("Terminal session not found: {session_id}")))?;

        // Try to write, but don't error if pipe is closed (process exited)
        if let Err(e) = session.writer.write_all(data) {
            let err_str = e.to_string();
            // OS error 232 = ERROR_NO_DATA (Windows pipe closed), or Unix broken pipe
            if err_str.contains("232") || err_str.contains("Broken pipe") {
                log::warn!("PTY write ignored (pipe closed) for session {}", session_id);
                return Ok(());
            }
            return Err(AppError::Io(format!("Failed to write to PTY: {e}")));
        }

        Ok(())
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Internal("Failed to acquire sessions lock".to_string()))?;

        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::NotFound(format!("Terminal session not found: {session_id}")))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Internal(format!("Failed to resize PTY: {e}")))?;

        info!(
            "Resized session {} to cols={}, rows={}",
            session_id, cols, rows
        );
        Ok(())
    }

    pub fn kill_session(&self, session_id: &str) -> AppResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Internal("Failed to acquire sessions lock".to_string()))?;

        let mut session = sessions.remove(session_id).ok_or_else(|| {
            AppError::NotFound(format!("Terminal session not found: {session_id}"))
        })?;

        // Kill the child process
        session
            .child
            .kill()
            .map_err(|e| AppError::Internal(format!("Failed to kill PTY process: {e}")))?;

        // Drop writer and master to unblock reader thread
        drop(session.writer);
        drop(session.master);

        // Wait for reader thread to finish
        if let Some(handle) = session.reader_handle.take() {
            let _ = handle.join();
        }

        info!("Killed terminal session: {}", session_id);
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn build_shell_command(shell_path: Option<&str>, shell_id: Option<&str>) -> CommandBuilder {
        match shell_path {
            Some(path) => {
                let mut cmd = CommandBuilder::new(path);
                if let Some(id) = shell_id {
                    for arg in crate::services::shell_service::get_shell_args(id) {
                        cmd.arg(arg);
                    }
                }
                cmd
            }
            None => CommandBuilder::new("powershell.exe"),
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn build_shell_command(shell_path: Option<&str>, _shell_id: Option<&str>) -> CommandBuilder {
        match shell_path {
            Some(path) => CommandBuilder::new(path),
            None => {
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
                CommandBuilder::new(shell)
            }
        }
    }
}
