//! The plugin root, and the path rule that keeps the webview inside it.

use std::path::{Component, Path, PathBuf};

use crate::{Error, Result};

/// The directory the installed plugins live in, held as Tauri managed state.
#[derive(Debug, Clone)]
pub struct PluginRoot(PathBuf);

impl PluginRoot {
  /// Wrap a plugin root. The directory is allowed not to exist yet: the host may point at a location
  /// the install flow creates later, and Tauri's asset scope is a set of patterns rather than a
  /// snapshot of the filesystem.
  pub fn new(root: impl Into<PathBuf>) -> Self {
    Self(root.into())
  }

  /// The root itself.
  pub fn as_path(&self) -> &Path {
    &self.0
  }

  /// Resolve a plugin-root-relative path into an absolute one.
  ///
  /// Only [`Component::Normal`] segments are accepted, which rejects absolute paths, drive and UNC
  /// prefixes, `..`, `.` and a bare separator in a single check — including on Windows, where
  /// `a\..\b` would slip past a check that only looked for the string `..`. The manifest format
  /// already forbids all of these (kernel.md 3, enforced by K2.1), but a port that is safe only
  /// because its caller validated the input is a port nobody can test on its own.
  pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);

    if relative.is_empty()
      || !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
    {
      return Err(Error::InvalidPluginPath(relative.to_string()));
    }

    Ok(self.0.join(path))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn root() -> PluginRoot {
    PluginRoot::new(PathBuf::from("plugins-root"))
  }

  #[test]
  fn resolves_a_relative_path_under_the_root() {
    assert_eq!(
      root().resolve("frontend/main.js").unwrap(),
      PathBuf::from("plugins-root").join("frontend/main.js")
    );

    // A trailing separator names the same file, so it is not a containment problem. Rejecting it
    // would mean re-implementing the manifest's path *grammar* here (K2.1 already owns that), and two
    // grammars that can disagree are worse than one extra slash.
    assert_eq!(
      root().resolve("frontend/").unwrap(),
      PathBuf::from("plugins-root").join("frontend/")
    );
  }

  #[test]
  fn rejects_paths_that_leave_the_root() {
    for bad in [
      "..",
      "../outside.js",
      "frontend/../../outside.js",
      "",
      ".",
      "./frontend/main.js",
      "/absolute/main.js",
    ] {
      assert!(root().resolve(bad).is_err(), "\"{bad}\" must be rejected");
    }
  }

  #[cfg(windows)]
  #[test]
  fn rejects_windows_prefixes() {
    // Drive letters and UNC paths are `Component::Prefix` on Windows: they name something outside the
    // root no matter how the rest of the string looks.
    for bad in [
      "C:/outside.js",
      "C:outside.js",
      r"\\server\share\main.js",
      r"frontend\..\outside.js",
    ] {
      assert!(root().resolve(bad).is_err(), "\"{bad}\" must be rejected");
    }
  }

  #[test]
  fn keeps_every_accepted_path_under_the_root() {
    // The guarantee this port actually owes, and the one that has to hold on every platform: whatever
    // resolve() accepts stays inside the root. Strings like `C:/x` or `\\server\x`) are ordinary
    // filenames on Unix rather than escapes, so they may be accepted — as long as they stay inside.
    let root = root();
    for input in [
      "frontend/main.js",
      r"frontend\main.js",
      "C:/outside.js",
      r"\\server\share\main.js",
      "frontend/",
      "a.b-c_d/e.js",
    ] {
      if let Ok(resolved) = root.resolve(input) {
        assert!(
          resolved.starts_with(root.as_path()),
          "\"{input}\" resolved to {resolved:?}, which is outside the root"
        );
      }
    }
  }
}
