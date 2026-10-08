//! The commands the WebView may invoke.
//!
//! Every one of them is a thin translation step: this crate holds no policy, decides no verdict and
//! interprets no method name. What it does own is the seam — turning port calls into Tauri commands,
//! and turning the backend's own calls into an event plus a `respond` command
//! (docs/design/tauri-plugin-cambia.md).

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use cambia_plugin_host::error_codes::ErrorCode;
use cambia_plugin_host::process::{
  Backend, CommandTarget, HostInfo, RestartPolicy as SupervisorRestartPolicy, SpawnSpec,
  StartError, StartPolicy,
};
use cambia_plugin_host::protocol::{numeric_for, ErrorObject};
use cambia_plugin_host::transport::{CallError, Dispatch, InboundResult};
use tauri::{command, AppHandle, Emitter, Runtime, State, Webview};
use tokio::sync::oneshot;

use crate::models::{
  BackendCall, BinTarget, CallRequest, CallResponse, ExitReason, KillRequest, ModuleUrlRequest,
  ModuleUrlResponse, RespondRequest, SpawnRequest, SpawnResponse,
};
use crate::runtime::{CambiaRuntime, BACKEND_CALL_EVENT};
use crate::{Error, PluginRoot, Result};

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

/// `spawn` — start a backend and answer once it is **ready**.
///
/// The waiting is the point: it returns after the `$/initialize` handshake, or fails with the code that
/// says why not (`PROCESS_SPAWN_FAILED`, `PROCESS_START_TIMEOUT`, `PROTOCOL_VERSION_UNSUPPORTED`). TS
/// therefore never has to poll a status to find out whether its backend came up
/// (docs/design/plugin-host.md).
#[command]
pub(crate) async fn spawn<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, CambiaRuntime>,
  payload: SpawnRequest,
) -> Result<SpawnResponse> {
  let package = app.package_info().clone();

  let spec = SpawnSpec {
    plugin: payload.plugin_id.clone(),
    plugin_version: payload.plugin_version,
    target: match payload.bin {
      BinTarget::Path(path) => CommandTarget::Relative(path),
      BinTarget::Argv(argv) => CommandTarget::Argv(argv),
    },
    root: PathBuf::from(&payload.root),
    host: HostInfo {
      name: package.name.clone(),
      version: package.version.to_string(),
    },
  };

  let policy = StartPolicy {
    start_timeout: Duration::from_millis(payload.start_timeout_ms),
    restart: SupervisorRestartPolicy {
      max_attempts: payload.restart.max_attempts,
      base_delay: Duration::from_millis(payload.restart.base_delay_ms),
      max_delay: Duration::from_millis(payload.restart.max_delay_ms),
      jitter: payload.restart.jitter.unwrap_or(true),
    },
  };

  let backend = state
    .supervisor
    .start(spec, policy)
    .await
    .map_err(|error: StartError| Error::Backend {
      code: error.code,
      message: error.message,
    })?;

  let response = SpawnResponse {
    plugin_id: backend.id.plugin.clone(),
    generation: backend.id.generation,
    protocol_version: backend.protocol_version,
    stderr_path: backend
      .stderr_path
      .as_ref()
      .map(|path| path.to_string_lossy().into_owned()),
  };

  route_backend_calls(&app, &state, &backend);
  state
    .backends
    .lock()
    .unwrap()
    .insert(backend.id.plugin.clone(), backend);

  Ok(response)
}

/// `kill` — ask a backend to leave, and report how it did. `null` means there was nothing running.
#[command]
pub(crate) async fn kill(
  state: State<'_, CambiaRuntime>,
  payload: KillRequest,
) -> Result<Option<ExitReason>> {
  let outcome = state
    .supervisor
    .stop(
      &payload.plugin_id,
      Duration::from_millis(payload.timeout_ms),
    )
    .await;

  state.backends.lock().unwrap().remove(&payload.plugin_id);

  Ok(match outcome {
    cambia_plugin_host::process::StopOutcome::Exited(reason) => Some(ExitReason {
      generation: reason.generation,
      code: reason.code,
      signal: reason.signal,
      expected: reason.expected,
    }),
    cambia_plugin_host::process::StopOutcome::NotRunning => None,
  })
}

/// `call` — call a backend method, with the frame loop, the timeout and the cancellation all on the
/// Rust side (docs/design/plugin-host.md's dedicated section).
#[command]
pub(crate) async fn call(
  state: State<'_, CambiaRuntime>,
  payload: CallRequest,
) -> Result<CallResponse> {
  let backend = {
    let backends = state.backends.lock().unwrap();
    backends.get(&payload.plugin_id).cloned()
  };

  let backend = backend.ok_or_else(|| Error::NoSuchBackend(payload.plugin_id.clone()))?;

  // A call aimed at an older instance must not land on the current one: they are different processes
  // with different state, and "which generation" is exactly what the caller was told.
  if backend.id.generation != payload.generation {
    return Err(Error::NoSuchBackend(format!(
      "{}#{} (the running instance is generation {})",
      payload.plugin_id, payload.generation, backend.id.generation
    )));
  }

  let result = backend
    .transport
    .call(
      &payload.method,
      payload.params,
      Duration::from_millis(payload.timeout_ms),
    )
    .await
    .map_err(|error: CallError| Error::Backend {
      code: error.code,
      message: error.message,
    })?;

  Ok(CallResponse { result })
}

/// `respond` — the host's answer to a call a backend made.
///
/// Unknown ids are ignored: the call already timed out, and reporting an error for a late answer would
/// punish the host for being slow rather than for being wrong.
#[command]
pub(crate) fn respond(state: State<'_, CambiaRuntime>, payload: RespondRequest) -> Result<()> {
  let Some(sender) = state.calls.lock().unwrap().remove(&payload.call_id) else {
    return Ok(());
  };

  let answer: InboundResult = match (payload.result, payload.error) {
    (Some(result), None) => Ok(result),
    (None, Some(error)) => Err(error_object(&error.code, error.message)),
    _ => Err(ErrorObject::from_code(
      ErrorCode::ProtocolInvalidParams,
      "respond needs exactly one of result / error",
    )),
  };

  let _ = sender.send(answer);
  Ok(())
}

/// Turn the backend's calls into events, and let `respond` answer them.
///
/// A call cannot come back in a command's return value — it is a different request — so the adapter
/// hands it over as an event and holds the answer slot itself. The timeout is counted **here**, not in
/// JS: a host whose WebView is busy must still be able to tell the backend that it gave up
/// (docs/design/tauri-plugin-cambia.md).
fn route_backend_calls<R: Runtime>(
  app: &AppHandle<R>,
  state: &State<'_, CambiaRuntime>,
  backend: &Backend,
) {
  let calls = Arc::clone(&state.calls);
  let counter = state.next_call_id();
  let inbound_timeout = state.inbound_timeout;
  let app = app.clone();
  let plugin_id = backend.id.plugin.clone();
  let generation = backend.id.generation;

  backend.transport.set_dispatch(Dispatch {
    request: Arc::new(move |method, params| {
      let calls = Arc::clone(&calls);
      let counter_handle = Arc::clone(&counter);
      let app = app.clone();
      let plugin_id = plugin_id.clone();

      Box::pin(async move {
        let call_id = counter_handle.fetch_add(1, Ordering::SeqCst);

        let (sender, receiver) = oneshot::channel();
        calls.lock().unwrap().insert(call_id, sender);

        let event = BackendCall {
          call_id,
          plugin_id: plugin_id.clone(),
          generation,
          method: method.clone(),
          params: params.clone(),
        };

        if let Err(error) = app.emit(BACKEND_CALL_EVENT, event) {
          calls.lock().unwrap().remove(&call_id);
          return Err(ErrorObject::from_code(
            ErrorCode::ProtocolInternalError,
            format!("the host could not be reached for \"{method}\": {error}"),
          ));
        }

        match tokio::time::timeout(inbound_timeout, receiver).await {
          Ok(Ok(answer)) => answer,
          // The sender is dropped when the runtime goes away.
          Ok(Err(_)) => Err(ErrorObject::from_code(
            ErrorCode::ProcessExited,
            "the host went away with this call in flight",
          )),
          Err(_) => {
            calls.lock().unwrap().remove(&call_id);
            Err(ErrorObject::from_code(
              ErrorCode::ProtocolCallTimeout,
              format!("\"{method}\" was not answered by the host within {inbound_timeout:?}"),
            ))
          }
        }
      })
    }),
    // Notifications from a backend have nowhere to go yet: v1 defines none that the host must act on.
    notification: Arc::new(|_, _| {}),
  });
}

/// An `ErrorObject` for a code the host sent as a string, keeping the numeric classification the spec
/// assigns when the code is one we know.
fn error_object(code: &str, message: String) -> ErrorObject {
  match ErrorCode::ALL
    .iter()
    .copied()
    .find(|known| known.as_str() == code)
  {
    Some(known) => ErrorObject {
      code: numeric_for(known),
      message,
      data_code: Some(known.as_str().to_string()),
    },
    // An unknown code still travels as itself: the backend may be newer than this host, and flattening
    // it to "internal error" would throw away the only useful part.
    None => ErrorObject {
      code: -32603,
      message,
      data_code: Some(code.to_string()),
    },
  }
}
