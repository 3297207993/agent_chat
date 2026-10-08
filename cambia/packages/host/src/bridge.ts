/**
 * The `PluginHostBridge` seam: everything the load layer needs from the surrounding host.
 *
 * The host side of the line (kernel.md 1.9) must not know how a plugin file on disk becomes
 * something `import()` can fetch — that is the adapter layer's business (implementation.md 3.2(e),
 * 3.3(g)), and keeping it out is what makes "delete the adapter layer and the kernel still holds"
 * a checkable claim.
 *
 * This seam holds only the ports the host really needs; the count follows real demand rather than a
 * rule. Today it is one. `readText` and `listInstalled` join it when the install orchestration lands
 * (K2.5), process supervision adds `spawn` / `stop` in K2.6 — nothing is reserved for a hypothetical
 * second host, and no port is added before something calls it.
 *
 * When the second port lands, **split by capability instead of growing this interface**: a consumer
 * declares only the capabilities it uses, and the aggregate a caller may pass is their intersection.
 * The reason is not tidiness — `createFrontendLoader` must not receive a type that claims it can
 * spawn processes, because then every frontend load test would have to fake a process manager.
 * With a single capability there is nothing to split yet, so it stays one interface (docs/design/host.md).
 *
 * Two rules decide a port's side (docs/design/host.md):
 *
 * 1. Whatever must outlive the WebView, or needs OS privileges or has to cross CSP, is implemented on
 *    the Rust side — TS declares, Rust implements, and TS stays the orchestration centre.
 * 2. `moduleURL` exists for the bundle that will be `import()`-ed, and nothing else: internal files
 *    (the manifest) must go through `readText`, so they never depend on the host's CSP.
 */

/** Implemented by the adapter layer (Tauri). The kernel side of this module never sees any of it. */
export interface PluginHostBridge {
  /**
   * Plugin-root-relative path → a URL `import()` can fetch.
   *
   * The platform fork (`http://asset.localhost/…` on Windows, `asset://localhost/…` elsewhere,
   * implementation.md fact 7) lives in the adapter layer's URL helper: this module neither builds
   * URLs nor contains the string `asset` (CONTRIBUTING hard rule 3).
   */
  moduleURL(relativePath: string): Promise<string>
}
