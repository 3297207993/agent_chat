import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * The adapter's JS face: the ports `@cambia/host` declares, as plain functions.
 *
 * Thin by design — one `invoke` each, no caching, no retry, no policy. Retrying would hide the one
 * conclusion the caller needs ("the channel is not configured", "it never came up"), and a cache would
 * let an answer outlive the process it describes. Classification belongs to `@cambia/host`.
 */

/** The event a backend's own call arrives on; answer it with `respond`. */
export const BACKEND_CALL_EVENT = 'cambia://backend-call'

/** What `plugin:cambia|module_url` answers. */
export interface ModuleUrlResponse {
  url: string
}

/**
 * The `moduleURL` port (docs/design/host.md): a plugin-root-relative path becomes a URL the webview
 * can `import()`.
 *
 * Failures are handed on as the Rust side reported them: classifying them (not allowed / not there /
 * not JavaScript) belongs to `@cambia/host`.
 */
export async function moduleURL(path: string): Promise<string> {
  const response = await invoke<ModuleUrlResponse>('plugin:cambia|module_url', {
    payload: { path },
  })

  return response.url
}

/** What to run: a path relative to the install root, or an argv whose `argv[0]` comes from `PATH`. */
export type BinTarget = string | string[]

/** The host's restart policy. The values are the host's; the timing is the Rust side's. */
export interface RestartPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitter?: boolean
}

/** The arguments of `spawn`. */
export interface SpawnRequest {
  pluginId: string
  pluginVersion: string
  bin: BinTarget
  root: string
  startTimeoutMs: number
  stopTimeoutMs: number
  restart: RestartPolicy
}

/** What a successful `spawn` answers with. */
export interface SpawnResponse {
  pluginId: string
  /** Monotonic per plugin; every start gets a new one. */
  generation: number
  protocolVersion: number
  stderrPath?: string
}

/** The arguments of `kill`. */
export interface KillRequest {
  pluginId: string
  timeoutMs: number
}

/** How a backend exited. `expected` separates "we stopped it" from "it crashed". */
export interface ExitReason {
  generation: number
  code?: number
  signal?: number
  expected: boolean
}

/** The arguments of `call`. `timeoutMs` is required: the protocol has no default to fall back on. */
export interface CallRequest {
  pluginId: string
  /** Which instance; a late call must not land on a newer one. */
  generation: number
  method: string
  params: unknown
  timeoutMs: number
}

/** A call a backend is making: route it, then answer with `respond`. */
export interface BackendCall {
  /** Allocated by the adapter; only meaningful inside this application. */
  callId: number
  pluginId: string
  generation: number
  method: string
  params: unknown
}

/** The arguments of `respond`: exactly one of `result` / `error`. */
export interface RespondRequest {
  callId: number
  result?: unknown
  error?: { code: string; message: string }
}

/**
 * Start a backend. **Resolves once it is ready** — after the `$/initialize` handshake — or rejects with
 * a spec code (`PROCESS_SPAWN_FAILED`, `PROCESS_START_TIMEOUT`, `PROTOCOL_VERSION_UNSUPPORTED`). There
 * is no "starting" result to poll for.
 */
export async function spawn(request: SpawnRequest): Promise<SpawnResponse> {
  return invoke<SpawnResponse>('plugin:cambia|spawn', { payload: request })
}

/** Ask a backend to leave. `null` means there was nothing running. */
export async function kill(request: KillRequest): Promise<ExitReason | null> {
  return invoke<ExitReason | null>('plugin:cambia|kill', { payload: request })
}

/** Call a backend method. The frame loop, the timeout and the cancellation all live on the Rust side. */
export async function call<T = unknown>(request: CallRequest): Promise<T> {
  const response = await invoke<{ result: T }>('plugin:cambia|call', { payload: request })

  return response.result
}

/** Answer a backend's call. A late answer is ignored: the call has already timed out. */
export async function respond(request: RespondRequest): Promise<void> {
  await invoke('plugin:cambia|respond', { payload: request })
}

/**
 * Listen for the backend's own calls.
 *
 * The adapter forwards them as events instead of returning them from a command, because a call from the
 * backend is a *different* request from the one the host made; the timeout on it is still counted on the
 * Rust side, so a busy webview cannot make the host look responsive when it is not.
 */
export async function onBackendCall(handler: (call: BackendCall) => void): Promise<UnlistenFn> {
  return listen<BackendCall>(BACKEND_CALL_EVENT, (event) => handler(event.payload))
}
