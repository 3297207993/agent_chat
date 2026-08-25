use std::path::Path;

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
        // 阻止设备路径（用原始路径检查：规范化对设备路径无意义且可能失败）
        let raw = path.replace('/', "\\");
        if raw.starts_with(r"\\.\") || raw.starts_with(r"\\?\") {
            return Err("禁止访问设备路径".to_string());
        }

        // 规范化：解析 `..` 与符号链接/junction，防绕过
        // canonicalize 在 Windows 上会返回 `\\?\C:\...` verbatim 前缀，需去除
        let normalized = normalize_existing(path)
            .replace('/', "\\")
            .to_lowercase()
            .trim_start_matches(r"\\?\")
            .to_string();
        // Path::starts_with 按组件逐段比较，天然有路径边界语义，
        // 且两边都已小写化，规避其大小写敏感的问题
        let normalized = Path::new(&normalized);

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
            if normalized.starts_with(Path::new(prefix)) {
                return Err("禁止访问系统目录".to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // 规范化：解析符号链接与 `..`（如 /etc → /private/etc），防绕过
        let normalized = normalize_existing(path);
        let normalized = Path::new(&normalized);

        let blocked_prefixes = [
            "/System",
            "/Library",
            "/usr",
            "/bin",
            "/sbin",
            "/etc",
            "/var",
            "/Applications",
            "/private",
            "/dev",
        ];
        for prefix in &blocked_prefixes {
            if normalized.starts_with(Path::new(prefix)) {
                return Err("禁止访问系统目录".to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let normalized = normalize_existing(path);
        let normalized = Path::new(&normalized);

        let blocked_prefixes = [
            "/etc",
            "/usr",
            "/bin",
            "/sbin",
            "/lib",
            "/lib64",
            "/proc",
            "/sys",
            "/boot",
            "/root",
            "/var",
            "/dev",
        ];
        for prefix in &blocked_prefixes {
            if normalized.starts_with(Path::new(prefix)) {
                return Err("禁止访问系统目录".to_string());
            }
        }
    }

    Ok(())
}

/// 规范化路径：路径存在时解析符号链接与 `..`，不存在时原样返回。
/// 保持"路径不存在也通过检查"的原有语义。
fn normalize_existing(path: &str) -> String {
    match std::fs::canonicalize(path) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => path.to_string(),
    }
}
