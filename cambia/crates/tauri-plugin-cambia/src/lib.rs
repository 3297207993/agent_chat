//! Tauri adapter for Cambia: the wiring that turns Tauri's protocols and paths into the ports the
//! Cambia host declares.
//!
//! Scope, and what keeps it honest: this crate does the four things implementation.md 3.3(g) lists and
//! nothing else — hand the plugin directory to Tauri's `asset:` protocol, pass the host's I/O into the
//! kernel, expose the command set with its `permissions/` files, and reclaim backend processes on exit.
//! No kernel semantics live here: deleting this whole crate must leave `@cambia/host` and
//! `cambia-plugin-host` working and tested (CONTRIBUTING hard rule 3). It is its own workspace with its
//! own CI track for the dull reason that Tauri's three-platform build is slow.
//!
//! Wired today is the minimum the load path needs: the plugin root, the `asset:` scope allow-list, and
//! the `module_url` command. `read_text` / `list_installed` / `install` arrive with K2.5, `spawn` /
//! `kill` / `call` and exit reclamation with K2.6 — none of them are stubbed here, because a seam with
//! no caller is a claim nobody verifies (docs/design/tauri-plugin-cambia.md).

use std::path::PathBuf;

use cambia_plugin_host::process::{Supervisor, SupervisorConfig};
use tauri::{
  plugin::{Builder as PluginBuilder, TauriPlugin},
  Manager, RunEvent, Runtime,
};

mod commands;
mod error;
mod models;
mod root;
mod runtime;

pub use error::{Error, Result};
pub use models::{
  BackendCall, BinTarget, CallRequest, CallResponse, ExitReason, KillRequest, ModuleUrlRequest,
  ModuleUrlResponse, RespondError, RespondRequest, RestartPolicy, SpawnRequest, SpawnResponse,
};
pub use root::PluginRoot;
pub use runtime::{CambiaRuntime, BACKEND_CALL_EVENT};

/// The plugin's configuration.
#[derive(Debug, Default)]
pub struct Builder {
  root: Option<PathBuf>,
  log_dir: Option<PathBuf>,
}

impl Builder {
  /// A builder with no plugin root yet — see [`Builder::plugin_root`] for why one is required.
  pub fn new() -> Self {
    Self::default()
  }

  /// The directory the installed plugins live in.
  ///
  /// Required, and deliberately without a default: **where** the directory is, is the host
  /// application's decision, while **what the layout inside it is** belongs to `cambia-plugin-host`
  /// (docs/design/plugin-host.md). A default computed here would be a second authority for something
  /// that has to have exactly one, and the two would drift the first time either side moved.
  pub fn plugin_root(mut self, root: impl Into<PathBuf>) -> Self {
    self.root = Some(root.into());
    self
  }

  /// Where the backends' `stderr` goes, as `<log_dir>/<plugin>/<generation>.log`.
  ///
  /// Optional, and never a substitute for draining: the stream is read either way, because a backend
  /// that writes more than the pipe holds would otherwise block forever on a full buffer.
  pub fn log_dir(mut self, dir: impl Into<PathBuf>) -> Self {
    self.log_dir = Some(dir.into());
    self
  }

  /// Build the Tauri plugin.
  pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
    let root_config = self.root;
    let supervisor = Supervisor::new(SupervisorConfig {
      log_dir: self.log_dir,
      ..SupervisorConfig::default()
    });
    // The exit hook and the commands must share one supervisor: reclaiming can only find what the
    // commands actually started.
    let supervisor_for_exit = supervisor.clone();

    PluginBuilder::new("cambia")
      .invoke_handler(tauri::generate_handler![
        commands::module_url,
        commands::spawn,
        commands::kill,
        commands::call,
        commands::respond
      ])
      .setup(move |app, _api| {
        let root = root_config.ok_or(Error::MissingPluginRoot)?;

        // `asset:` is what lets a file on disk become something `import()` can fetch. The scope is
        // extended here, at runtime, because the root is only known once the host has started
        // (implementation.md 3.2(e), fact 8). Recursive, because a plugin is a directory tree
        // (`<id>/<version>-<hash>/...`). The directory does not have to exist yet: the scope is a set
        // of patterns, and the install flow creates the directory later.
        app.asset_protocol_scope().allow_directory(&root, true)?;

        app.manage(PluginRoot::new(root));
        app.manage(CambiaRuntime::new(supervisor));
        Ok(())
      })
      .on_event(move |_app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
          // Fire and forget on purpose: the application is leaving and must not wait for a plugin that
          // will not cooperate. This is the *other* half of "no orphans" — the job object's
          // kill-on-close is the half that survives this hook never running at all
          // (implementation.md 3.3(e)).
          let supervisor = supervisor_for_exit.clone();
          tauri::async_runtime::spawn(async move { supervisor.reclaim_all().await });
        }
      })
      .build()
  }
}
