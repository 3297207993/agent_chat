mod commands;
mod mcp;

use commands::file::{delete_file, edit_file, list_directory, read_file, write_file};
use commands::mcp::{mcp_connect_stdio, mcp_disconnect, mcp_list_connections, mcp_stdin_write};
use commands::search::{search_content, search_file};
use commands::shell::execute_command;
use commands::system::preview_url;
use mcp::pool::McpPool;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(McpPool::new()))
        .invoke_handler(tauri::generate_handler![
            // 文件操作
            read_file,
            write_file,
            edit_file,
            delete_file,
            list_directory,
            // 搜索
            search_file,
            search_content,
            // Shell
            execute_command,
            // 系统
            preview_url,
            // MCP
            mcp_connect_stdio,
            mcp_stdin_write,
            mcp_disconnect,
            mcp_list_connections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
