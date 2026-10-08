//! The Rust mirror of `spec/v1/error-codes.json`.
//!
//! The table is the single source (docs/design/spec.md): this module only maps its keys to values, so
//! the crate reports codes it did not invent. `tests/spec.rs` compares the two key sets in **both**
//! directions, exactly like the JS side does — a code that exists on one side only turns the test red
//! instead of being found in review.
//!
//! The variants are grouped the way the table's `stage` column groups them. The stage itself is not
//! duplicated here: the table owns it, and a second copy is a second thing that can drift.

use std::fmt;

/// Every code in `spec/v1/error-codes.json`, as a stable identifier.
///
/// Codes are stable: wording may change, the code string may not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorCode {
  // ── stage: manifest (validation of `cambia.json`, kernel.md 3) ────────────────────────────────
  /// The manifest is missing, unreadable, or not a JSON object
  ManifestParseFailed,
  /// A field is present but its type or format is wrong
  ManifestFieldInvalid,
  /// `engines` is absent, or lacks `cambia` / `host`
  ManifestMissingEngines,
  /// `parts` carries a key outside frontend / backend
  ManifestUnknownPart,
  /// A declared path can leave the package root
  ManifestPathEscape,
  /// A `backend.bin` key is outside the `<os>[-<arch>]` / `*` vocabulary
  ManifestPlatformKeyInvalid,
  /// `parts.backend` exists but is missing `protocol` or `bin`
  ManifestBackendIncomplete,
  /// An `activationEvents` entry is neither `always` nor `<prefix>:<pattern>`
  ManifestActivationEventInvalid,

  // ── stage: engines ────────────────────────────────────────────────────────────────────────────
  /// An `engines` range does not admit the running kernel / host version
  EngineIncompatible,

  // ── stage: load (the in-process half; the classifying four land with K2.4) ─────────────────────
  /// The plugin module could not be fetched
  LoadFetchFailed,
  /// Fetched, but the response is not JavaScript
  LoadMimeMismatch,
  /// The module does not parse
  LoadSyntax,
  /// Fetched, valid JS, and still threw
  LoadEvaluation,
  /// The module evaluates but exports no `apply`
  LoadNoApply,

  // ── stage: protocol (spec/v1/protocol.md §6) ──────────────────────────────────────────────────
  /// A line arrived that is not valid JSON
  ProtocolParseError,
  /// Valid JSON, but not a message of this protocol
  ProtocolInvalidMessage,
  /// The method name is unknown to the receiving side
  ProtocolMethodNotFound,
  /// The params are shaped wrong for that method
  ProtocolInvalidParams,
  /// The peer failed while handling the request
  ProtocolInternalError,
  /// The peer does not accept `protocolVersion` 1
  ProtocolVersionUnsupported,
  /// The call timed out; never a sign of process death
  ProtocolCallTimeout,
  /// The peer cancelled this request
  ProtocolCancelled,
  /// A single frame exceeds `MAX_FRAME_BYTES`
  ProtocolFrameTooLarge,
  /// In-flight requests hit the host's cap
  ProtocolTooManyInFlight,

  // ── stage: process (the backend supervisor) ───────────────────────────────────────────────────
  /// The backend process could not be started
  ProcessSpawnFailed,
  /// Started, but the handshake did not complete in time
  ProcessStartTimeout,
  /// The backend process is gone; in-flight calls fail with it
  ProcessExited,
  /// The restart budget the host handed over is used up
  ProcessRestartExhausted,
  /// No `backend.bin` key matches this platform
  ProcessPlatformUnsupported,
}

impl ErrorCode {
  /// The wire spelling: what goes into `error.data.code` and into every error this crate reports.
  pub const fn as_str(self) -> &'static str {
    match self {
      ErrorCode::ManifestParseFailed => "MANIFEST_PARSE_FAILED",
      ErrorCode::ManifestFieldInvalid => "MANIFEST_FIELD_INVALID",
      ErrorCode::ManifestMissingEngines => "MANIFEST_MISSING_ENGINES",
      ErrorCode::ManifestUnknownPart => "MANIFEST_UNKNOWN_PART",
      ErrorCode::ManifestPathEscape => "MANIFEST_PATH_ESCAPE",
      ErrorCode::ManifestPlatformKeyInvalid => "MANIFEST_PLATFORM_KEY_INVALID",
      ErrorCode::ManifestBackendIncomplete => "MANIFEST_BACKEND_INCOMPLETE",
      ErrorCode::ManifestActivationEventInvalid => "MANIFEST_ACTIVATION_EVENT_INVALID",
      ErrorCode::EngineIncompatible => "ENGINE_INCOMPATIBLE",
      ErrorCode::LoadFetchFailed => "LOAD_FETCH_FAILED",
      ErrorCode::LoadMimeMismatch => "LOAD_MIME_MISMATCH",
      ErrorCode::LoadSyntax => "LOAD_SYNTAX",
      ErrorCode::LoadEvaluation => "LOAD_EVALUATION",
      ErrorCode::LoadNoApply => "LOAD_NO_APPLY",
      ErrorCode::ProtocolParseError => "PROTOCOL_PARSE_ERROR",
      ErrorCode::ProtocolInvalidMessage => "PROTOCOL_INVALID_MESSAGE",
      ErrorCode::ProtocolMethodNotFound => "PROTOCOL_METHOD_NOT_FOUND",
      ErrorCode::ProtocolInvalidParams => "PROTOCOL_INVALID_PARAMS",
      ErrorCode::ProtocolInternalError => "PROTOCOL_INTERNAL_ERROR",
      ErrorCode::ProtocolVersionUnsupported => "PROTOCOL_VERSION_UNSUPPORTED",
      ErrorCode::ProtocolCallTimeout => "PROTOCOL_CALL_TIMEOUT",
      ErrorCode::ProtocolCancelled => "PROTOCOL_CANCELLED",
      ErrorCode::ProtocolFrameTooLarge => "PROTOCOL_FRAME_TOO_LARGE",
      ErrorCode::ProtocolTooManyInFlight => "PROTOCOL_TOO_MANY_IN_FLIGHT",
      ErrorCode::ProcessSpawnFailed => "PROCESS_SPAWN_FAILED",
      ErrorCode::ProcessStartTimeout => "PROCESS_START_TIMEOUT",
      ErrorCode::ProcessExited => "PROCESS_EXITED",
      ErrorCode::ProcessRestartExhausted => "PROCESS_RESTART_EXHAUSTED",
      ErrorCode::ProcessPlatformUnsupported => "PROCESS_PLATFORM_UNSUPPORTED",
    }
  }

  /// Every code, so the drift check — and anything that needs "is this a code we know?" — has one
  /// list to walk. The length is spelled out so adding a variant without adding it here fails to
  /// compile instead of silently shrinking the checked set.
  pub const ALL: [ErrorCode; 29] = [
    ErrorCode::ManifestParseFailed,
    ErrorCode::ManifestFieldInvalid,
    ErrorCode::ManifestMissingEngines,
    ErrorCode::ManifestUnknownPart,
    ErrorCode::ManifestPathEscape,
    ErrorCode::ManifestPlatformKeyInvalid,
    ErrorCode::ManifestBackendIncomplete,
    ErrorCode::ManifestActivationEventInvalid,
    ErrorCode::EngineIncompatible,
    ErrorCode::LoadFetchFailed,
    ErrorCode::LoadMimeMismatch,
    ErrorCode::LoadSyntax,
    ErrorCode::LoadEvaluation,
    ErrorCode::LoadNoApply,
    ErrorCode::ProtocolParseError,
    ErrorCode::ProtocolInvalidMessage,
    ErrorCode::ProtocolMethodNotFound,
    ErrorCode::ProtocolInvalidParams,
    ErrorCode::ProtocolInternalError,
    ErrorCode::ProtocolVersionUnsupported,
    ErrorCode::ProtocolCallTimeout,
    ErrorCode::ProtocolCancelled,
    ErrorCode::ProtocolFrameTooLarge,
    ErrorCode::ProtocolTooManyInFlight,
    ErrorCode::ProcessSpawnFailed,
    ErrorCode::ProcessStartTimeout,
    ErrorCode::ProcessExited,
    ErrorCode::ProcessRestartExhausted,
    ErrorCode::ProcessPlatformUnsupported,
  ];
}

impl fmt::Display for ErrorCode {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    formatter.write_str(self.as_str())
  }
}
