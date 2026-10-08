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

use tauri::{
  plugin::{Builder as PluginBuilder, TauriPlugin},
  Manager, Runtime,
};

mod commands;
mod error;
mod models;
mod root;

pub use error::{Error, Result};
pub use models::{ModuleUrlRequest, ModuleUrlResponse};
pub use root::PluginRoot;

/// The plugin's configuration.
#[derive(Debug, Default)]
pub struct Builder {
  root: Option<PathBuf>,
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

  /// Build the Tauri plugin.
  pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
    PluginBuilder::new("cambia")
      .invoke_handler(tauri::generate_handler![commands::module_url])
      .setup(move |app, _api| {
        let root = self.root.ok_or(Error::MissingPluginRoot)?;

        // `asset:` is what lets a file on disk become something `import()` can fetch. The scope is
        // extended here, at runtime, because the root is only known once the host has started
        // (implementation.md 3.2(e), fact 8). Recursive, because a plugin is a directory tree
        // (`<id>/<version>-<hash>/...`). The directory does not have to exist yet: the scope is a set
        // of patterns, and the install flow creates the directory later.
        app.asset_protocol_scope().allow_directory(&root, true)?;

        app.manage(PluginRoot::new(root));
        Ok(())
      })
      .build()
  }
}
