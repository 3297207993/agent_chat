# Cambia 实现计划

> 本文是**执行顺序**：把 [kernel.md](./kernel.md) 的规范与 [implementation.md](./implementation.md) 的选型落成有序的批次。
> 粒度是「阶段 → 批次」：每批给出**交付物 / 依赖 / 可并行项 / 验收标准**（验收 = 该批的完成定义，不通过不进入下一批）。
> **不含工期估计**——原因见文末；相对顺序与并行机会全部写在依赖栏里。

三份文档的分工：**kernel 说"承诺什么"、implementation 说"用什么做"、本文说"先做什么"**。批次的验收标准一律引用前两者的条款，不在这里重新定义语义。

---

## 0. 执行纪律

- **语义回归测试第一批就做**（K1.1）：它既是升级上游的唯一安全网，也是团队"读懂 Cordis"的手段。之后每次 cordis 版本变动，它都是准入条件。
- **上游行为一旦被测试锁住，就不许绕**：implementation 事实 10 / 11 记录的（`await ctx.plugin()` 立即 resolve、依赖等不到不发事件、`apply` 死等则 state 停在 `LOADING`）都是"设计建立在实测之上"的例子——改为回归用例，上游一变就红灯。
- **每批结束回写文档**：批次中发现的与 implementation 冲突的事实，回写 implementation 的事实表/风险表；规范层面的改动回写 kernel。**不允许"代码和文档各说一套"**。
- **一批 = 一次评审能看完的量**：批内再拆由执行者决定，但不要把跨批的验收混在一起。

---

## 1. 关键路径与并行轨道

关键路径（串行不可省）：

```
D0 建仓 → K1.1 语义回归集 → K1.2 core 冻结面 → K2.3 装载最小闭环
        → K2.6 安装管线 → K2.7 后端进程与协议 → K3.1 spec v1 冻结
        → K3.2 kit → K3.3 参考插件与第二宿主
```

**K2.1（装载路径 spike）不在关键路径上，但它卡住 K2.3**：它必须与 K1 并行开工，因为它是全项目唯一"没有权威依据、只能实测"的一环（implementation 3.8 条目 2）。spike 失败的代价是 K2.3 的装载层重写，所以要**最早暴露**。

| 轨道 | 内容 | 何时可开工 | 与谁有接口 |
|---|---|---|---|
| **A** JS 内核与宿主 | K1.* → K2.2–K2.5、K2.8 | D0 后 | 与 B 共享错误码表与命令面 |
| **B** Rust crate | K2.6 的 crate 部分、K2.7 的进程与协议 | D0 后（不依赖 core，可完全并行） | 同上 |
| **C** spike + E2E 基建 | K2.1、K2.8 的 E2E 设施 | D0 后（**越早越好**） | 只依赖宿主 fixture 与 implementation 3.2(e) |
| **D** spec / 发布 / 文档 | K2.2 的 schema、K3.1 | K1.2 后 | 与 A/B 共享错误码表 |
| **E** 宿主适配层（Tauri） | `tauri-plugin-cambia`：K2.1 的接线骨架 → K2.6 的命令面与权限 → K2.7 的退出回收 → K3.4 分发 | D0 后（**独立 workspace / CI 轨道**） | 只依赖 `plugin-host` 与 Tauri，**不碰内核语义**（implementation 3.3(g)） |

**适配层不是关键路径上的东西**——检验标准是"把它整个删掉，内核照旧成立"。所以它不设 Gate、不阻塞任何批次；但它是 K2.1 的宿主 fixture 的天然载体（接线只写一次，别在 examples 里重写一遍）。

**唯一需要刻意协调的冲突点**：JS 与 Rust 两侧共用的**错误码表与命令面**。做法：在 K2.2 一起定稿后再各自推进，之后由"双端一致性测试"守住（K2.6 验收项）。

---

## 2. D0 建仓（骨架）

| 项 | 内容 |
|---|---|
| **交付物** | 独立仓库 `cambia`（kernel 5.1 的目录形态：`packages/{core,host,kit}`、`crates/plugin-host`、`crates/tauri-plugin-cambia`、`spec/`、`examples/`）；pnpm workspace + Rust workspace（**根 workspace `exclude` 适配层**，它自成独立 workspace）；CI 分两条轨道（核心无 tauri / 适配层三平台，见 implementation 3.6）；lint 规则集包；`tsup` 与 `vitest` 骨架；changesets；CONTRIBUTING（含"包名不可变""cordis 显式钉版本、不跟 dist-tag""机制层不出现 Tauri 符号"三条硬规定） |
| **依赖** | 无 |
| **验收** | `pnpm -r build` / `pnpm -r test` / `cargo test` 在空实现下全绿；CI 三平台跑通；npm `@cambia` scope 已注册占位（kernel 7 的建议）；插件模板与内部共用同一份 eslint 配置，且违规代码能被拦下 |

---

## 3. K1 —— 内核面（`@cambia/core`）

### K1.1 语义回归集（**最先做**）

| 项 | 内容 |
|---|---|
| **交付物** | `packages/core/test/semantics/`：五种派发（waterfall 的终止实现参数、`next` 二次调用抛错、serial 不注入 `next`、bail 的 `v !== null/false/undefined`）、effect 反卷绕顺序、`inject` 就绪与未满足、`internal/status` 的**触发与不触发**、fiber 状态值与实测一致（含 `1 → 5 → 3` 这类非直线路径）、`provide` 与 `ctx.set` 的分工 |
| **依赖** | D0 |
| **验收** | 全部用例在 `cordis@4.0.0-rc.10` 通过；每条用例注明"锁的是哪条上游行为、本内核为什么依赖它"（否则将来没人敢改） |
| **回收** | implementation 事实 10 / 11 由"实测结论"升级为"回归保护" |

### K1.2 `@cambia/core` 冻结面

| 项 | 内容 |
|---|---|
| **交付物** | 白名单再导出（`Context` / `Service` / `Fiber` / `FiberState` / `Events` / 派发与 effect 类型）、`exports` 只留 `"."`、`Events` 声明合并目标、版本化契约规则（语义变更 = major）、类型测试（类型断言用例） |
| **依赖** | K1.1（语义清楚才谈冻结） |
| **验收** | `examples/` 里的示例插件只用 `@cambia/core` 就能写出 inject + effect + 事件的完整插件，且**不 import cordis**；`publint` + `@arethetypeswrong/cli` 通过 |

### K1.3 防腐层执法与发布管线

| 项 | 内容 |
|---|---|
| **交付物** | eslint 规则（`no-restricted-imports` 封 cordis、禁 `declare module 'cordis'`）并在示例上验证**真的会报错**；changesets 发布流程；`@cambia/core@0.1.0` 首次发布（或私有 registry） |
| **依赖** | K1.2 |
| **验收** | 故意违规的示例构建失败；`npm pack` 产物只暴露 `"."` 入口 |

### K1.4 vendor 决策复核（时间触发，不阻塞）

| 项 | 内容 |
|---|---|
| **交付物** | 对照 implementation 3.1 的三条触发条件，逐条记录当前上游状态与结论；若触发 → vendor 流程与改动日志模板 |
| **依赖** | K1.2 |
| **验收** | 有书面结论（做 / 不做 + 依据），不悬空 |

---

## 4. K2 —— 装载与宿主运行时（`@cambia/host`）

### K2.1 spike：动态 `import()` 装载路径（**越早越好**）

| 项 | 内容 |
|---|---|
| **交付物** | 最小 Tauri fixture + `@cambia/host` 的装载壳；**fixture 直接建在适配层的最小版本上**（注册 scheme / 配 asset scope + 取路径 + 退出回收骨架，见 implementation 3.3(g)），接线不重复写两遍；证明 `asset:` 放行插件目录后 `import()` 能装载 ESM；记录平台寻址差异（Windows `http://asset.localhost/…` vs macOS/Linux `asset://localhost/…`）与所需 CSP（host-source 形式） |
| **依赖** | D0（与 K1 并行；不需要 core） |
| **验收** | Windows/WebView2 装载成功，且能重复装载两个不同版本的同一插件；**失败则回落自定义 scheme 并重做本批**，结论与最小复现写回 implementation 3.8 条目 2 |

### K2.2 manifest 与校验

| 项 | 内容 |
|---|---|
| **交付物** | zod schema（kernel 3 字段全集）+ `z.toJSONSchema()` 生成 `spec/v1/manifest.schema.json` + CI diff 守卫；`engines` 判定（JS `semver` / Rust `node-semver`）；**错误码表初稿**（JS 与 Rust 共用，决定两侧命令面） |
| **依赖** | K1.2 |
| **验收** | `examples/` 全量过校验；非法 manifest（路径越界、未知 parts、缺 `engines`、平台键不合法）各有对应错误码；schema 生成物与代码一致（CI 验证） |

### K2.3 装载最小闭环（K2 的"能跑起来"）

| 项 | 内容 |
|---|---|
| **交付物** | loader（读 manifest → 未激活归因 → `import()` → `ctx.plugin()`）、**装载判定显式等 `ACTIVE` / `FAILED`**、卸载路径（`fiber.dispose()`）、headless 宿主 fixture（无 Tauri，vitest + happy-dom） |
| **依赖** | K1.2、K2.1、K2.2 |
| **验收** | 装载 → 注册 → 卸载 → **监听数归零、认领键位消失**（kernel 6.2 验收项）；对 implementation 事实 10 写一条回归测试，保证判定不依赖 `await ctx.plugin()` |

### K2.4 未激活归因与保险丝

| 项 | 内容 |
|---|---|
| **交付物** | 未激活归因（无认领者 / 互相等待 / 待定，implementation 3.2(d)）、**等 `ACTIVE` 的超时**、`FAILED` 记录、降级禁用表 + 手动重试入口、禁用表持久化接口（宿主提供 KV） |
| **依赖** | K2.3 |
| **验收** | 两个插件互相 `inject` 时得到**具名归因**（哪个键位、谁在等谁）；`apply` 死等的插件被超时判失败并记录；两类失败各有测试（implementation 3.2(d)/(g)） |

### K2.5 视图插槽运行时

| 项 | 内容 |
|---|---|
| **交付物** | 插槽位置解析、渲染器键位查找、**headless no-op 实现**、iframe 视图容器（无同源） |
| **依赖** | K2.3 |
| **验收** | 无 UI 宿主下注册为 no-op 且不报错（kernel 1.6）；有 UI fixture 下三档 UI 贡献（声明式表单 / 渲染器 / iframe）各跑通 |

### K2.6 安装管线（JS ↔ Rust 联动）

| 项 | 内容 |
|---|---|
| **交付物** | crate：`.tap` 打包与解包（**唯一实现**、可复现规范）、sha256 校验、下载到 staging、原子替换 + journal 恢复；host：安装 / 卸载 / 更新的编排，specifier 采用 `<version>-<hash>` 路径；**适配层：命令面（install / uninstall / list / enable）+ `permissions/` 权限文件** |
| **依赖** | K2.3 + crate 的打包与下载批次 |
| **验收** | 并发安装 / 更新 / 卸载幂等；**注入式故障下按 journal 恢复**；Windows 文件占用场景有确定行为（先停后端再替换，失败则延迟到下次启动）；**JS 打的包能被 Rust 解、Rust 打的包能被 JS 校验**（双端一致性） |

### K2.7 后端进程托管与控制面协议

| 项 | 内容 |
|---|---|
| **交付物** | 进程监督器（spawn / 启动超时 / 重启退避 / 优雅关闭 / 退出全量回收）、`process-wrap` 的 job object 与进程组配置、JSONL JSON-RPC 薄层（双向、id 关联、超时、取消、错误码）、代理 Service、Node 与 Python 最小 SDK（`examples/`）；**适配层：`RunEvent::ExitRequested` / `Exit` 的回收钩子** |
| **依赖** | K2.6（先能装，再谈起） |
| **验收** | 宿主退出后**无孤儿进程**（Windows 断言，含"后端再起孙进程"用例）；两语言 SDK 跑同一组协议用例结论一致；协议与错误码写进 `spec/` |

### K2.8 K2 收口：E2E 与性能基线

| 项 | 内容 |
|---|---|
| **交付物** | WebdriverIO + `@wdio/tauri-service` 的 E2E（真实 WebView：装载、CSP 生效、iframe 视图）；性能基线（装载耗时、N 次重装的堆增长） |
| **依赖** | K2.4、K2.5、K2.7 |
| **验收** | Windows/Linux 进 CI，macOS 有记录（implementation 3.8 条目 12）；堆增长曲线有数据——**量化已知成本，而不是假装不存在** |

---

## 5. K3 —— 生态件

### K3.1 spec v1 冻结

| 项 | 内容 |
|---|---|
| **交付物** | manifest schema、控制面协议、错误码表、版本与废弃窗口规则，全部冻结 |
| **依赖** | K2.6、K2.7 |
| **验收** | **无已知待定项**（评审时逐条核对 implementation 3.8）；JS 与 Rust 对同一批 fixtures 判定一致的测试通过 |

### K3.2 `@cambia/kit`

| 项 | 内容 |
|---|---|
| **交付物** | `cac` + `@clack/prompts` 命令面（`create` / `dev` / `build` / `pack` / `doctor`）、`giget` 模板、Vite 预设 + **构建期断言**（产物出现 cordis 副本即失败）、打包调用 crate 的 pack API |
| **依赖** | K3.1、K2.6（pack API） |
| **验收** | 从零 `cambia create` → `cambia build` → `cambia pack` 产出的 `.tap` 能被宿主装载并激活；`cambia doctor` 能报出 implementation 3.2 的四类典型错误 |

### K3.3 参考插件与第二宿主验证

| 项 | 内容 |
|---|---|
| **交付物** | 2–3 个领域无关示例插件（含后端进程、含视图贡献各一）；examples 里的第二个宿主 fixture |
| **依赖** | K3.2 |
| **验收** | 第二个宿主可用 Cambia 起步（kernel 5.2 的 K3 验收项）；示例插件在 CI 上全量构建 + 装载 |

### K3.4 适配层分发与接入体验

| 项 | 内容 |
|---|---|
| **交付物** | crate 发 crates.io、guest-js 发 npm（`@cambia/plugin-cambia`）；`[package.metadata.platforms.support]` 标桌面三平台 `full`、移动端 `none`；接入文档（两行接入 + 一份配置 + CSP 片段）；Tauri 插件目录提交（可选的分发动作） |
| **依赖** | K3.1、K2.7 |
| **验收** | **一个只使用 crates.io / npm 产物的空白 Tauri 应用，能在十分钟内装载并激活第一个插件**（这是"接线只写一次"的兑现检验）；**删除演练**：把适配层整个删掉，`plugin-host` 与 `@cambia/host` 的测试仍全绿——不通过就说明有语义漏进了适配层 |

---

## 6. Gate 清单（不通过不进下一阶段）

| Gate | 通过条件 |
|---|---|
| **G1 → 进 K2** | core 冻结面已发布；语义回归集全绿；示例插件不 import cordis；lint 能拦住违规 |
| **G2 → 进 K2.6** | 装载最小闭环通过（含**归零断言**）；装载判定不依赖 `await ctx.plugin()`；spike 结论已回写 |
| **G3 → 进 K3** | E2E 通过；无孤儿进程；协议双 SDK 一致；journal 恢复测试通过 |
| **G4 → spec v1** | 待定项清零；双端判定一致性测试通过 |

---

## 7. 待定项卡在哪里（与 implementation 3.8 对应）

| 待定项 | 卡在哪一批 | 说明 |
|---|---|---|
| 动态 `import()` 从 `asset:` 装载（条目 2） | **K2.1** | 唯一"无权威依据、只能实测"的一环，也是全项目最大的单点风险 |
| `tsdown` 是否替换 `tsup`、zod schema 转换边界（条目 9） | K1.2 / K2.2 | 不卡路径，批内验证即可 |
| vendor 触发（条目 1） | K1.4 | 时间触发，不阻塞任何批次 |
| 后端崩溃重启策略的具体参数（退避、次数上限） | K2.7 | 属实现细节，用测试钉死行为即可 |

---

## 8. 为什么本文没有排期

不写日期与人天，是因为排期的两个输入都不在文档里：**团队投入**（几人、是否专职）与**上游节奏**（cordis 何时发正式版、Tauri 的 scheme 行为是否变化）。硬给数字只会制造"计划有了"的错觉。

本文提供的是排期真正需要的两样东西：**相对顺序**（第 1 节的关键路径）与**可并行项**（各批的"依赖"与"可并行"栏）。拿到人力之后，按轨道 A–D 分配即可；若只有一人，就按关键路径串行，spike（K2.1）尽量提前到 K1 期间插空做——它是唯一一个失败会导致返工的部分。
