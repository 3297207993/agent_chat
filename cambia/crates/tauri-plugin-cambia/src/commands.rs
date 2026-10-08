use tauri::{command, Runtime, State, Webview};

use crate::models::{ModuleUrlRequest, ModuleUrlResponse};
use crate::{PluginRoot, Result};

/// `module_url` — the adapter's half of the `moduleURL` port (docs/design/host.md).
///
/// The URL comes from Tauri ([`Webview::convert_file_src`]) rather than from a platform fork written
/// here: the scheme, the host part and the percent-encoding have to match what the protocol handler
/// accepts, and only Tauri knows its own rules (`http://asset.localhost/…` on Windows, `asset://…`
/// elsewhere, and `https://…` when the app uses the https scheme). K2.4 measures whether the `asset:`
/// route holds at all; if it does not, this function is the single place that changes.
///
/// Failures are handed over unwrapped. Telling "not allowed" from "not there" from "not JavaScript"
/// needs an explicit probe and an order, which is TS's job (K2.4); classifying twice would mean two
/// answers that can disagree.
#[command]
pub(crate) fn module_url<R: Runtime>(
  webview: Webview<R>,
  root: State<'_, PluginRoot>,
  payload: ModuleUrlRequest,
) -> Result<ModuleUrlResponse> {
  let path = root.resolve(&payload.path)?;
  let url = webview.convert_file_src(&path, None)?;

  Ok(ModuleUrlResponse { url })
}
