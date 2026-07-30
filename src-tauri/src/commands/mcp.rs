use tauri::AppHandle;
use tauri::State;
use tokio::sync::Mutex;

use crate::mcp::pool::McpPool;
use crate::mcp::stdio::McpProcess;

/// 连接一个 stdio 类型的 MCP Server。
///
/// 启动指定命令的子进程，并将 stdin/stdout 通过 Tauri 事件与前端通信。
#[tauri::command]
pub async fn mcp_connect_stdio(
    app: AppHandle,
    state: State<'_, Mutex<McpPool>>,
    id: String,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    // 检查是否已存在（短暂持有锁）
    {
        let pool = state.lock().await;
        if pool.contains(&id) {
            return Err(format!("MCP Server '{}' 已连接", id));
        }
    }

    let process = McpProcess::spawn(app, id.clone(), command, args).await?;

    {
        let mut pool = state.lock().await;
        pool.insert(id, process);
    }

    Ok(())
}

/// 向指定 MCP Server 的 stdin 写入数据。
#[tauri::command]
pub async fn mcp_stdin_write(
    state: State<'_, Mutex<McpPool>>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut pool = state.lock().await;
    let process = pool
        .get_mut(&id)
        .ok_or_else(|| format!("MCP Server '{}' 未连接", id))?;
    process.write(&data).await
}

/// 断开指定 MCP Server 的连接（kill 进程并清理）。
#[tauri::command]
pub async fn mcp_disconnect(
    state: State<'_, Mutex<McpPool>>,
    id: String,
) -> Result<(), String> {
    let mut pool = state.lock().await;
    if let Some(mut process) = pool.remove(&id) {
        process.kill().await?;
    }
    Ok(())
}

/// 获取所有已连接的 MCP Server ID 列表。
#[tauri::command]
pub async fn mcp_list_connections(
    state: State<'_, Mutex<McpPool>>,
) -> Result<Vec<String>, String> {
    let pool = state.lock().await;
    Ok(pool.processes.keys().cloned().collect())
}
