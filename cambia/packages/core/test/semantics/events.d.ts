// 这套测试锁的是上游 Cordis 本身，所以直接对 'cordis' 做声明合并。
// 插件与示例代码必须对 '@cambia/core' 做（kernel.md 5.3.1），这里的例外仅限 test/semantics。
declare module 'cordis' {
  interface Events {
    /** 观察型：不等待监听者 */
    'lock/emit'(payload: string): void
    /** 环绕中间件：监听者收到 (payload, next)，派发时最后一个参数是终止实现 */
    'lock/waterfall'(payload: string, next: () => any): any
    /** 顺序 await，返回第一个非 null/false/undefined 的值；不注入 next */
    'lock/serial'(payload: string): any
    /** 第一个返回非 null/false/undefined 的监听者生效 */
    'lock/bail'(payload: string): any
    /** 并发等待所有监听者 */
    'lock/parallel'(payload: string): Promise<void>
    /** 通用：用于观察顺序、参数个数、回收行为等 */
    'lock/probe'(...args: any[]): any
  }
}

export {}
