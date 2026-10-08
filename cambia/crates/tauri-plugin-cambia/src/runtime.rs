//! What the adapter holds while the application runs: one supervisor, the backends it started, and the
//! calls the backend is waiting on the host to answer.
//!
//! Kept apart from `lib.rs` so the shape is visible: **this crate owns no policy and no kernel
//! semantics** — it holds the pieces the kernel implementation layer needs in order to be reachable
//! from the WebView, and nothing else (docs/design/tauri-plugin-cambia.md).

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cambia_plugin_host::process::Supervisor;
use cambia_plugin_host::transport::InboundResult;
use tokio::sync::oneshot;

/// The event a backend's own call is delivered to the host on.
///
/// A call cannot travel in a command's return value — it is a different request — so the adapter turns
/// it into an event and waits for the `respond` command to answer it
/// (docs/design/tauri-plugin-cambia.md). `callId` is allocated here and only means anything inside the
/// application.
pub const BACKEND_CALL_EVENT: &str = "cambia://backend-call";

/// The adapter's runtime state.
pub struct CambiaRuntime {
  /// The process supervisor. It owns the children; this crate only asks.
  pub supervisor: Supervisor,
  /// The newest ready backend per plugin. **A view for serving `call`**, not the authority: the
  /// process table inside `Supervisor` is (docs/design/plugin-host.md).
  pub backends: Mutex<HashMap<String, cambia_plugin_host::process::Backend>>,
  /// Inbound calls the backend is waiting for the host to answer, keyed by `callId`.
  pub calls: Arc<Mutex<HashMap<u64, oneshot::Sender<InboundResult>>>>,
  /// Allocator for `callId`.
  pub next_call_id: Arc<AtomicU64>,
  /// How long the host may take to answer a backend's call before the backend is told it timed out.
  pub inbound_timeout: Duration,
}

impl CambiaRuntime {
  /// Build the state around a supervisor the caller already made.
  ///
  /// Sharing it matters: the exit hook and the commands must act on the **same** process table, or
  /// reclaiming would find nothing to reclaim.
  pub fn new(supervisor: Supervisor) -> Self {
    Self {
      supervisor,
      backends: Mutex::new(HashMap::new()),
      calls: Arc::new(Mutex::new(HashMap::new())),
      next_call_id: Arc::new(AtomicU64::new(1)),
      inbound_timeout: Duration::from_secs(30),
    }
  }

  /// The next `callId` for an inbound call.
  pub fn next_call_id(&self) -> Arc<AtomicU64> {
    Arc::clone(&self.next_call_id)
  }
}
