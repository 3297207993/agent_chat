use super::security;
use super::CommandResult;
use std::path::Path;

/// 读取文件内容（文本模式）。
#[tauri::command]
pub async fn read_file(path: String) -> Result<CommandResult, String> {
    security::check_path(&path)?;

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    Ok(CommandResult {
        success: true,
        content,
        error: None,
    })
}

/// 创建新文件或覆盖写入已有文件。
/// 会自动创建不存在的父目录。
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<CommandResult, String> {
    security::check_path(&path)?;

    // 创建父目录
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    let bytes = content.len();
    std::fs::write(&path, &content).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(CommandResult {
        success: true,
        content: format!("文件已写入 ({} 字节)", bytes),
        error: None,
    })
}

/// 精确替换文件中指定的文本片段。
/// 执行逻辑：读取 → 替换 → 写入。
#[tauri::command]
pub async fn edit_file(
    path: String,
    old_string: String,
    new_string: String,
) -> Result<CommandResult, String> {
    security::check_path(&path)?;

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let new_content = content.replace(&old_string, &new_string);

    if new_content == content {
        return Err("未找到匹配的文本，替换失败".to_string());
    }

    std::fs::write(&path, &new_content).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(CommandResult {
        success: true,
        content: "文本已替换".to_string(),
        error: None,
    })
}

/// 删除文件或目录。
/// 文件直接删除，目录递归删除。
/// 注意：不经过回收站，请谨慎使用。
#[tauri::command]
pub async fn delete_file(path: String) -> Result<CommandResult, String> {
    security::check_path(&path)?;

    let meta = std::fs::metadata(&path).map_err(|e| format!("访问文件失败: {}", e))?;

    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("删除目录失败: {}", e))?;
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))?;
    }

    Ok(CommandResult {
        success: true,
        content: "已删除".to_string(),
        error: None,
    })
}

/// 递归复制文件或目录到目标位置。
///
/// - src 为文件时：复制到 dst（dst 为完整目标文件路径）
/// - src 为目录时：递归复制整棵树到 dst（dst 为目标目录，不存在则创建）
/// - dst 已存在时：先删除再复制（覆盖语义，用于 skill 导入/导出更新）
#[tauri::command]
pub async fn copy_directory(
    src: String,
    dst: String,
) -> Result<CommandResult, String> {
    security::check_path(&src)?;
    security::check_path(&dst)?;

    if src == dst {
        return Err("源路径与目标路径相同".to_string());
    }

    let src_meta = std::fs::metadata(&src).map_err(|e| format!("访问源路径失败: {}", e))?;

    if src_meta.is_dir() {
        // 覆盖语义：目标已存在先删除
        if Path::new(&dst).exists() {
            std::fs::remove_dir_all(&dst).map_err(|e| format!("清理目标目录失败: {}", e))?;
        }
        std::fs::create_dir_all(&dst).map_err(|e| format!("创建目标目录失败: {}", e))?;
        copy_tree(Path::new(&src), Path::new(&dst))?;
    } else {
        if let Some(parent) = Path::new(&dst).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败: {}", e))?;
            }
        }
        std::fs::copy(&src, &dst).map_err(|e| format!("复制文件失败: {}", e))?;
    }

    Ok(CommandResult {
        success: true,
        content: format!("已复制到: {}", dst),
        error: None,
    })
}

/// 递归复制目录树（内部函数）。
fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            std::fs::create_dir_all(&dst_path)
                .map_err(|e| format!("创建目录失败: {}", e))?;
            copy_tree(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

/// 列出目录内容，支持可选的 glob 过滤。
#[tauri::command]
pub async fn list_directory(
    path: String,
    glob: Option<String>,
) -> Result<CommandResult, String> {
    security::check_path(&path)?;

    if let Some(pattern) = glob {
        // 使用 glob 模式
        let full_pattern = format!(
            "{}/{}",
            path.trim_end_matches('/').trim_end_matches('\\'),
            pattern
        );

        let mut results: Vec<String> = Vec::new();
        for entry in glob::glob(&full_pattern).map_err(|e| format!("glob 模式错误: {}", e))? {
            match entry {
                Ok(p) => results.push(p.to_string_lossy().to_string()),
                Err(e) => results.push(format!("<错误: {}>", e)),
            }
        }

        return Ok(CommandResult {
            success: true,
            content: results.join("\n"),
            error: None,
        });
    }

    // 普通目录列表
    let mut entries: Vec<String> = Vec::new();
    let dir = std::fs::read_dir(&path).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in dir {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if is_dir {
            entries.push(format!("{}/", name));
        } else {
            entries.push(name);
        }
    }

    entries.sort();
    Ok(CommandResult {
        success: true,
        content: entries.join("\n"),
        error: None,
    })
}
