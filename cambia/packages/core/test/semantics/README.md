# 上游行为锁定测试（K1.1）

这套测试**不测试 Cambia 自己的代码**，它测试的是上游 [Cordis](https://github.com/cordiverse/cordis) 的实际行为：
把我们已经实测确认、并且**设计直接建立在上面**的上游行为，钉成断言。上游一变，这里红灯。

固定版本：`cordis@4.0.0-rc.10`（在 `packages/core/package.json` 里写死，不带 `^`）。
理由见 [implementation.md](../../../docs/implementation.md) 事实 1：cordis 的 `dist-tags.next` 长期停在 beta，
`latest` 就是 rc——跟随 dist-tag 升级等于把全体插件暴露给上游补丁。

## 三条写作规则

> 代码侧（注释、测试名、报错文案）一律英文，文档暂时中文——这一批先把代码改成英文，文档之后再单独处理。

1. **每条用例都要写两行注释**：

   ```ts
   // Locks: which upstream behaviour is pinned
   // Needed by: which part of this kernel's design depends on it (kernel.md / implementation.md)
   ```

   断言本身不自解释（有些期望值看起来像 bug，例如"装载成功的 promise 立即 resolve"）。
   没有这两行注释，将来红灯时没人敢动它，安全网就变成了绊脚石。

2. **期望值必须来自实测，不能抄文档**。写用例的流程是：读上游源码 → 写探针实跑 → 记录观察到的值 → 写断言。
   本套用例的每个数字都对应一次真实运行；`kernel.md` 2.2 / 2.3 与 `implementation.md` 事实表就是这些观测的产物。
   如果实测与文档不一致，**以实测为准，并回写文档**（`plan.md` 第 0 节的执行纪律）。

3. **这里是唯一允许直接 `import` cordis 的地方**。插件与示例代码必须只用 `@cambia/core`（kernel.md 5.3.1）；
   这套测试锁的是上游本身，所以它直连上游，还要对上游做声明合并（见 `events.d.ts`）。

## 两个实现细节（不是风格问题）

- **不要 import `FiberState`**。上游把它声明成 `const enum`（`cordis/lib/fiber.d.ts`），运行期没有实体：
  在 TS 里受 `isolatedModules` 限制不能用，在 vitest（esbuild）下编译出来会是 `undefined`。
  所以状态值按声明顺序写死在 `helpers.ts` 的 `State` 里，用断言直接钉住这些数字——
  六个值在 `status.test.ts` 的迁移序列里全都会出现（`0→1→2`、`1→5→3`、`2→5→4`），
  上游一旦重新编号，这里必然红灯。
  契约层（`@cambia/core`）导出的那份运行期 `FiberState` 是**被测对象**，本套测试不拿它当期望值——
  用被测对象的产物去断言被测对象，等于把安全网拆了。两者的关系由 `examples/hello-plugin` 的契约测试盯着。
- **凡涉及时间的用例都要显式等待**（`tick()`），不要依赖"刚好来得及"。唯一例外是"不该等"的用例，
  它们断言的是**立即**返回（例如 `await ctx.plugin()` 对依赖等不到的插件 0ms 就 resolve）。

## 这套测试锁住了什么（速查）

| 区域 | 锁定的行为 | 用例文件 |
|---|---|---|
| 五种派发 | `emit` 不等、`waterfall` 的终止实现与短路、`serial` 不注入 `next`、`bail` 的三值判定、`parallel` 聚合错误 | `dispatch.test.ts` |
| effect | 注册顺序执行、**按注册逆序撤销**、非激活上下文注册抛 `INACTIVE_EFFECT`、监听者随卸载回收 | `effect.test.ts` |
| inject | 依赖就绪才执行 `apply`；**等不到时零信号且不阻塞 `await ctx.plugin()`**；依赖到位后自己激活 | `inject.test.ts` |
| 状态与事件 | **状态没变化就不发 `internal/status`**；事件里 `fiber.state` 已是新值；`1 → 5 → 3` 这类非直线路径；卸载从未激活的插件**一个事件都不发** | `status.test.ts` |
| 服务 | `ctx.set` 未经 `provide` 会抛错、`provide` 可逆、同名服务不能二次注册、别的 fiber 不能替提供者 `set` | `service.test.ts` |
| 注册表 | `registry.values() → runtime.fibers` 可枚举 `name/uid/state/inject`；最后一个 fiber 卸载后 runtime 消失 | `registry.test.ts` |

## 红灯了怎么办

先判断是"上游变了"还是"我们记错了"（这两件事的处理完全不同）：

1. 跑 `git log`/npm 看上游是否发了新版；本仓库固定在 `cordis@4.0.0-rc.10`，所以红灯**只可能**来自
   手工升级、或 vendor 之后改了源码。
2. 若是上游行为变化：**不要直接改断言**。先回答"我们哪一处设计建立在这条行为上"（注释里的"依赖"行），
   再决定是跟着改设计、还是触发 vendor（[implementation.md](../../../docs/implementation.md) 3.1 的三条触发条件）。
3. 结论回写 [implementation.md](../../../docs/implementation.md) 的事实表 / 风险表。

## 运行

```bash
pnpm --filter @cambia/core test        # 跑这套测试
pnpm --filter @cambia/core typecheck   # 类型检查（含 Events 声明合并是否仍然成立）
```
