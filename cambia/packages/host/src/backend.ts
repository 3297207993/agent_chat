/**
 * The backend half: the ports a plugin's child process needs, the primitives over them, and the proxy
 * service that makes a backend look like an ordinary service to the rest of the kernel.
 *
 * Three decisions from docs/design/host.md are load-bearing here:
 *
 * - **TS orchestrates, Rust owns.** `startBackend`/`stopBackend` are requests; the handle lives on the
 *   Rust side, and so does everything that has to survive the WebView being gone. There is no "the JS
 *   called kill, so it must be dead" reasoning anywhere in this file.
 * - **`startBackend` resolves on a verdict, never on "we asked".** It returns when the backend is past
 *   its `$/initialize` handshake, or it throws with a spec code — the same discipline the frontend
 *   `load` follows with `ACTIVE` / `FAILED`.
 * - **The method mapping is the host's vocabulary** (kernel.md 1.9). Cambia does not know what
 *   `sessions/append` means, so the mapping arrives as data from the host application and this module
 *   only wires it up.
 *
 * Nothing here imports Tauri: the ports are declared on this side and implemented by the adapter layer.
 */

import { ERROR_CODES, PluginError, type PluginErrorCode } from './errors'

/** Where a backend is, as far as this side can see. The authority is the Rust process table. */
export type BackendStatus = 'starting' | 'ready' | 'stopping' | 'exited'

/** Why an instance stopped. `expected` separates "we stopped it" from "it crashed". */
export interface ExitReason {
  /** Which instance this is about; a late report for an older generation is not this one's. */
  readonly generation: number
  readonly code?: number
  readonly signal?: number
  readonly expected: boolean
}

/** What this side holds for a running backend. A view, not a handle: it cannot kill anything. */
export interface BackendHandle {
  readonly pluginId: string
  /** Monotonic per plugin: every start gets a new one, so late events can be recognised. */
  readonly generation: number
  readonly status: BackendStatus
  readonly protocolVersion: number
  readonly stderrPath?: string
}

/**
 * How to start a backend, in the two forms kernel.md 3.3 allows: a path relative to the install root,
 * or an argv whose `argv[0]` is looked up in `PATH` (a system interpreter plus a bundled script).
 */
export type BinTarget = string | readonly string[]

/** A start request, as the host formulates it. */
export interface BackendTarget {
  readonly pluginId: string
  /** The plugin's own version, passed through to the handshake. */
  readonly pluginVersion: string
  readonly bin: BinTarget
  /** The install root a relative `bin` is resolved against. */
  readonly root: string
}

/** The host's restart policy: the values are decided here, the timing is the Rust side's. */
export interface BackendRestartPolicy {
  /** Consecutive start attempts allowed before the episode is given up. */
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  /** Spread the delay; off is what tests want, on is what production wants. */
  readonly jitter?: boolean
}

/** Everything a start needs to know about the host's policy. */
export interface BackendPolicy {
  /** One budget for exec **and** the handshake: the caller's question is "did it come up". */
  readonly startTimeoutMs: number
  readonly restart: BackendRestartPolicy
  /** How long a graceful stop may take before the tree is taken down. */
  readonly stopTimeoutMs: number
}

/** The defaults a host gets when it does not want to think about policy. */
export const DEFAULT_BACKEND_POLICY: BackendPolicy = {
  startTimeoutMs: 10_000,
  stopTimeoutMs: 5_000,
  restart: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 5_000, jitter: true },
}

/**
 * The supervisor port. Implemented by the adapter layer over `cambia-plugin-host`.
 *
 * It carries no handle on purpose: "how do I kill it" is not a question this side gets to answer by
 * holding a reference (docs/design/host.md's "进程端口").
 */
export interface BackendSupervisor {
  /** Resolves once the backend is **ready**, or rejects with a spec code. */
  start(target: BackendTarget, policy: BackendPolicy): Promise<BackendHandle>
  /** Ask it to leave. The answer is the exit, or `null` when nothing was running. */
  stop(pluginId: string, timeoutMs: number): Promise<ExitReason | null>
}

/**
 * The control-plane port. The frame loop, the id table, the timeout and the cancellation live in Rust
 * (they have to stay punctual while the JS main thread is busy); this side only decides *what a method
 * name means*.
 */
export interface PluginTransport {
  /** Call a backend method. `timeoutMs` is required: the protocol has no default to fall back on. */
  call(handle: BackendHandle, method: string, params: unknown, timeoutMs: number): Promise<unknown>
  /** Route the backend's own calls. Returns a function that stops routing. */
  onCall(dispatch: BackendCallDispatch): () => void
}

/** What the host does with `backend → host` calls. */
export type BackendCallDispatch = (
  pluginId: string,
  method: string,
  params: unknown,
) => Promise<unknown>

/** One service key's mapping into a backend's methods. Host vocabulary, passed in as data. */
export interface ProxySpec {
  /** The key other plugins `inject`, e.g. `ctx.sessions`. */
  readonly key: string
  /** Service method name → backend method name. */
  readonly methods: Readonly<Record<string, string>>
  /** Per-call timeout for these methods. */
  readonly timeoutMs: number
}

/** How a plugin's backend is declared in this side's own terms. */
export interface BackendPlan {
  readonly target: BackendTarget
  readonly policy?: Partial<BackendPolicy>
  /** What this backend's services look like to other plugins. */
  readonly proxies?: readonly ProxySpec[]
}

/**
 * Start a backend and wait for the verdict.
 *
 * Thin on purpose — the interesting work is on the Rust side — but not empty: it fills in the policy
 * defaults in one place, and it refuses a target that cannot work rather than letting the Rust side
 * report a confusing spawn failure for an empty program name.
 */
export async function startBackend(
  target: BackendTarget,
  supervisor: BackendSupervisor,
  policy?: Partial<BackendPolicy>,
): Promise<BackendHandle> {
  assertTarget(target)

  const resolved: BackendPolicy = {
    ...DEFAULT_BACKEND_POLICY,
    ...policy,
    restart: { ...DEFAULT_BACKEND_POLICY.restart, ...policy?.restart },
  }

  return supervisor.start(target, resolved)
}

/** Stop a backend and report how it left. `null` means there was nothing to stop. */
export async function stopBackend(
  handle: BackendHandle,
  supervisor: BackendSupervisor,
  policy?: Partial<BackendPolicy>,
): Promise<ExitReason | null> {
  const timeoutMs = policy?.stopTimeoutMs ?? DEFAULT_BACKEND_POLICY.stopTimeoutMs
  return supervisor.stop(handle.pluginId, timeoutMs)
}

/**
 * The service object other plugins see, backed by a child process.
 *
 * Two rules from docs/design/host.md are enforced here rather than trusted:
 *
 * 1. **Registration happens after `Ready`**, which is why this takes a handle and not a plan: a proxy
 *    that exists before the backend is ready would make `inject` report a service that cannot answer.
 *    Because the host registers it then, a frontend plugin that injects the key simply stays `PENDING`
 *    until it is there (the kernel's own ordering, no orchestration field needed).
 * 2. **A failed call is not a dead process.** A timeout comes back as `PROTOCOL_CALL_TIMEOUT`; only a
 *    peer that is gone reports `PROCESS_EXITED`. Collapsing the two would make "it is slow" and "it
 *    crashed" indistinguishable to every caller.
 */
export function createProxyService(
  spec: ProxySpec,
  handle: BackendHandle,
  transport: PluginTransport,
): Record<string, (params?: unknown) => Promise<unknown>> {
  const service: Record<string, (params?: unknown) => Promise<unknown>> = {}

  for (const [method, backendMethod] of Object.entries(spec.methods)) {
    service[method] = async (params?: unknown) => {
      try {
        return await transport.call(handle, backendMethod, params ?? null, spec.timeoutMs)
      } catch (error) {
        throw toPluginError(error, `${spec.key}.${method}`)
      }
    }
  }

  return service
}

/**
 * Register every proxy a backend declares.
 *
 * `provide` is the kernel's service registration, injected as a seam so this module stays free of
 * cordis: it returns an undo function, and the undos are undone in reverse here — the same order the
 * kernel uses for effects, so a partially registered backend still disappears cleanly.
 */
export function registerProxies(
  proxies: readonly ProxySpec[],
  handle: BackendHandle,
  transport: PluginTransport,
  provide: (key: string, service: unknown) => () => void,
): () => void {
  const undo: Array<() => void> = []

  for (const spec of proxies) {
    undo.push(provide(spec.key, createProxyService(spec, handle, transport)))
  }

  return () => {
    for (const release of undo.reverse()) release()
  }
}

/**
 * The spec code behind a failure that came out of a backend port.
 *
 * The adapter passes the code through rather than a rendered string, so this side can switch on it;
 * anything unrecognised becomes an internal error rather than a guess.
 */
export function backendErrorCode(error: unknown): PluginErrorCode {
  if (error instanceof PluginError) return error.code

  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && isKnownCode(code)) return code

  return ERROR_CODES.PROTOCOL_INTERNAL_ERROR
}

function toPluginError(error: unknown, where: string): PluginError {
  if (error instanceof PluginError) return error

  const message = error instanceof Error ? error.message : String(error)
  return new PluginError({
    code: backendErrorCode(error),
    message: `${where} failed: ${message}`,
    path: where,
    cause: error,
  })
}

function isKnownCode(value: string): value is PluginErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, value)
}

function assertTarget(target: BackendTarget): void {
  if (!target.pluginId) throw new PluginError({ code: ERROR_CODES.PROCESS_SPAWN_FAILED, message: 'a backend needs a plugin id' })
  if (!target.root) throw new PluginError({ code: ERROR_CODES.PROCESS_SPAWN_FAILED, message: 'a backend needs an install root' })

  const bin = target.bin
  const empty = typeof bin === 'string' ? bin.length === 0 : bin.length === 0 || bin.some((part) => part.length === 0)
  if (empty) {
    throw new PluginError({
      code: ERROR_CODES.PROCESS_SPAWN_FAILED,
      message: 'a backend needs something to run: a relative path, or an argv with a program name',
    })
  }
}
