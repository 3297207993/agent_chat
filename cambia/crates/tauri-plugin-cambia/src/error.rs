use serde::{ser::SerializeStruct, ser::Serializer, Serialize};

use cambia_plugin_host::error_codes::ErrorCode;

/// The adapter's error type: the failures a command can report, plus the one setup failure a
/// misconfigured host hits at startup.
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
  #[error(transparent)]
  Tauri(#[from] tauri::Error),
  #[error("the path \"{0}\" is not a plugin-root-relative path")]
  InvalidPluginPath(String),
  #[error("the plugin root is not configured: call Builder::plugin_root()")]
  MissingPluginRoot,
  #[error("no backend is running for plugin \"{0}\"")]
  NoSuchBackend(String),
  /// A verdict from the kernel implementation layer, carrying the spec code with it.
  #[error("{code}: {message}")]
  Backend {
    /// The code from `spec/v1/error-codes.json`.
    code: ErrorCode,
    /// Human-readable detail.
    message: String,
  },
}

impl Error {
  /// The spec code this failure reports, when it has one.
  ///
  /// The TS side switches on codes rather than on prose (`packages/host/src/backend.ts`), so the code
  /// has to survive the trip; failures that have no code report `null` rather than a guess.
  pub fn spec_code(&self) -> Option<ErrorCode> {
    match self {
      Error::Backend { code, .. } => Some(*code),
      _ => None,
    }
  }
}

impl Serialize for Error {
  fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    // A structured error, not `to_string()`: the code is part of the contract with the host side.
    let mut error = serializer.serialize_struct("Error", 3)?;
    error.serialize_field("code", &self.spec_code().map(ErrorCode::as_str))?;
    error.serialize_field("message", &self.to_string())?;
    error.serialize_field("kind", &error_kind(self))?;
    error.end()
  }
}

/// A stable label for failures that have no spec code, so JS can tell them apart without parsing prose.
fn error_kind(error: &Error) -> &'static str {
  match error {
    Error::Tauri(_) => "tauri",
    Error::InvalidPluginPath(_) => "invalid-plugin-path",
    Error::MissingPluginRoot => "missing-plugin-root",
    Error::NoSuchBackend(_) => "no-such-backend",
    Error::Backend { .. } => "backend",
  }
}
