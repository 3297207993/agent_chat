/**
 * Orchestration: loading one plugin, which is up to two independent halves.
 *
 * The shape here is the one docs/design/host.md settles on — **primitives plus orchestration, never a
 * merged `load`** — and the rules it defends:
 *
 * - **The two halves are started together but judged separately.** A frontend's verdict is "the fiber
 *   reached `ACTIVE`"; a backend's is "the handshake came back". Merging them into one promise would
 *   raise questions nothing answers well ("whose timeout wins?"), so `loadPlugin` fires both and keeps
 *   whichever settles well.
 * - **Nothing rolls back.** A crashed backend must not take the frontend down with it (kernel.md 3.3),
 *   and a frontend that failed to activate must not stop a backend the host asked for. Partial success
 *   is a normal outcome here, which is why failures come back as data rather than as a rejection.
 * - **Teardown is explicit and ordered**: stop the process first (Windows cannot replace files a live
 *   backend holds open), then unload the frontend, then undo the proxies.
 *
 * Failures are reported, not thrown: the caller asked for a plugin, and "the frontend came up, the
 * backend did not" is an answer.
 */

import { registerProxies, startBackend, stopBackend, type BackendHandle, type BackendPlan, type BackendPolicy, type BackendSupervisor, type PluginTransport } from './backend'
import { ERROR_CODES, PluginError } from './errors'
import { unloadFrontend, type FrontendLoadOptions, type KernelContext, type LoadedFrontend } from './loader'
import type { Manifest } from './manifest'

/** Which halves this round should start. `both` is not a synonym for "whatever is available". */
export type PluginParts = 'frontend-only' | 'backend-only' | 'both'

/** The plugin as one object. Data, not a controller: nothing here starts or stops anything. */
export interface PluginRecord {
  /** The manifest's id. */
  readonly id: string
  readonly manifest: Manifest
  /** The in-process half, once it reached `ACTIVE`. */
  readonly frontend?: LoadedFrontend
  /** The child-process half, once it passed its handshake. */
  readonly backend?: BackendHandle
}

/** One half that did not make it. */
export interface LoadPluginFailure {
  readonly part: 'frontend' | 'backend'
  readonly error: unknown
}

/** Everything the frontend half needs, grouped so a backend-only plugin can leave it out entirely. */
export interface FrontendDeps {
  readonly ctx: KernelContext
  /** Plugin-root-relative path of the bundle (K2.4 owns how it is built). */
  readonly path: string
  /** The load primitive, injected so this module needs no bridge of its own. */
  readonly load: (ctx: KernelContext, path: string, options?: FrontendLoadOptions) => Promise<LoadedFrontend>
  /** The host's own data, passed to `apply`. */
  readonly config?: unknown
}

/** Everything the backend half needs. */
export interface BackendDeps {
  readonly plan: BackendPlan
  readonly supervisor: BackendSupervisor
  /** Only needed when the backend declares proxies. */
  readonly transport?: PluginTransport
  /** The kernel's service registration, injected as a seam. */
  readonly provide?: (key: string, service: unknown) => () => void
}

/** What the caller must supply. Halves it does not want are simply absent. */
export interface LoadPluginDeps {
  readonly manifest: Manifest
  readonly frontend?: FrontendDeps
  readonly backend?: BackendDeps
}

/** What the caller decides. */
export interface LoadPluginPolicy {
  readonly parts: PluginParts
  /** Policy for the backend half, if this round starts one. */
  readonly backend?: Partial<BackendPolicy>
}

/** The result: what is in effect, what failed, and how to take it all back down. */
export interface LoadedPlugin {
  readonly record: PluginRecord
  readonly failures: readonly LoadPluginFailure[]
  /** Stop the backend, unload the frontend, undo the proxies — in that order. */
  unload(): Promise<void>
}

/** Load a plugin: up to two halves, launched together, judged apart. */
export async function loadPlugin(deps: LoadPluginDeps, policy: LoadPluginPolicy): Promise<LoadedPlugin> {
  const wantsFrontend = policy.parts !== 'backend-only'
  const wantsBackend = policy.parts !== 'frontend-only'

  if (wantsFrontend && !deps.frontend) {
    throw new PluginError({
      code: ERROR_CODES.MANIFEST_UNKNOWN_PART,
      message: `this round asks for the frontend half, but no frontend dependencies were supplied`,
    })
  }

  if (wantsBackend && !deps.backend) {
    throw new PluginError({
      code: ERROR_CODES.MANIFEST_UNKNOWN_PART,
      message: `this round asks for the backend half, but no backend dependencies were supplied`,
    })
  }

  const failures: LoadPluginFailure[] = []

  const [frontend, backend] = await Promise.all([
    wantsFrontend
      ? loadFrontendHalf(deps.frontend as FrontendDeps).catch((error: unknown) => {
          failures.push({ part: 'frontend', error })
          return undefined
        })
      : Promise.resolve(undefined),
    wantsBackend
      ? loadBackendHalf(deps.backend as BackendDeps, policy.backend).catch((error: unknown) => {
          failures.push({ part: 'backend', error })
          return undefined
        })
      : Promise.resolve(undefined),
  ])

  const record: PluginRecord = {
    id: deps.manifest.id,
    manifest: deps.manifest,
    ...(frontend ? { frontend } : {}),
    ...(backend?.handle ? { backend: backend.handle } : {}),
  }

  return {
    record,
    failures,
    async unload() {
      // Order matters: a live backend can hold the plugin's files open, so it goes first.
      if (backend?.handle) {
        await stopBackend(backend.handle, (deps.backend as BackendDeps).supervisor, policy.backend)
      }

      if (backend) backend.release()
      if (frontend) unloadFrontend(frontend)
    },
  }
}

async function loadFrontendHalf(deps: FrontendDeps): Promise<LoadedFrontend> {
  return deps.load(deps.ctx, deps.path, { config: deps.config })
}

interface RunningBackend {
  handle?: BackendHandle
  release(): void
}

async function loadBackendHalf(deps: BackendDeps, policy: Partial<BackendPolicy> | undefined): Promise<RunningBackend> {
  // The verdict and nothing else: `startBackend` returns once the handshake is done, or throws with a
  // spec code.
  const handle = await startBackend(deps.plan.target, deps.supervisor, policy)

  const proxies = deps.plan.proxies ?? []
  const canRegister = proxies.length > 0 && deps.transport !== undefined && deps.provide !== undefined

  // Registration happens here, after `ready` — a proxy that existed earlier would make `inject`
  // report a service that cannot answer (docs/design/host.md).
  const release = canRegister
    ? registerProxies(proxies, handle, deps.transport as PluginTransport, deps.provide as (key: string, service: unknown) => () => void)
    : () => {}

  return { handle, release }
}
