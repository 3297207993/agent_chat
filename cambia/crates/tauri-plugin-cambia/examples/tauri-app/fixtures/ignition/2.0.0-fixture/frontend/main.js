/**
 * The ignition fixture (K2.4, minimal version): the smallest thing that is a real Cambia plugin.
 *
 * Deliberately a hand-written ES module with **no runtime imports at all**. A real plugin does not need
 * any either — `@cambia/core` is imported with `import type` and `declare module` only (see
 * `examples/hello-plugin/src/index.ts`), so nothing in a plugin bundle has to resolve a bare specifier
 * inside the webview. Skipping even a build step makes the fixture answer exactly one question: **does a
 * file reached through the asset protocol become an ES module the kernel can activate?**
 *
 * It exposes its own transcript so the harness can tell "the module was fetched" apart from "`apply`
 * ran" apart from "the fiber went active" apart from "unloading undid the registration".
 */

export const marker = 'cambia-ignition-fixture'

/** Filled in by {@link apply}, read back by the harness through the loaded module object. */
export const transcript = []

export function apply(ctx, config) {
  transcript.push('apply')

  // A reversible registration: the key exists while the plugin is live and disappears when it is
  // unloaded, which is what makes "it activated" observable from outside (kernel.md 1.3 / 6.2).
  ctx.provide('ignition', { marker, config: config ?? null })

  ctx.effect(() => {
    transcript.push('effect-open')
    return () => transcript.push('effect-close')
  })
}
