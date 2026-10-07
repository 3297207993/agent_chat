// 故意违规：声明合并目标写成了上游（kernel.md 5.3.1 规则 2）
export {}

declare module 'cordis' {
  interface Events {
    'demo/bad'(payload: string): void
  }
}
