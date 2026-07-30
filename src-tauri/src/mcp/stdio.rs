use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};

/// 一个 MCP stdio 进程实例。
pub struct McpProcess {
    /// 标准输入写入端
    pub stdin: ChildStdin,
    /// 子进程句柄，析构时自动 kill
    process: Child,
    /// server 标识
    pub id: String,
}

impl McpProcess {
    /// 启动一个 MCP Server 子进程。
    ///
    /// - 将 stdout 按行读取并通过 Tauri 事件 `mcp:{id}:stdout` 推送到前端
    /// - 将 stderr 按行读取并通过 Tauri 事件 `mcp:{id}:stderr` 推送到前端
    pub async fn spawn(
        app: AppHandle,
        id: String,
        command: String,
        args: Vec<String>,
    ) -> Result<Self, String> {
        let mut child = tokio::process::Command::new(&command)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 MCP Server 失败: {}", e))?;

        let stdin = child.stdin.take().ok_or("无法获取 stdin")?;
        let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
        let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

        // 后台任务：逐行读取 stdout → Tauri 事件
        let app_clone = app.clone();
        let id_for_stdout = id.clone();
        tokio::spawn(async move {
            Self::forward_stdout(app_clone, &id_for_stdout, stdout).await;
        });

        // 后台任务：逐行读取 stderr → Tauri 事件
        let id_for_stderr = id.clone();
        tokio::spawn(async move {
            Self::forward_stderr(app, &id_for_stderr, stderr).await;
        });

        Ok(Self {
            stdin,
            process: child,
            id,
        })
    }

    /// 向子进程的 stdin 写入一行数据。
    pub async fn write(&mut self, data: &str) -> Result<(), String> {
        self.stdin
            .write_all(data.as_bytes())
            .await
            .map_err(|e| format!("写入 stdin 失败: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("flush stdin 失败: {}", e))?;
        Ok(())
    }

    /// 强制终止子进程。
    pub async fn kill(&mut self) -> Result<(), String> {
        self.process
            .kill()
            .await
            .map_err(|e| format!("终止进程失败: {}", e))
    }

    /// 后台转发 stdout（逐行读取 → emit 事件）
    async fn forward_stdout(app: AppHandle, id: &str, stdout: ChildStdout) {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let event_name = format!("mcp:{}:stdout", id);

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app.emit(&event_name, line);
        }
    }

    /// 后台转发 stderr（逐行读取 → emit 事件）
    async fn forward_stderr(app: AppHandle, id: &str, stderr: ChildStderr) {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let event_name = format!("mcp:{}:stderr", id);

        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let _ = app.emit(&event_name, line);
        }
    }
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        // 尝试优雅关闭，忽略错误
        let _ = self.process.start_kill();
    }
}
