use serde::{Deserialize, Serialize};

/// The arguments of the `module_url` command: the TS side's `moduleURL(relPath)`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleUrlRequest {
  /// Plugin-root-relative and `/`-separated, exactly as the manifest declares it (kernel.md 3).
  pub path: String,
}

/// The result of the `module_url` command: something `import()` can fetch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleUrlResponse {
  /// Built by Tauri (see `commands::module_url`) — this crate never assembles a URL by hand, so the
  /// platform fork stays out of our code (implementation.md fact 7).
  pub url: String,
}
