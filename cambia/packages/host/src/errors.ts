/**
 * The error-code vocabulary, and the error type that carries it.
 *
 * The single source of the codes is `spec/v1/error-codes.json` — this file is only a constant
 * mapping of that table (implementation.md 3.5: both sides map the same table, and a test keeps
 * the two in sync in both directions). Codes are stable identifiers: wording may change, the code
 * string may not (docs/design/spec.md).
 *
 * `stage` in the table says which batch implements a code: `manifest` / `engines` are live since
 * K2.1, `LOAD_NO_APPLY` is wired by the load layer (K2.2), the four classifying `load` codes arrive
 * with the import-failure classification (K2.4), and the `protocol` / `process` codes arrive with the
 * backend supervisor and the control plane (K2.6, spec/v1/protocol.md).
 */

/** Every code the spec knows, as runtime values (the drift check compares these keys with the table). */
export const ERROR_CODES = {
  /** The manifest is missing, unreadable, or not a JSON object */
  MANIFEST_PARSE_FAILED: 'MANIFEST_PARSE_FAILED',
  /** A field is present but its type or format is wrong; `path` points at it */
  MANIFEST_FIELD_INVALID: 'MANIFEST_FIELD_INVALID',
  /** `engines` is absent, or lacks `cambia` / `host` (kernel.md 3 requires the double constraint) */
  MANIFEST_MISSING_ENGINES: 'MANIFEST_MISSING_ENGINES',
  /** `parts` carries a key not defined by this spec: the host lacks that ability */
  MANIFEST_UNKNOWN_PART: 'MANIFEST_UNKNOWN_PART',
  /** A declared path can leave the package root (absolute, `..`, backslash, empty segment) */
  MANIFEST_PATH_ESCAPE: 'MANIFEST_PATH_ESCAPE',
  /** A `backend.bin` key is outside the `<os>[-<arch>]` / `*` vocabulary (kernel.md 3.3) */
  MANIFEST_PLATFORM_KEY_INVALID: 'MANIFEST_PLATFORM_KEY_INVALID',
  /** `parts.backend` exists but is missing `protocol` or `bin` */
  MANIFEST_BACKEND_INCOMPLETE: 'MANIFEST_BACKEND_INCOMPLETE',
  /** An `activationEvents` entry is neither `always` nor `<prefix>:<pattern>` */
  MANIFEST_ACTIVATION_EVENT_INVALID: 'MANIFEST_ACTIVATION_EVENT_INVALID',
  /** An `engines` range does not admit the running kernel / host version */
  ENGINE_INCOMPATIBLE: 'ENGINE_INCOMPATIBLE',
  /** The plugin module could not be fetched (403 / 404 / CORS / a dependency of the module) */
  LOAD_FETCH_FAILED: 'LOAD_FETCH_FAILED',
  /** Fetched, but the response is not JavaScript (ES module MIME checking is strict) */
  LOAD_MIME_MISMATCH: 'LOAD_MIME_MISMATCH',
  /** The module does not parse (matched by `name`, not `instanceof`: cross-realm) */
  LOAD_SYNTAX: 'LOAD_SYNTAX',
  /** Fetched, valid JS, and still threw: the module itself blew up */
  LOAD_EVALUATION: 'LOAD_EVALUATION',
  /** The module evaluates but exports no `apply` (not a plugin entry) */
  LOAD_NO_APPLY: 'LOAD_NO_APPLY',
  /** A line arrived that is not valid JSON (JSON-RPC -32700); the channel is no longer trustworthy */
  PROTOCOL_PARSE_ERROR: 'PROTOCOL_PARSE_ERROR',
  /** Valid JSON, but not a message of this protocol: missing `jsonrpc`, or neither `method` nor `result`/`error` (JSON-RPC -32600) */
  PROTOCOL_INVALID_MESSAGE: 'PROTOCOL_INVALID_MESSAGE',
  /** The method name is unknown to the receiving side (JSON-RPC -32601) */
  PROTOCOL_METHOD_NOT_FOUND: 'PROTOCOL_METHOD_NOT_FOUND',
  /** The params are shaped wrong for that method (JSON-RPC -32602) */
  PROTOCOL_INVALID_PARAMS: 'PROTOCOL_INVALID_PARAMS',
  /** The peer failed while handling the request (JSON-RPC -32603) */
  PROTOCOL_INTERNAL_ERROR: 'PROTOCOL_INTERNAL_ERROR',
  /** The peer does not accept `protocolVersion` 1; the plugin's backend is disabled rather than guessed at */
  PROTOCOL_VERSION_UNSUPPORTED: 'PROTOCOL_VERSION_UNSUPPORTED',
  /** The call timed out — synthesized by the transport, never sent across the pipe, and never a sign of process death */
  PROTOCOL_CALL_TIMEOUT: 'PROTOCOL_CALL_TIMEOUT',
  /** The peer cancelled this request; a pending call fails with it */
  PROTOCOL_CANCELLED: 'PROTOCOL_CANCELLED',
  /** A single frame exceeds `MAX_FRAME_BYTES`; large payloads stay out of the protocol (kernel.md 3.3) */
  PROTOCOL_FRAME_TOO_LARGE: 'PROTOCOL_FRAME_TOO_LARGE',
  /** In-flight requests hit the host's cap; the caller fails at once instead of queueing without bound */
  PROTOCOL_TOO_MANY_IN_FLIGHT: 'PROTOCOL_TOO_MANY_IN_FLIGHT',
  /** The backend process could not be started (missing executable, permission, cwd) */
  PROCESS_SPAWN_FAILED: 'PROCESS_SPAWN_FAILED',
  /** Started, but the `$/initialize` handshake did not complete in time; the process is reclaimed */
  PROCESS_START_TIMEOUT: 'PROCESS_START_TIMEOUT',
  /** The backend process is gone; in-flight calls fail with it, and it never implies the frontend is affected */
  PROCESS_EXITED: 'PROCESS_EXITED',
  /** The restart budget the host handed over is used up; disabling the backend stays the host's decision */
  PROCESS_RESTART_EXHAUSTED: 'PROCESS_RESTART_EXHAUSTED',
  /** No `backend.bin` key matches this platform: disable this plugin's backend only, never fall back to another form */
  PROCESS_PLATFORM_UNSUPPORTED: 'PROCESS_PLATFORM_UNSUPPORTED',
} as const

export type PluginErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** One concrete problem, at a concrete place. Validation collects these instead of throwing. */
export interface PluginIssue {
  code: PluginErrorCode
  /** Dotted path into the manifest; `''` means "the manifest as a whole" */
  path: string
  /** Short, per-code wording (the raw upstream message lives in `detail`) */
  message: string
  /** Raw upstream message, kept for debugging (zod messages are regex dumps) */
  detail?: string
}

export interface PluginErrorOptions {
  code: PluginErrorCode
  message: string
  path?: string
  /** All problems found, when the failure is a validation verdict rather than a single fault */
  issues?: readonly PluginIssue[]
  cause?: unknown
}

/** The error type of this module: always carries a spec code, so callers switch on codes, not text. */
export class PluginError extends Error {
  readonly code: PluginErrorCode
  readonly path: string | undefined
  readonly issues: readonly PluginIssue[]

  constructor(options: PluginErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'PluginError'
    this.code = options.code
    this.path = options.path
    this.issues = options.issues ?? [
      { code: options.code, path: options.path ?? '', message: options.message },
    ]
  }
}

export function isPluginError(value: unknown): value is PluginError {
  return value instanceof PluginError
}
