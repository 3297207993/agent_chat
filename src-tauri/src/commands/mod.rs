pub mod file;
pub mod mcp;
pub mod search;
pub mod security;
pub mod shell;
pub mod system;

use serde::Serialize;

/// 所有命令的统一返回值类型。
/// 前端通过 `invoke<{ success: boolean; content: string; error?: string }>` 接收。
#[derive(Serialize)]
pub struct CommandResult {
    pub success: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
