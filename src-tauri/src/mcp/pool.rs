use std::collections::HashMap;

use super::stdio::McpProcess;

/// MCP 进程连接池。
///
/// 以 `server_id → McpProcess` 的形式管理所有 stdio MCP 连接。
pub struct McpPool {
    pub processes: HashMap<String, McpProcess>,
}

impl McpPool {
    pub fn new() -> Self {
        Self {
            processes: HashMap::new(),
        }
    }

    /// 获取指定 server 的进程（可变引用）。
    pub fn get_mut(&mut self, id: &str) -> Option<&mut McpProcess> {
        self.processes.get_mut(id)
    }

    /// 插入新进程。
    pub fn insert(&mut self, id: String, process: McpProcess) {
        self.processes.insert(id, process);
    }

    /// 移除并返回进程（调用方负责 kill）。
    pub fn remove(&mut self, id: &str) -> Option<McpProcess> {
        self.processes.remove(id)
    }

    /// 是否包含指定 server。
    pub fn contains(&self, id: &str) -> bool {
        self.processes.contains_key(id)
    }

    /// 当前连接数。
    pub fn len(&self) -> usize {
        self.processes.len()
    }

    /// 是否为空。
    pub fn is_empty(&self) -> bool {
        self.processes.is_empty()
    }
}
