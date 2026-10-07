// This suite pins upstream Cordis itself, so it merges declarations into 'cordis' directly.
// Plugins and example code must target '@cambia/core' instead (kernel.md 5.3.1); the exception
// here is limited to test/semantics.
declare module 'cordis' {
  interface Events {
    /** Observation: does not wait for listeners */
    'lock/emit'(payload: string): void
    /** Around-middleware: listeners receive (payload, next), and the last dispatch argument is the terminating implementation */
    'lock/waterfall'(payload: string, next: () => any): any
    /** Sequential await; returns the first value that is not null/false/undefined; no `next` injected */
    'lock/serial'(payload: string): any
    /** The first listener returning something other than null/false/undefined wins */
    'lock/bail'(payload: string): any
    /** Waits for every listener concurrently */
    'lock/parallel'(payload: string): Promise<void>
    /** Generic probe: used to observe ordering, argument counts, recycling and the like */
    'lock/probe'(...args: any[]): any
  }
}

export {}
