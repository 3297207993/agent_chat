/**
 * The backend half, over fakes.
 *
 * These tests are about orchestration, so the ports are faked and no process is involved: the Rust side
 * is where process behaviour is proven (crates/plugin-host/tests/supervisor.rs), and duplicating that
 * here would only test the fake. What matters on this side is the policy handling, the code mapping and
 * the two rules from docs/design/host.md (register after ready; a timeout is not a death).
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BACKEND_POLICY,
  backendErrorCode,
  createProxyService,
  registerProxies,
  startBackend,
  stopBackend,
  type BackendHandle,
  type BackendPolicy,
  type BackendSupervisor,
  type BackendTarget,
  type PluginTransport,
  type ProxySpec,
} from '../src/backend'
import { ERROR_CODES, isPluginError } from '../src/errors'

const handle: BackendHandle = {
  pluginId: 'demo',
  generation: 1,
  status: 'ready',
  protocolVersion: 1,
}

const target: BackendTarget = {
  pluginId: 'demo',
  pluginVersion: '1.2.3',
  bin: 'backend/app',
  root: '/plugins',
}

function fakeSupervisor(overrides: Partial<BackendSupervisor> = {}): {
  supervisor: BackendSupervisor
  started: Array<{ target: BackendTarget; policy: BackendPolicy }>
  stopped: Array<{ pluginId: string; timeoutMs: number }>
} {
  const started: Array<{ target: BackendTarget; policy: BackendPolicy }> = []
  const stopped: Array<{ pluginId: string; timeoutMs: number }> = []

  const supervisor: BackendSupervisor = {
    start: async (given, policy) => {
      started.push({ target: given, policy })
      return handle
    },
    stop: async (pluginId, timeoutMs) => {
      stopped.push({ pluginId, timeoutMs })
      return { generation: handle.generation, code: 0, expected: true }
    },
    ...overrides,
  }

  return { supervisor, started, stopped }
}

describe('startBackend', () => {
  it('fills in the policy defaults in one place', async () => {
    const { supervisor, started } = fakeSupervisor()

    await startBackend(target, supervisor, { startTimeoutMs: 2_500 })

    expect(started).toHaveLength(1)
    expect(started[0].policy.startTimeoutMs).toBe(2_500)
    expect(started[0].policy.stopTimeoutMs).toBe(DEFAULT_BACKEND_POLICY.stopTimeoutMs)
    expect(started[0].policy.restart).toEqual(DEFAULT_BACKEND_POLICY.restart)
  })

  it('merges a partial restart policy instead of replacing it', async () => {
    const { supervisor, started } = fakeSupervisor()

    await startBackend(target, supervisor, { restart: { maxAttempts: 7, baseDelayMs: 10, maxDelayMs: 20 } })

    expect(started[0].policy.restart.maxAttempts).toBe(7)
    expect(started[0].policy.restart.jitter).toBe(DEFAULT_BACKEND_POLICY.restart.jitter)
  })

  it('refuses a target that cannot work, without asking the port', async () => {
    const { supervisor, started } = fakeSupervisor()

    for (const broken of [
      { ...target, bin: '' },
      { ...target, bin: [] as readonly string[] },
      { ...target, bin: ['node', ''] },
      { ...target, pluginId: '' },
      { ...target, root: '' },
    ]) {
      await expect(startBackend(broken, supervisor)).rejects.toSatisfy(
        (error: unknown) => isPluginError(error) && error.code === ERROR_CODES.PROCESS_SPAWN_FAILED,
      )
    }

    expect(started).toHaveLength(0)
  })

  it('passes the verdict through: a failed start is a rejection, not a handle', async () => {
    const { supervisor } = fakeSupervisor({
      start: async () => {
        throw Object.assign(new Error('no handshake'), { code: ERROR_CODES.PROCESS_START_TIMEOUT })
      },
    })

    await expect(startBackend(target, supervisor)).rejects.toMatchObject({ code: ERROR_CODES.PROCESS_START_TIMEOUT })
  })
})

describe('stopBackend', () => {
  it('asks by id and reports how it left', async () => {
    const { supervisor, stopped } = fakeSupervisor()

    const reason = await stopBackend(handle, supervisor, { stopTimeoutMs: 1_234 })

    expect(stopped).toEqual([{ pluginId: 'demo', timeoutMs: 1_234 }])
    expect(reason).toMatchObject({ expected: true, code: 0 })
  })

  it('reports "nothing to stop" as null rather than inventing an exit', async () => {
    const { supervisor } = fakeSupervisor({ stop: async () => null })

    await expect(stopBackend(handle, supervisor)).resolves.toBeNull()
  })
})

describe('createProxyService', () => {
  const spec: ProxySpec = {
    key: 'sessions',
    methods: { append: 'sessions/append', read: 'sessions/read' },
    timeoutMs: 4_000,
  }

  it('maps service methods onto backend methods, passing params and the timeout', async () => {
    const calls: Array<{ method: string; params: unknown; timeoutMs: number }> = []
    const transport: PluginTransport = {
      call: async (_handle, method, params, timeoutMs) => {
        calls.push({ method, params, timeoutMs })
        return { ok: true }
      },
      onCall: () => () => {},
    }

    const service = createProxyService(spec, handle, transport)

    await expect(service.append({ text: 'hi' })).resolves.toEqual({ ok: true })
    await expect(service.read()).resolves.toEqual({ ok: true })

    expect(calls).toEqual([
      { method: 'sessions/append', params: { text: 'hi' }, timeoutMs: 4_000 },
      { method: 'sessions/read', params: null, timeoutMs: 4_000 },
    ])
  })

  it('keeps a timeout and a dead process apart', async () => {
    const timedOut = createProxyService(spec, handle, {
      call: async () => {
        throw Object.assign(new Error('slow'), { code: ERROR_CODES.PROTOCOL_CALL_TIMEOUT })
      },
      onCall: () => () => {},
    })

    await expect(timedOut.append()).rejects.toMatchObject({ code: ERROR_CODES.PROTOCOL_CALL_TIMEOUT })

    const gone = createProxyService(spec, handle, {
      call: async () => {
        throw Object.assign(new Error('gone'), { code: ERROR_CODES.PROCESS_EXITED })
      },
      onCall: () => () => {},
    })

    await expect(gone.append()).rejects.toMatchObject({ code: ERROR_CODES.PROCESS_EXITED })
  })

  it('names the service method in the failure, so a log points at the call that failed', async () => {
    const service = createProxyService(spec, handle, {
      call: async () => {
        throw Object.assign(new Error('gone'), { code: ERROR_CODES.PROCESS_EXITED })
      },
      onCall: () => () => {},
    })

    await expect(service.append()).rejects.toMatchObject({ path: 'sessions.append' })
  })
})

describe('registerProxies', () => {
  it('registers every key and undoes in reverse', () => {
    const order: string[] = []
    const provide = (key: string): (() => void) => {
      order.push(`provide:${key}`)
      return () => order.push(`release:${key}`)
    }

    const transport: PluginTransport = { call: async () => null, onCall: () => () => {} }
    const dispose = registerProxies(
      [
        { key: 'a', methods: { go: 'a/go' }, timeoutMs: 1 },
        { key: 'b', methods: { go: 'b/go' }, timeoutMs: 1 },
      ],
      handle,
      transport,
      provide,
    )

    expect(order).toEqual(['provide:a', 'provide:b'])
    dispose()
    expect(order).toEqual(['provide:a', 'provide:b', 'release:b', 'release:a'])
  })
})

describe('backendErrorCode', () => {
  it('reads the code the adapter passed through', () => {
    expect(backendErrorCode({ code: ERROR_CODES.PROCESS_EXITED })).toBe(ERROR_CODES.PROCESS_EXITED)
  })

  it('does not guess: anything unfamiliar is an internal error', () => {
    expect(backendErrorCode(new Error('plain failure'))).toBe(ERROR_CODES.PROTOCOL_INTERNAL_ERROR)
    expect(backendErrorCode({ code: 'NOT_A_CODE' })).toBe(ERROR_CODES.PROTOCOL_INTERNAL_ERROR)
    expect(backendErrorCode(undefined)).toBe(ERROR_CODES.PROTOCOL_INTERNAL_ERROR)
  })
})
