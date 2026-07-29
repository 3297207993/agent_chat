/// 路径安全检查。
///
/// - 阻止访问系统目录
/// - 阻止访问设备路径
/// - 允许普通路径正常通过（路径不存在也会通过检查，由具体命令处理）
pub fn check_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let normalized = path.replace('/', "\\").to_lowercase();

        let blocked_prefixes = [
            r"c:\windows",
            r"c:\program files",
            r"c:\program files (x86)",
            r"c:\boot",
            r"c:\system volume information",
            r"c:\$recycle.bin",
            r"c:\config.msi",
            r"c:\$winre_backup",
        ];
        for prefix in &blocked_prefixes {
            if normalized.starts_with(prefix) {
                return Err("禁止访问系统目录".to_string());
            }
        }

        // 阻止设备路径
        if normalized.starts_with(r"\\.\") || normalized.starts_with(r"\\?\") {
            return Err("禁止访问设备路径".to_string());
        }
    }

    Ok(())
}
