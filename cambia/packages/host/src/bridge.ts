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
 * (K2.5), process supervision adds its own in K2.6 — nothing is reserved for a hypothetical second
 * host, and no port is added before something calls it.
 *
 * The split rule for deciding a port's side (docs/design/host.md): whatever must outlive the WebView,
 * or needs OS privileges or has to cross CSP, is implemented on the Rust side — TS declares, Rust
 * implements, and TS stays the orchestration centre.
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
