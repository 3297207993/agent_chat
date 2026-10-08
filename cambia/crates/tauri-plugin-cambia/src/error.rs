use serde::{ser::Serializer, Serialize};

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
}

impl Serialize for Error {
  fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    serializer.serialize_str(self.to_string().as_ref())
  }
}
