use super::security;
use super::CommandResult;

/// 按文件名模式搜索文件（glob）。
#[tauri::command]
pub async fn search_file(
    pattern: String,
    path: Option<String>,
) -> Result<CommandResult, String> {
    let search_path = path.unwrap_or_else(|| ".".to_string());
    security::check_path(&search_path)?;

    let full_pattern = format!(
        "{}/{}",
        search_path.trim_end_matches('/').trim_end_matches('\\'),
        pattern
    );

    let mut results: Vec<String> = Vec::new();
    for entry in glob::glob(&full_pattern).map_err(|e| format!("glob 模式错误: {}", e))? {
        match entry {
            Ok(p) => results.push(p.to_string_lossy().to_string()),
            Err(e) => results.push(format!("<错误: {}>", e)),
        }
    }

    Ok(CommandResult {
        success: true,
        content: results.join("\n"),
        error: None,
    })
}

/// 在文件内容中搜索文本或正则表达式（grep）。
#[tauri::command]
pub async fn search_content(
    pattern: String,
    path: Option<String>,
    glob: Option<String>,
) -> Result<CommandResult, String> {
    let search_path = path.unwrap_or_else(|| ".".to_string());
    security::check_path(&search_path)?;

    let re = regex::Regex::new(&pattern).map_err(|e| format!("正则表达式错误: {}", e))?;

    // 可选的 glob 文件过滤器
    let file_filter = glob.as_ref().and_then(|g| {
        glob::Pattern::new(g)
            .map_err(|e| format!("glob 模式错误: {}", e))
            .ok()
    });

    let mut results: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&search_path)
        .into_iter()
        .filter_entry(|e| !is_hidden_or_git(e))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let file_path = entry.path();

        // 应用文件过滤
        if let Some(ref filter) = file_filter {
            if let Some(name) = file_path.file_name().and_then(|n| n.to_str()) {
                if !filter.matches(name) {
                    continue;
                }
            }
        }

        // 读取文件并搜索
        if let Ok(content) = std::fs::read_to_string(file_path) {
            let file_display = file_path.to_string_lossy();
            for (line_no, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    results.push(format!("{}:{}:{}", file_display, line_no + 1, line.trim()));
                }
            }
        }
    }

    Ok(CommandResult {
        success: true,
        content: results.join("\n"),
        error: None,
    })
}

/// 判断目录项是否是隐藏目录或 .git。
fn is_hidden_or_git(entry: &walkdir::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    name == ".git" || name == "node_modules" || name.starts_with('.')
}
