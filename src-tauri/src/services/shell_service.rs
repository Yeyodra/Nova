use crate::models::ShellInfo;

pub fn detect_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    // PowerShell 7 (pwsh)
    if let Ok(path) = which::which("pwsh") {
        shells.push(ShellInfo {
            id: "pwsh".to_string(),
            name: "PowerShell 7".to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }

    // Windows PowerShell 5.1
    if let Ok(path) = which::which("powershell") {
        shells.push(ShellInfo {
            id: "powershell".to_string(),
            name: "Windows PowerShell".to_string(),
            path: path.to_string_lossy().to_string(),
        });
    }

    // Command Prompt
    let cmd_path = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
    shells.push(ShellInfo {
        id: "cmd".to_string(),
        name: "Command Prompt".to_string(),
        path: cmd_path,
    });

    // Git Bash — check hardcoded paths
    let git_bash_paths = [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ];
    let git_bash_found = git_bash_paths
        .iter()
        .find(|p| std::path::Path::new(p).exists());

    if let Some(path) = git_bash_found {
        shells.push(ShellInfo {
            id: "git-bash".to_string(),
            name: "Git Bash".to_string(),
            path: path.to_string(),
        });
    } else if let Ok(git_root) = std::env::var("GIT_INSTALL_ROOT") {
        let path = format!("{}\\bin\\bash.exe", git_root);
        if std::path::Path::new(&path).exists() {
            shells.push(ShellInfo {
                id: "git-bash".to_string(),
                name: "Git Bash".to_string(),
                path,
            });
        }
    }

    shells
}

pub fn get_shell_args(shell_id: &str) -> Vec<String> {
    match shell_id {
        "pwsh" | "powershell" => vec!["-NoLogo".to_string()],
        "cmd" => vec![],
        "git-bash" => vec!["--login".to_string(), "-i".to_string()],
        _ => vec![],
    }
}
