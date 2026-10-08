/**
 * The `PluginHostBridge` seam: everything the load layer needs from the surrounding host.
 *
 * The host side of the line (kernel.md 1.9) must not know how a plugin file on disk becomes
 * something `import()` can fetch — that is the adapter layer's business (implementation.md 3.2(e),
 * 3.3(g)), and keeping it out is what makes "delete the adapter layer and the kernel still holds"
 * a checkable claim.
 *
 * One method is deliberate: this seam exists to isolate the host, not to invent an adapter
 * framework. K2.5's install orchestration and K2.6's process supervision add their own methods as
 * they need them — nothing is reserved for a hypothetical second host.
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
