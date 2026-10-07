// Deliberate violation: the declaration-merging target is upstream (kernel.md 5.3.1 rule 2)
export {}

declare module 'cordis' {
  interface Events {
    'demo/bad'(payload: string): void
  }
}
