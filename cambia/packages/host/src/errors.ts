/**
 * The error-code vocabulary, and the error type that carries it.
 *
 * The single source of the codes is `spec/v1/error-codes.json` — this file is only a constant
 * mapping of that table (implementation.md 3.5: both sides map the same table, and a test keeps
 * the two in sync in both directions). Codes are stable identifiers: wording may change, the code
 * string may not (docs/design/spec.md).
 *
 * `stage` in the table says which batch implements a code: `manifest` / `engines` are live now
 * (K2.1), the `load` codes are ratified here but wired up by the load layer (K2.4).
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
