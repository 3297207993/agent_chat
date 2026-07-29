mod commands;

use commands::file::{delete_file, edit_file, list_directory, read_file, write_file};
use commands::search::{search_content, search_file};
use commands::shell::execute_command;
use commands::system::preview_url;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
