use super::CommandResult;
use tauri::Manager;

/// 获取应用数据目录（appDataDir）。
///
/// Skill 模块使用 `{appDataDir}/skills/` 作为 skill 存储根目录。
#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> Result<CommandResult, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    Ok(CommandResult {
        success: true,
        content: dir.to_string_lossy().to_string(),
        error: None,
    })
}

/// 在系统默认浏览器中打开指定 URL。
///
/// - Windows 平台使用 `cmd /c start "" <url>`
/// - macOS 平台使用 `open <url>`
/// - Linux 及其他类 Unix 平台使用 `xdg-open <url>`
#[tauri::command]
pub async fn preview_url(url: String) -> Result<CommandResult, String> {
    if url.trim().is_empty() {
        return Err("URL 不能为空".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: cmd /c start "" "url"
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开 URL 失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: open "url"
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开 URL 失败: {}", e))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        // Linux 及其他类 Unix 平台: xdg-open "url"
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开 URL 失败: {}", e))?;
    }

    Ok(CommandResult {
        success: true,
        content: format!("已打开: {}", url),
        error: None,
    })
}
