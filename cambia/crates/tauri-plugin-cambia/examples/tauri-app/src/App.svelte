<script>
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { Context } from '@cambia/core'
  import { createFrontendLoader, unloadFrontend, FIBER_STATE } from '@cambia/host'
  import { moduleURL, spawn, call, kill } from '@cambia/plugin-cambia'

  /** The fixture the experiment places under the plugin root before starting. */
  const FIXTURE = 'ignition/1.0.0-fixture/frontend/main.js'
  /** The same content under a second path: a new specifier, so the module graph must give a new instance. */
  const FIXTURE_V2 = 'ignition/2.0.0-fixture/frontend/main.js'

  let log = $state('')
  let backend = $state(null)

  /** Every line goes to the window and to `<app_data_dir>/ignition.log`, so the result survives. */
  async function record(line) {
    log = `[${new Date().toLocaleTimeString()}] ${line}\n` + log
    try {
      await invoke('ignition_log', { line })
    } catch (error) {
      console.error('ignition_log failed', error)
    }
  }

  /**
   * K2.4's minimal version: fetch the fixture through the asset protocol, import it, run it through the
   * real kernel, and take it back down.
   *
   * `moduleURL` is the whole bridge — `createFrontendLoader` knows nothing about Tauri, which is the
   * claim this experiment also tests in passing ("delete the adapter and the kernel still holds").
   */
  async function ignite() {
    await record('--- ignition start ---')

    try {
      const url = await moduleURL(FIXTURE)
      await record(`moduleURL ok: ${url}`)
    } catch (error) {
      await record(`moduleURL FAILED: ${JSON.stringify(error)}`)
      return
    }

    const ctx = new Context()
    const loader = createFrontendLoader({ moduleURL })

    // A race is required, not defensive: without the K2.3 activation timeout, a plugin that never
    // activates keeps `load` pending forever (docs/design/host.md). The experiment must still end.
    const verdict = await Promise.race([
      loader.load(ctx, FIXTURE),
      new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 5000)),
    ])

    if (verdict === 'TIMEOUT') {
      await record('load TIMED OUT after 5s — the verdict never arrived (K2.3 is the missing piece)')
      return
    }

    await record(`load verdict: state=${verdict.state} (${verdict.state === FIBER_STATE.ACTIVE ? 'ACTIVE' : 'not ACTIVE'})`)
    await record(`loaded module marker: ${verdict.module.marker}`)
    await record(`fixture transcript: ${JSON.stringify(verdict.module.transcript)}`)
    await record(`service key while active: ${ctx.ignition ? 'present' : 'MISSING'}`)

    unloadFrontend(verdict)
    await new Promise((resolve) => setTimeout(resolve, 200))

    await record(`fixture transcript after unload: ${JSON.stringify(verdict.module.transcript)}`)
    await record(`service key after unload: ${ctx.ignition ? 'STILL THERE' : 'gone'}`)

    // The other half of the load contract (implementation.md 3.2(e)): an ES module cannot be unloaded,
    // so reloading has to change the specifier — and the same specifier has to hit the same instance.
    // Both directions are measured here, because the first is what makes reinstalling correct and the
    // second is what makes it necessary.
    const sameAgain = await loader.load(ctx, FIXTURE)
    await record(
      `same path again: ${sameAgain.module === verdict.module ? 'SAME module instance' : 'DIFFERENT instance (!)'}`,
    )

    const reloaded = await loader.load(ctx, FIXTURE_V2)
    await record(
      `new path (2.0.0-fixture): ${reloaded.module === verdict.module ? 'SAME instance (!)' : 'NEW module instance'}`,
    )
    await record(`new instance transcript starts fresh: ${JSON.stringify(reloaded.module.transcript)}`)

    unloadFrontend(sameAgain)
    unloadFrontend(reloaded)
    await record('--- ignition end ---')
  }

  onMount(ignite)

  async function startBackend() {
    try {
      // A backend in its argv form: a system interpreter plus a script. The smallest thing that can
      // hold a conversation — it answers the handshake, then echoes.
      const script = `
        const rl = require('readline').createInterface({ input: process.stdin })
        rl.on('line', (line) => {
          const m = JSON.parse(line)
          const result = m.method === '$/initialize' ? { protocolVersion: 1 } : m.params
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
        })
      `

      backend = await spawn({
        pluginId: 'demo',
        pluginVersion: '1.0.0',
        bin: ['node', '-e', script],
        root: '.',
        startTimeoutMs: 10_000,
        stopTimeoutMs: 5_000,
        restart: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 5_000 },
      })

      await record(`backend ready: generation ${backend.generation}, protocol ${backend.protocolVersion}`)

      const echoed = await call({
        pluginId: 'demo',
        generation: backend.generation,
        method: 'test/echo',
        params: { from: 'the webview' },
        timeoutMs: 5_000,
      })

      await record(`echo: ${JSON.stringify(echoed)}`)
    } catch (error) {
      await record(`spawn/call failed: ${JSON.stringify(error)}`)
    }
  }

  async function stopBackend() {
    if (!backend) return

    try {
      await record(`stopped: ${JSON.stringify(await kill({ pluginId: 'demo', timeoutMs: 5_000 }))}`)
      backend = null
    } catch (error) {
      await record(`kill failed: ${JSON.stringify(error)}`)
    }
  }
</script>

<main class="container">
  <h1>Cambia: K2.4 ignition</h1>

  <div class="row">
    <button onclick={ignite}>run ignition again</button>
    <button onclick={startBackend} disabled={backend !== null}>spawn backend</button>
    <button onclick={stopBackend} disabled={backend === null}>kill backend</button>
  </div>

  <pre>{log || 'Nothing yet.'}</pre>
</main>
