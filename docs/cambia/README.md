# Cambia 文档集

本目录收录**插件内核（Cambia）**的规范。

- [kernel.md](./kernel.md) — Cambia 内核规范：服务仓库、inject、类型化事件、effect 反卷绕、插件装载与包格式、仓库形态与路线
- [implementation.md](./implementation.md) — Cambia 实现方案：逐模块的选型结论（复用哪个现成方案 / 哪些必须自研）、已核查的依赖事实、工具链、测试与风险

> **内核与宿主的分工**：内核交付机制（服务认领、依赖解析、事件派发、可逆注册、装载），宿主定义领域词汇表（服务键位、事件名与负载、插槽位置）。内核零业务依赖、不 import 本项目任何代码——它是将来独立成仓库的那部分。
> **宿主侧文档不在本目录**："一切皆插件"的目标与迁移路线是本项目自己的规划，见 [../pluginization.md](../pluginization.md)。

## 当前形态（已定案）

- **JS 侧直接用 Cordis**，内核语义不自研；`@cambia/core` 冻结插件面向的 API（见 [kernel.md](./kernel.md) 5.3.1）
- **全信任同进程**：第三方插件与宿主同 realm、同一 `ctx`，不做 Worker 隔离（见 [kernel.md](./kernel.md) 1.7）
- **插件不受能力限制**：无门控、无审批，manifest 无能力声明字段；防线是"只装可信插件"（见 [kernel.md](./kernel.md) 4）
- 插件 bundle **必须** external 掉 Cordis 与 `@cambia/core`（见 [kernel.md](./kernel.md) 3.2）

## 与其他文档的关系

- 本项目插件化规划：[../pluginization.md](../pluginization.md)
- 需求：[../requirements.md](../requirements.md)
- 应用设计（非插件部分）：[../design.md](../design.md)
- UI 设计：[../ui-design.md](../ui-design.md)
