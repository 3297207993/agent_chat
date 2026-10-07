# @cambia/core

## 0.1.0

### Minor Changes

- 首次发布：`@cambia/core` 的公开 API 契约（K1.2）。
  
  - 白名单再导出：`Context` / `Service` / `Fiber` / `FiberState` 与派发（`DispatchMode` / `EventOptions`）、effect（`Disposable` / `Effect` / `EffectMeta`）、插件形状（`Plugin` / `Inject` / `InjectKey`）相关类型
  - `exports` 只留 `"."`，不暴露 `./src/*` 与子路径
  - 声明合并目标：事件名写进 `Events`，服务键写进 `Services`
  - `FiberState` 补一份运行期真值（上游把它声明成 `const enum`，运行期没有实体），数值由上游行为锁定测试钉住
