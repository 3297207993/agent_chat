<script>
  import { moduleURL, spawn, call, kill } from '@cambia/plugin-cambia'

  let log = $state('')
  let backend = $state(null)

  function record(value) {
    log = `[${new Date().toLocaleTimeString()}] ${typeof value === 'string' ? value : JSON.stringify(value)}\n` + log
  }

  async function askForModuleUrl() {
    try {
      // The `moduleURL` port: a plugin-root-relative path becomes something `import()` can fetch.
      // Whatever this answers is a URL into the asset protocol, i.e. exactly what K2.4 has to prove.
      record(await moduleURL('demo/1.0.0-abc123/frontend/main.js'))
    } catch (error) {
      record(`moduleURL failed: ${JSON.stringify(error)}`)
    }
  }

  async function startBackend() {
    try {
      // A backend in its argv form: a system interpreter plus a script. The script below is the
      // smallest thing that can hold a conversation — it answers the `$/initialize` handshake and then
      // echoes whatever it is asked.
      const script = `
        const rl = require('readline').createInterface({ input: process.stdin })
        rl.on('line', (line) => {
          const m = JSON.parse(line)
          const result = m.method === '$/initialize' ? { protocolVersion: 1 } : m.params
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
        })
      `

      // Starting it waits for the handshake: this call resolves once the backend is *ready*, or throws
      // with a spec code. There is no "starting" state to poll for.
      backend = await spawn({
        pluginId: 'demo',
        pluginVersion: '1.0.0',
        bin: ['node', '-e', script],
        root: '.',
        startTimeoutMs: 10_000,
        stopTimeoutMs: 5_000,
        restart: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 5_000 },
      })

      record(`backend ready: generation ${backend.generation}, protocol ${backend.protocolVersion}`)

      // The frame loop, the timeout and the cancellation all happen on the Rust side.
      const echoed = await call({
        pluginId: 'demo',
        generation: backend.generation,
        method: 'test/echo',
        params: { from: 'the webview' },
        timeoutMs: 5_000,
      })

      record(`echo: ${JSON.stringify(echoed)}`)
    } catch (error) {
      record(`spawn/call failed: ${JSON.stringify(error)}`)
    }
  }

  async function stopBackend() {
    if (!backend) return

    try {
      const reason = await kill({ pluginId: 'demo', timeoutMs: 5_000 })
      record(`stopped: ${JSON.stringify(reason)}`)
      backend = null
    } catch (error) {
      record(`kill failed: ${JSON.stringify(error)}`)
    }
  }
</script>

<main class="container">
  <h1>Cambia in a real Tauri app</h1>

  <div class="row">
    <button onclick={askForModuleUrl}>moduleURL(…)</button>
    <button onclick={startBackend} disabled={backend !== null}>spawn backend</button>
    <button onclick={stopBackend} disabled={backend === null}>kill backend</button>
  </div>

  <pre>{log || 'Nothing yet.'}</pre>
</main>
