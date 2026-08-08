use super::CommandResult;
use serde::Serialize;
use tokio::time::{timeout, Duration};

/// 脚本执行结果（与 CommandResult 分离，脚本需要双流 + 退出码）。
#[derive(Serialize)]
pub struct ScriptResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

const MAX_OUTPUT_CHARS: usize = 200_000;

/// 截断过大的输出，防止模型上下文被撑爆。
fn truncate(s: String) -> String {
    if s.chars().count() > MAX_OUTPUT_CHARS {
        format!("{}（输出过长，已截断）", s.chars().take(MAX_OUTPUT_CHARS).collect::<String>())
    } else {
        s
    }
}

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

/// 执行脚本（Skill 配套脚本专用）。
///
/// 与 `execute_command` 的区别：
/// - 入参是完整的 argv 数组（无 shell 拼接，防注入）
/// - `cwd` 必填（由前端推导为 skill 目录）
/// - 返回结构化结果（stdout / stderr / exit_code / timed_out）
/// - 超时后通过 `kill_on_drop` 终止子进程
#[tauri::command]
pub async fn execute_script(
    argv: Vec<String>,
    cwd: String,
    timeout_secs: Option<u64>,
) -> Result<ScriptResult, String> {
    if argv.is_empty() {
        return Err("argv 不能为空".to_string());
    }
    if cwd.trim().is_empty() {
        return Err("cwd 不能为空".to_string());
    }

    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(60));

    let mut cmd = tokio::process::Command::new(&argv[0]);
    cmd.args(&argv[1..])
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let child = cmd.spawn().map_err(|e| format!("启动脚本失败: {}", e))?;

    let result = timeout(timeout_duration, child.wait_with_output()).await;

    match result {
        Ok(Ok(output)) => {
            let exit_code = output.status.code().unwrap_or(-1);
            Ok(ScriptResult {
                stdout: truncate(String::from_utf8_lossy(&output.stdout).to_string()),
                stderr: truncate(String::from_utf8_lossy(&output.stderr).to_string()),
                exit_code,
                timed_out: false,
            })
        }
        Ok(Err(e)) => Err(format!("脚本执行失败: {}", e)),
        Err(_) => {
            // 超时：child 已被 wait_with_output 消耗，但 kill_on_drop 会在其离开作用域时终止进程
            Ok(ScriptResult {
                stdout: String::new(),
                stderr: "脚本执行超时（进程已被终止）".to_string(),
                exit_code: -1,
                timed_out: true,
            })
        }
    }
}
