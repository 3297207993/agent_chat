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

/// What to run, in the two forms the manifest allows (kernel.md 3.3): a path relative to the install
/// root, or an argv whose `argv[0]` comes from `PATH`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum BinTarget {
  /// A relative path.
  Path(String),
  /// An argv: system interpreter plus a bundled script, for instance.
  Argv(Vec<String>),
}

/// The host's restart policy, as it arrives from TS.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartPolicy {
  /// Consecutive start attempts allowed before the episode is given up.
  pub max_attempts: u32,
  /// First backoff step.
  pub base_delay_ms: u64,
  /// Ceiling for one backoff step.
  pub max_delay_ms: u64,
  /// Spread the delay; absent means the supervisor's default applies.
  #[serde(default)]
  pub jitter: Option<bool>,
}

/// The arguments of the `spawn` command. This one waits: it answers once the backend is **ready**, or
/// with the code that says why it never got there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
  /// The plugin this backend belongs to.
  pub plugin_id: String,
  /// The plugin's own version, passed through to the handshake.
  pub plugin_version: String,
  /// What to run.
  pub bin: BinTarget,
  /// The install root a relative `bin` is resolved against.
  pub root: String,
  /// One budget for exec and the handshake together.
  pub start_timeout_ms: u64,
  /// How long a graceful stop may take before the tree is taken down.
  pub stop_timeout_ms: u64,
  /// Attempts and delays for the start.
  pub restart: RestartPolicy,
}

/// What a successful `spawn` answers with.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResponse {
  /// The plugin the backend belongs to.
  pub plugin_id: String,
  /// Which instance this is; monotonic per plugin.
  pub generation: u64,
  /// The protocol version the peer reported during the handshake.
  pub protocol_version: u32,
  /// Where this instance's stderr went, when logging is configured.
  pub stderr_path: Option<String>,
}

/// The arguments of the `kill` command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KillRequest {
  /// Which plugin's backend to stop.
  pub plugin_id: String,
  /// How long to wait for it to leave on its own.
  pub timeout_ms: u64,
}

/// How a backend exited.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitReason {
  /// Which instance this was.
  pub generation: u64,
  /// The exit code, when there was one.
  pub code: Option<i32>,
  /// The signal, on Unix, when there was one.
  pub signal: Option<i32>,
  /// `true` when the host asked for the exit — "stopped" rather than "crashed".
  pub expected: bool,
}

/// The arguments of the `call` command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallRequest {
  /// Which plugin's backend to call.
  pub plugin_id: String,
  /// Which instance; a late call must not land on a newer one.
  pub generation: u64,
  /// The backend's method name — host vocabulary, which this crate does not interpret.
  pub method: String,
  /// Whatever the method takes.
  pub params: serde_json::Value,
  /// Required: the protocol has no default timeout to fall back on (spec/v1/protocol.md §7).
  pub timeout_ms: u64,
}

/// What a successful `call` answers with.
#[derive(Debug, Serialize)]
pub struct CallResponse {
  /// The backend's result, verbatim.
  pub result: serde_json::Value,
}

/// The event payload a backend's own call arrives on (`cambia://backend-call`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCall {
  /// Allocated here; only meaningful inside the application.
  pub call_id: u64,
  /// Which plugin's backend is asking.
  pub plugin_id: String,
  /// Which instance is asking.
  pub generation: u64,
  /// The method the host must route.
  pub method: String,
  /// Whatever the method takes.
  pub params: serde_json::Value,
}

/// The arguments of the `respond` command: the host's answer to a backend call.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondRequest {
  /// The `callId` from the event.
  pub call_id: u64,
  /// The answer, when the host succeeded.
  #[serde(default)]
  pub result: Option<serde_json::Value>,
  /// The failure, when it did not.
  #[serde(default)]
  pub error: Option<RespondError>,
}

/// The failure half of a `respond` call.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondError {
  /// A spec code (`spec/v1/error-codes.json`) as a string.
  pub code: String,
  /// Human-readable detail.
  pub message: String,
}
