import { invoke } from '@tauri-apps/api/core'

/** What `plugin:cambia|module_url` answers. */
export interface ModuleUrlResponse {
  url: string
}

/**
 * The `moduleURL` port (docs/design/host.md): a plugin-root-relative path becomes a URL the webview
 * can `import()`.
 *
 * Deliberately thin — one `invoke`, no caching and no retry. A retry would hide the one conclusion
 * K2.4 has to produce ("the channel is not configured"), and a cache would let the adapter's answer
 * outlive the installation it describes. Failures are handed on as the Rust side reported them:
 * classifying them (not allowed / not there / not JavaScript) belongs to `@cambia/host`.
 */
export async function moduleURL(path: string): Promise<string> {
  const response = await invoke<ModuleUrlResponse>('plugin:cambia|module_url', {
    payload: { path },
  })

  return response.url
}
