/**
 * `@cambia/host` — the host-side runtime that sits next to the kernel.
 *
 * The split is kernel.md 1.9: the kernel ships mechanisms (service registry, inject, effects,
 * dispatch, loading), the host defines domain vocabulary (service keys, event names, slot
 * positions). This package is the host side of that line, and it is **deliberately free of both
 * cordis and Tauri** — it observes the kernel through nothing but plain values, and every URL
 * crosses the `PluginHostBridge` seam that the adapter layer implements.
 *
 * What exists so far (K2.1): the manifest contract, `engines` verdicts and activation matching.
 * The load layer, the "why did it not activate" diagnostics and the slot runtime follow in K2.2–K2.5
 * (docs/design/host.md).
 */

export { ERROR_CODES, PluginError, isPluginError } from './errors'
export type { PluginErrorCode, PluginErrorOptions, PluginIssue } from './errors'

export { checkEngines, isValidRange, isValidVersion, parseHostEngine } from './engines'
export type { EngineMismatch, EnginesVerdict, HostEngine, RuntimeVersions } from './engines'

export { createActivationMatcher, matchesActivationEvent, parseActivationEvent } from './activation'
export type { ActivationEvent, ActivationMatcher } from './activation'

export {
  DEFAULT_ENTRY,
  MANIFEST_FILENAME,
  manifestJsonSchema,
  manifestSchema,
  parseManifest,
  serializeManifestJsonSchema,
  validateManifest,
} from './manifest'
export type {
  JsonSchemaObject,
  Manifest,
  ManifestEngines,
  ManifestParts,
  ManifestValidation,
} from './manifest'
