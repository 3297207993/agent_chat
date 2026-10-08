//! The mapping between the spec's platform vocabulary and the platform we are running on.
//!
//! `parts.backend.bin` is keyed by `<os>-<arch>`, then `<os>`, then `*` (kernel.md 3.3), while Rust
//! reports `windows | macos | linux` and `x86_64 | aarch64` through `std::env::consts`. The two
//! vocabularies differ on purpose — the spec's keys are written by plugin authors and stay short and
//! stable — so the translation is an explicit table rather than a string transformation. That is also
//! why it is unit-tested here (implementation.md 3.3(e): "this mapping must be unit tested").
//!
//! Picking the binary to run is not this module's business (that is K2.6, and it needs the manifest
//! model to look the key up in): this module only answers "which keys could match, in which order".

/// An operating system, in the spec's vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
  /// `win`
  Win,
  /// `mac`
  Mac,
  /// `linux`
  Linux,
}

/// A CPU architecture, in the spec's vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arch {
  /// `x64`
  X64,
  /// `arm64`
  Arm64,
}

impl Os {
  /// The key spelling kernel.md 3.3 pins down.
  pub const fn key(self) -> &'static str {
    match self {
      Os::Win => "win",
      Os::Mac => "mac",
      Os::Linux => "linux",
    }
  }
}

impl Arch {
  /// The key spelling kernel.md 3.3 pins down.
  pub const fn key(self) -> &'static str {
    match self {
      Arch::X64 => "x64",
      Arch::Arm64 => "arm64",
    }
  }
}

/// The running platform, or `None` when it is outside the spec's vocabulary.
///
/// `None` is not an error to report here: it means "no key can match", which the host turns into
/// "this plugin's backend is unsupported, do not guess a path" (kernel.md 3.3).
pub fn current() -> Option<(Os, Arch)> {
  let os = match std::env::consts::OS {
    "windows" => Os::Win,
    "macos" => Os::Mac,
    "linux" => Os::Linux,
    _ => return None,
  };

  let arch = match std::env::consts::ARCH {
    "x86_64" => Arch::X64,
    "aarch64" => Arch::Arm64,
    _ => return None,
  };

  Some((os, arch))
}

/// The lookup order kernel.md 3.3 pins down: `<os>-<arch>` → `<os>` → `*`.
///
/// The order is the whole point, so it is returned as a list the caller walks — an `Option`-based
/// lookup would let the caller invert it by accident.
pub fn candidate_keys(os: Os, arch: Arch) -> [String; 3] {
  [
    format!("{}-{}", os.key(), arch.key()),
    os.key().to_string(),
    "*".to_string(),
  ]
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn current_matches_the_running_platform() {
    // Every platform this repository builds on is inside the vocabulary, so `None` here means the
    // mapping lost a platform we actually ship to.
    let (os, arch) = current().expect("the CI platforms are all inside the spec's vocabulary");

    let expected_os = if cfg!(target_os = "windows") {
      Os::Win
    } else if cfg!(target_os = "macos") {
      Os::Mac
    } else {
      Os::Linux
    };
    assert_eq!(os, expected_os);

    let expected_arch = if cfg!(target_arch = "aarch64") {
      Arch::Arm64
    } else {
      Arch::X64
    };
    assert_eq!(arch, expected_arch);
  }

  #[test]
  fn candidate_keys_are_ordered_from_specific_to_fallback() {
    assert_eq!(candidate_keys(Os::Win, Arch::X64), ["win-x64", "win", "*"]);
    assert_eq!(
      candidate_keys(Os::Mac, Arch::Arm64),
      ["mac-arm64", "mac", "*"]
    );
    assert_eq!(
      candidate_keys(Os::Linux, Arch::X64),
      ["linux-x64", "linux", "*"]
    );
  }

  #[test]
  fn candidate_keys_never_leak_rusts_own_vocabulary() {
    // The keys are compared against a manifest, so `windows` / `x86_64` appearing here would mean
    // silently disabling every backend that declared the correct spec key.
    for os in [Os::Win, Os::Mac, Os::Linux] {
      for arch in [Arch::X64, Arch::Arm64] {
        let keys = candidate_keys(os, arch);
        assert!(!keys.iter().any(|key| key.contains("windows")));
        assert!(!keys.iter().any(|key| key.contains("x86_64")));
        assert!(!keys.iter().any(|key| key.contains("aarch64")));
      }
    }
  }
}
