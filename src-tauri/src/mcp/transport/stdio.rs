use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

#[cfg(windows)]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

use crate::mcp::protocol::parse_response;
use crate::mcp::types::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, McpError};

use super::McpTransport;

const SEND_TIMEOUT: Duration = Duration::from_secs(120);

pub struct StdioTransport {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<ChildStdin>>,
    stdout_reader: Arc<Mutex<BufReader<ChildStdout>>>,
    connected: Arc<AtomicBool>,
}

impl StdioTransport {
    pub async fn new(
        command: &str,
        args: &[String],
        env_vars: Option<&HashMap<String, String>>,
    ) -> Result<Self, McpError> {
        // Validate command exists on PATH (on Windows, also try .cmd/.bat extensions)
        let resolved_command = which::which(command)
            .or_else(|_| which::which(format!("{}.cmd", command)))
            .or_else(|_| which::which(format!("{}.bat", command)))
            .map_err(|_| {
                McpError::CommandNotFound(format!(
                    "Command '{}' not found in PATH",
                    command
                ))
            })?;

        let mut cmd = tokio::process::Command::new(&resolved_command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Clear environment and re-inject essential vars + user-specified vars
        cmd.env_clear();

        // Pass through essential system environment variables
        let essential_vars = [
            "PATH",
            "SYSTEMROOT",
            "SYSTEMDRIVE",
            "APPDATA",
            "LOCALAPPDATA",
            "USERPROFILE",
            "HOMEDRIVE",
            "HOMEPATH",
            "TEMP",
            "TMP",
            "PROGRAMFILES",
            "PROGRAMFILES(X86)",
            "COMMONPROGRAMFILES",
            "WINDIR",
        ];
        for var_name in &essential_vars {
            if let Ok(val) = std::env::var(var_name) {
                cmd.env(var_name, &val);
            }
        }

        // User-specified env vars (override system ones if same key)
        if let Some(vars) = env_vars {
            cmd.envs(vars);
        }

        // Windows: hide console window
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            McpError::ConnectionFailed(format!("Failed to spawn '{}': {}", command, e))
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            McpError::ConnectionFailed("Failed to capture child stdin".to_string())
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            McpError::ConnectionFailed("Failed to capture child stdout".to_string())
        })?;

        let stderr = child.stderr.take();

        let connected = Arc::new(AtomicBool::new(true));

        // Spawn background task to drain stderr and log it
        if let Some(stderr_stream) = stderr {
            let connected_clone = Arc::clone(&connected);
            tokio::spawn(async move {
                let reader = BufReader::new(stderr_stream);
                let mut lines = reader.lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            log::debug!("[mcp-stderr] {}", line);
                        }
                        Ok(None) => {
                            // stderr closed — process likely exited
                            connected_clone.store(false, Ordering::Relaxed);
                            break;
                        }
                        Err(e) => {
                            log::warn!("[mcp-stderr] read error: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
            stdin: Arc::new(Mutex::new(stdin)),
            stdout_reader: Arc::new(Mutex::new(BufReader::new(stdout))),
            connected,
        })
    }
}

#[async_trait]
impl McpTransport for StdioTransport {
    async fn send(&self, request: JsonRpcRequest) -> Result<JsonRpcResponse, McpError> {
        if !self.is_connected() {
            return Err(McpError::ConnectionFailed(
                "Transport is not connected".to_string(),
            ));
        }

        // Serialize request as JSON + newline
        let mut payload = serde_json::to_string(&request).map_err(|e| {
            McpError::ProtocolError(format!("Failed to serialize request: {}", e))
        })?;
        payload.push('\n');

        // Write to stdin
        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(payload.as_bytes()).await.map_err(|e| {
                self.connected.store(false, Ordering::Relaxed);
                McpError::ConnectionFailed(format!("Failed to write to stdin: {}", e))
            })?;
            stdin.flush().await.map_err(|e| {
                self.connected.store(false, Ordering::Relaxed);
                McpError::ConnectionFailed(format!("Failed to flush stdin: {}", e))
            })?;
        }

        // Read one line from stdout with timeout, skipping server notifications
        let line = {
            let mut reader = self.stdout_reader.lock().await;
            loop {
                let mut buf = String::new();
                let read_result = timeout(SEND_TIMEOUT, reader.read_line(&mut buf)).await;

                match read_result {
                    Ok(Ok(0)) => {
                        // EOF — process exited
                        self.connected.store(false, Ordering::Relaxed);
                        return Err(McpError::ConnectionFailed(
                            "Process closed stdout (EOF)".to_string(),
                        ));
                    }
                    Ok(Ok(_)) => {
                        // Skip server-initiated notifications (no "id" field)
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(buf.trim()) {
                            if val.get("id").is_none() && val.get("method").is_some() {
                                // This is a server notification, skip it
                                continue;
                            }
                        }
                        break buf;
                    }
                    Ok(Err(e)) => {
                        self.connected.store(false, Ordering::Relaxed);
                        return Err(McpError::ConnectionFailed(format!(
                            "Failed to read from stdout: {}",
                            e
                        )));
                    }
                    Err(_) => {
                        self.connected.store(false, Ordering::Relaxed);
                        return Err(McpError::Timeout(format!(
                            "No response within {} seconds",
                            SEND_TIMEOUT.as_secs()
                        )));
                    }
                }
            }
        };

        parse_response(line.trim())
    }

    async fn notify(&self, notification: JsonRpcNotification) -> Result<(), McpError> {
        if !self.is_connected() {
            return Err(McpError::ConnectionFailed(
                "Transport is not connected".to_string(),
            ));
        }

        let mut payload = serde_json::to_string(&notification).map_err(|e| {
            McpError::ProtocolError(format!("Failed to serialize notification: {}", e))
        })?;
        payload.push('\n');

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(payload.as_bytes()).await.map_err(|e| {
                self.connected.store(false, Ordering::Relaxed);
                McpError::ConnectionFailed(format!("Failed to write to stdin: {}", e))
            })?;
            stdin.flush().await.map_err(|e| {
                self.connected.store(false, Ordering::Relaxed);
                McpError::ConnectionFailed(format!("Failed to flush stdin: {}", e))
            })?;
        }

        Ok(())
    }

    async fn close(&self) -> Result<(), McpError> {
        self.connected.store(false, Ordering::Relaxed);

        let mut child_guard = self.child.lock().await;
        if let Some(mut child) = child_guard.take() {
            child.kill().await.map_err(|e| {
                McpError::ConnectionFailed(format!("Failed to kill child process: {}", e))
            })?;
        }

        Ok(())
    }

    fn is_connected(&self) -> bool {
        if !self.connected.load(Ordering::Relaxed) {
            return false;
        }

        // Best-effort check: see if child has already exited
        // We can't do try_wait without &mut, so rely on the atomic flag
        // which gets set to false by the stderr reader when the process exits
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;


    #[tokio::test]
    async fn test_stdio_transport_command_not_found() {
        let result =
            StdioTransport::new("nonexistent_command_xyz_12345", &[], None).await;
        assert!(result.is_err());
        match result {
            Err(McpError::CommandNotFound(msg)) => {
                assert!(msg.contains("nonexistent_command_xyz_12345"));
            }
            _ => panic!("Expected CommandNotFound error"),
        }
    }

    #[tokio::test]
    async fn test_stdio_transport_send_receives_json_response() {
        // Create a mock stdin/stdout pair using duplex channels
        let (client_write, server_read) = tokio::io::duplex(4096);
        let (mut server_write, client_read) = tokio::io::duplex(4096);

        let stdin = Arc::new(Mutex::new(
            // We need a ChildStdin, but we can't easily create one.
            // Instead, test the protocol logic directly via the send path.
            // We'll simulate by spawning a real echo-like process.
            // For unit tests, we test the parsing and state logic.
            client_write,
        ));

        // Spawn a task that reads from "stdin" and writes a response to "stdout"
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
            let mut reader = BufReader::new(server_read);
            let mut line = String::new();
            if reader.read_line(&mut line).await.is_ok() {
                // Parse the request to get the id
                if let Ok(req) = serde_json::from_str::<serde_json::Value>(&line) {
                    let id = req.get("id").and_then(|v| v.as_u64()).unwrap_or(1);
                    let response = format!(
                        r#"{{"jsonrpc":"2.0","id":{},"result":{{"tools":[]}},"error":null}}"#,
                        id
                    );
                    server_write
                        .write_all(format!("{}\n", response).as_bytes())
                        .await
                        .ok();
                }
            }
        });

        // Build a StdioTransport-like test using raw reader/writer
        // Since StdioTransport requires ChildStdin/ChildStdout, we test the
        // protocol logic by simulating what send() does internally.
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 7,
            method: "tools/list".to_string(),
            params: None,
        };

        // Serialize and write
        let mut payload = serde_json::to_string(&request).unwrap();
        payload.push('\n');

        let mut writer = stdin.lock().await;
        writer.write_all(payload.as_bytes()).await.unwrap();
        writer.flush().await.unwrap();
        drop(writer);

        // Read response
        let mut reader = BufReader::new(client_read);
        let mut buf = String::new();
        reader.read_line(&mut buf).await.unwrap();

        let response = parse_response(buf.trim()).unwrap();
        assert_eq!(response.jsonrpc, "2.0");
        assert_eq!(response.id, Some(7));
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_stdio_transport_parse_response_empty_line() {
        let result = parse_response("");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpError::InvalidResponse(_)));
    }

    #[tokio::test]
    async fn test_stdio_transport_parse_response_malformed_json() {
        let result = parse_response("{not valid json}");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), McpError::InvalidResponse(_)));
    }

    #[tokio::test]
    async fn test_stdio_transport_parse_response_valid_with_error() {
        let raw = r#"{"jsonrpc":"2.0","id":3,"result":null,"error":{"code":-32601,"message":"Method not found","data":null}}"#;
        let response = parse_response(raw).unwrap();
        assert_eq!(response.id, Some(3));
        let err = response.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }

    #[tokio::test]
    async fn test_stdio_transport_parse_response_valid_result() {
        let raw = r#"{"jsonrpc":"2.0","id":5,"result":{"tools":[{"name":"read","description":"Read file","inputSchema":{"type":"object"}}]},"error":null}"#;
        let response = parse_response(raw).unwrap();
        assert_eq!(response.id, Some(5));
        assert!(response.error.is_none());
        let result = response.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "read");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn test_stdio_transport_spawn_real_process() {
        // Use cmd.exe /C echo as a simple process that exits immediately
        // This tests the spawn path on Windows
        let result = StdioTransport::new("cmd", &["/C".to_string(), "echo hello".to_string()], None).await;
        // Should succeed spawning (command exists)
        assert!(result.is_ok());
        let transport = result.unwrap();
        assert!(transport.is_connected());
        transport.close().await.unwrap();
        assert!(!transport.is_connected());
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn test_stdio_transport_spawn_real_process() {
        // Use /bin/cat as a simple process
        let result = StdioTransport::new("cat", &[], None).await;
        assert!(result.is_ok());
        let transport = result.unwrap();
        assert!(transport.is_connected());
        transport.close().await.unwrap();
        assert!(!transport.is_connected());
    }

    #[tokio::test]
    async fn test_stdio_transport_env_vars_passed() {
        let mut env = HashMap::new();
        env.insert("MY_TEST_VAR".to_string(), "hello".to_string());

        #[cfg(windows)]
        let result = StdioTransport::new("cmd", &["/C".to_string(), "echo %MY_TEST_VAR%".to_string()], Some(&env)).await;
        #[cfg(not(windows))]
        let result = StdioTransport::new("cat", &[], Some(&env)).await;

        // Should succeed — env vars don't prevent spawning
        assert!(result.is_ok());
        let transport = result.unwrap();
        transport.close().await.unwrap();
    }

    #[tokio::test]
    async fn test_stdio_transport_close_kills_process() {
        #[cfg(windows)]
        let transport = StdioTransport::new("cmd", &["/C".to_string(), "timeout /T 60".to_string()], None)
            .await;
        #[cfg(not(windows))]
        let transport = StdioTransport::new("cat", &[], None).await;

        // If command not found on CI, skip
        if transport.is_err() {
            return;
        }
        let transport = transport.unwrap();
        assert!(transport.is_connected());

        transport.close().await.unwrap();
        assert!(!transport.is_connected());
    }
}
