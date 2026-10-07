# Cambia 文档集

本目录收录**插件内核（Cambia）**的规范与计划：

- [kernel.md](./kernel.md) — **规范**：内核承诺什么。包括服务仓库、inject、类型化事件、effect 逆序撤销、插件装载与包格式、仓库形态与路线
- [implementation.md](./implementation.md) — **实现方案**：用什么做。逐个模块写清楚复用了哪个现成方案、哪些必须自己写，以及已经核查过的依赖事实、工具链、测试与风险
- [plan.md](./plan.md) — **实施计划**：先做什么。K1–K3 的批次拆分、关键路径与可并行的部分、每批的验收标准与阶段门槛（不含工期）
- [design/](./design/README.md) — **模块设计**：某个模块具体怎么做。**动手实现之前先写**，**一个模块一个文件**（[../CONTRIBUTING.md](../CONTRIBUTING.md) 硬规定 4）

前三份是全局的；`design/` 是逐模块的，只写该模块的接口、数据流、失败路径与验收方式，不重复前三份的结论。

> **内核与宿主的分工**：内核交付机制（服务注册、依赖解析、事件派发、可逆注册、装载），宿主定义领域词汇（服务键、事件名与负载、插槽位置）。内核不含任何业务依赖、不 import 本项目任何代码——它是将来独立成仓库的那部分。
> **宿主侧文档不在本目录**："一切皆插件"的目标与迁移路线是本项目自己的规划，见 [../../docs/pluginization.md](../../docs/pluginization.md)。

## 几个容易看不懂的词

这些文档里有几个反复出现的词，含义如下：

| 词 | 意思 |
|---|---|
| **宿主** | 使用 Cambia 的那个应用本身（例如 agent_chat）。内核是库，宿主是把它装进去的程序 |
| **插件** | 一段可以装上、卸载、替换的功能代码。装上就能用，卸载后应用回到"从没装过它"的状态 |
| **装载** | 把插件代码从磁盘读进来并跑起来：先 `import()` 拿到模块，再交给 Cordis 启动 |
| **激活** | 插件声明的依赖都到位了、代码真正开始工作。装载完成不等于激活成功，两者之间有时间差 |
| **服务键** | 插件对外提供能力时用的名字，例如 `ctx.storage`。别人按键查找，不直接引用具体实现 |
| **inject** | 插件声明"我需要哪些服务键"。声明的依赖都到位了，插件才会激活 |
| **effect** | 可逆注册：`ctx.effect(() => { ...; return dispose })`。插件卸载时，这些注册按注册的逆序自动撤销 |
| **派发** | 把事件广播给监听者的方式，共五种（`emit` / `waterfall` / `parallel` / `serial` / `bail`），差别在于要不要等待、能不能改写结果 |
| **`.tap`** | 插件包的扩展名，本质是一个 ZIP，里面是 manifest + 插件代码（可选的后端程序、视图页面） |
| **上游** | 我们依赖的外部项目，这里通常指 Cordis 或 Tauri |

## 当前形态（已定案）

- **JS 侧直接用 Cordis**，内核语义不自研；`@cambia/core` 冻结插件面向的 API（见 [kernel.md](./kernel.md) 5.3.1）
- **全信任同进程**：第三方插件与宿主同 realm、同一 `ctx`，不做 Worker 隔离（见 [kernel.md](./kernel.md) 1.7）
- **插件不受能力限制**：没有能力管控、没有审批，manifest 里也没有能力声明字段；防线是"只装可信插件"（见 [kernel.md](./kernel.md) 4）
- 插件 bundle **必须** external 掉 Cordis 与 `@cambia/core`（见 [kernel.md](./kernel.md) 3.2）

## 与其他文档的关系

- 本项目插件化规划：[../../docs/pluginization.md](../../docs/pluginization.md)
- 需求：[../../docs/requirements.md](../../docs/requirements.md)
- 应用设计（非插件部分）：[../../docs/design.md](../../docs/design.md)
- UI 设计：[../../docs/ui-design.md](../../docs/ui-design.md)
