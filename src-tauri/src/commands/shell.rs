use super::CommandResult;
use tokio::time::{timeout, Duration};

/// 执行 Shell 命令。
///
/// - Windows 平台使用 `cmd /C <command>`
/// - 可通过 `cwd` 指定工作目录
/// - `timeout_secs` 指定超时秒数（默认 30s），超时后返回错误
#[tauri::command]
pub async fn execute_command(
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<CommandResult, String> {
    if command.trim().is_empty() {
        return Err("命令不能为空".to_string());
    }

    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(30));

    let mut cmd = tokio::process::Command::new("cmd");
    cmd.args(["/C", &command])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(dir) = &cwd {
        if !dir.is_empty() {
            cmd.current_dir(dir);
        }
    }

    let child = cmd.spawn().map_err(|e| format!("启动命令失败: {}", e))?;

    let result = timeout(timeout_duration, child.wait_with_output()).await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            Ok(CommandResult {
                success: output.status.success(),
                content: stdout,
                error: if output.status.success() {
                    None
                } else {
                    Some(stderr)
                },
            })
        }
        Ok(Err(e)) => Err(format!("命令执行失败: {}", e)),
        Err(_) => {
            // 超时时无法安全地终止子进程（child 已被消耗），
            // 但返回超时错误告知用户
            Err("命令执行超时".to_string())
        }
    }
}
