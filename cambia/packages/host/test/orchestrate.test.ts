/**
 * `loadPlugin`: the two halves, judged apart.
 *
 * The interesting assertions are the ones about *independence* — a crashed backend must not take the
 * frontend down with it, a frontend that never activated must not stop a backend the host asked for —
 * because those are the promises kernel.md 3.3 makes and the ones a merged `load` would quietly break.
 */

import { describe, expect, it } from 'vitest'

import type { BackendHandle, BackendPlan, BackendSupervisor, PluginTransport } from '../src/backend'
import { ERROR_CODES, isPluginError } from '../src/errors'
import { loadPlugin, type BackendDeps, type FrontendDeps } from '../src/orchestrate'
import type { KernelContext, LoadedFrontend } from '../src/loader'
import type { Manifest } from '../src/manifest'

const manifest = { id: 'demo', version: '1.0.0' } as unknown as Manifest
const ctx = {} as unknown as KernelContext

const handle: BackendHandle = { pluginId: 'demo', generation: 1, status: 'ready', protocolVersion: 1 }

const plan: BackendPlan = {
  target: { pluginId: 'demo', pluginVersion: '1.0.0', bin: 'backend/app', root: '/plugins' },
}

function supervisorThatSucceeds(): BackendSupervisor {
  return {
    start: async () => handle,
    stop: async () => ({ generation: 1, code: 0, expected: true }),
  }
}

const loadedFrontend: LoadedFrontend = {
  path: 'frontend/main.js',
  url: 'file:///plugins/demo/frontend/main.js',
  module: {},
  fiber: { state: 2, uid: 1, dispose: () => undefined },
  state: 2,
  error: null,
}

function frontendDeps(overrides: Partial<FrontendDeps> = {}): FrontendDeps {
  return { ctx, path: 'frontend/main.js', load: async () => loadedFrontend, ...overrides }
}

function backendDeps(overrides: Partial<BackendDeps> = {}): BackendDeps {
  return { plan, supervisor: supervisorThatSucceeds(), ...overrides }
}

describe('loadPlugin', () => {
  it('starts both halves and reports them in one record', async () => {
    const loaded = await loadPlugin(
      { manifest, frontend: frontendDeps(), backend: backendDeps() },
      { parts: 'both' },
    )

    expect(loaded.record.id).toBe('demo')
    expect(loaded.record.frontend).toBe(loadedFrontend)
    expect(loaded.record.backend).toEqual(handle)
    expect(loaded.failures).toEqual([])
  })

  it('keeps the frontend when the backend never came up', async () => {
    const failing: BackendSupervisor = {
      start: async () => {
        throw Object.assign(new Error('no handshake'), { code: ERROR_CODES.PROCESS_START_TIMEOUT })
      },
      stop: async () => null,
    }

    const loaded = await loadPlugin(
      { manifest, frontend: frontendDeps(), backend: backendDeps({ supervisor: failing }) },
      { parts: 'both' },
    )

    expect(loaded.record.frontend).toBe(loadedFrontend)
    expect(loaded.record.backend).toBeUndefined()
    expect(loaded.failures).toHaveLength(1)
    expect(loaded.failures[0].part).toBe('backend')
  })

  it('keeps the backend when the frontend never activated', async () => {
    const loaded = await loadPlugin(
      {
        manifest,
        frontend: frontendDeps({
          load: async () => {
            throw new Error('apply threw')
          },
        }),
        backend: backendDeps(),
      },
      { parts: 'both' },
    )

    expect(loaded.record.backend).toEqual(handle)
    expect(loaded.record.frontend).toBeUndefined()
    expect(loaded.failures).toHaveLength(1)
    expect(loaded.failures[0].part).toBe('frontend')
  })

  it('starts only what the policy asks for, whatever is available', async () => {
    const loaded = await loadPlugin(
      { manifest, frontend: frontendDeps(), backend: backendDeps() },
      { parts: 'frontend-only' },
    )

    expect(loaded.record.frontend).toBe(loadedFrontend)
    expect(loaded.record.backend).toBeUndefined()
  })

  it('treats "the policy wants a half with no dependencies" as a configuration error', async () => {
    await expect(loadPlugin({ manifest }, { parts: 'both' })).rejects.toSatisfy(
      (error: unknown) => isPluginError(error) && error.code === ERROR_CODES.MANIFEST_UNKNOWN_PART,
    )
  })

  it('registers proxies only after the backend is ready, and releases them on unload', async () => {
    const order: string[] = []
    const provide = (key: string): (() => void) => {
      order.push(`provide:${key}`)
      return () => order.push(`release:${key}`)
    }

    const supervisor: BackendSupervisor = {
      start: async () => {
        order.push('started')
        return handle
      },
      stop: async () => {
        order.push('stopped')
        return { generation: 1, code: 0, expected: true }
      },
    }

    const transport: PluginTransport = { call: async () => null, onCall: () => () => {} }

    const loaded = await loadPlugin(
      {
        manifest,
        backend: backendDeps({
          supervisor,
          transport,
          provide,
          plan: { ...plan, proxies: [{ key: 'sessions', methods: { append: 'sessions/append' }, timeoutMs: 1000 }] },
        }),
      },
      { parts: 'backend-only' },
    )

    expect(order, 'a proxy must not exist before the handshake').toEqual(['started', 'provide:sessions'])

    await loaded.unload()

    expect(order, 'the process goes down before its services disappear').toEqual([
      'started',
      'provide:sessions',
      'stopped',
      'release:sessions',
    ])
  })

  it('unloads the frontend after stopping the backend', async () => {
    const order: string[] = []

    const supervisor: BackendSupervisor = {
      start: async () => handle,
      stop: async () => {
        order.push('stop-backend')
        return { generation: 1, code: 0, expected: true }
      },
    }

    const frontend = frontendDeps({
      load: async () => ({
        ...loadedFrontend,
        fiber: {
          state: 2,
          uid: 1,
          dispose: () => {
            order.push('dispose-frontend')
          },
        },
      }),
    })

    const loaded = await loadPlugin({ manifest, frontend, backend: backendDeps({ supervisor }) }, { parts: 'both' })
    await loaded.unload()

    expect(order).toEqual(['stop-backend', 'dispose-frontend'])
  })
})
