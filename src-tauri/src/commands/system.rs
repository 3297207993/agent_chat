use super::CommandResult;

/// 在系统默认浏览器中打开指定 URL。
///
/// Windows 平台使用 `cmd /c start <url>`。
#[tauri::command]
pub async fn preview_url(url: String) -> Result<CommandResult, String> {
    if url.trim().is_empty() {
        return Err("URL 不能为空".to_string());
    }

    // Windows: cmd /c start "" "url"
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| format!("打开 URL 失败: {}", e))?;

    Ok(CommandResult {
        success: true,
        content: format!("已打开: {}", url),
        error: None,
    })
}
