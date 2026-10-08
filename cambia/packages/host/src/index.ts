/**
 * `@cambia/host` — the host-side runtime that sits next to the kernel.
 *
 * The split is kernel.md 1.9: the kernel ships mechanisms (service registry, inject, effects,
 * dispatch, loading), the host defines domain vocabulary (service keys and event names). This
 * package is the host side of that line, and it is **deliberately free of both
 * cordis and Tauri** — it observes the kernel through nothing but plain values, and every URL
 * crosses the `PluginHostBridge` seam that the adapter layer implements.
 *
 * What exists so far: the manifest contract, `engines` verdicts and activation matching (K2.1), plus
 * the load layer for a plugin's **in-process (frontend) part** — `import()` → activation verdict →
 * unload (K2.2). A plugin's `backend` part is a child process (K2.6), and the "why did it not
 * activate" diagnostics follow in K2.3 (docs/design/host.md).
 */

export type { PluginHostBridge } from './bridge'

export { ERROR_CODES, PluginError, isPluginError } from './errors'
export type { PluginErrorCode, PluginErrorOptions, PluginIssue } from './errors'

export { FIBER_STATE, createFrontendLoader, loadPluginModule, unloadFrontend } from './loader'
export type {
  FrontendLoadOptions,
  FrontendLoader,
  KernelContext,
  KernelFiber,
  LoadedFrontend,
  LoadPluginModuleOptions,
  PluginModule,
} from './loader'

export {
  DEFAULT_BACKEND_POLICY,
  backendErrorCode,
  createProxyService,
  registerProxies,
  startBackend,
  stopBackend,
} from './backend'
export type {
  BackendCallDispatch,
  BackendHandle,
  BackendPlan,
  BackendPolicy,
  BackendRestartPolicy,
  BackendStatus,
  BackendSupervisor,
  BackendTarget,
  BinTarget,
  ExitReason,
  PluginTransport,
  ProxySpec,
} from './backend'

export { checkEngines, isValidRange, isValidVersion, parseHostEngine } from './engines'
export type { EngineMismatch, EnginesVerdict, HostEngine, RuntimeVersions } from './engines'

export { loadPlugin } from './orchestrate'
export type {
  BackendDeps,
  FrontendDeps,
  LoadedPlugin,
  LoadPluginDeps,
  LoadPluginFailure,
  LoadPluginPolicy,
  PluginParts,
  PluginRecord,
} from './orchestrate'

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
