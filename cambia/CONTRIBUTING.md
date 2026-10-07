# 参与 Cambia

## 三条硬规定

1. **包名不可变**：`@cambia/core` 现在就是最终包名。将来若改为 vendor 源码，只换内部实现、包名不动（kernel.md 5.3.1 规则 3）。改包名视为 breaking。
2. **cordis 显式固定版本、不跟 dist-tag**：`cordis@4.0.0-rc.10` 写死在 `packages/core/package.json`（不带 `^`）。升级必须跑通 `packages/core/test/semantics/` 的上游行为锁定测试，并把结论回写 implementation.md 的事实表。
3. **内核实现层不出现 Tauri 符号**：`packages/*` 与 `crates/plugin-host` 不许 import Tauri。Tauri 接线只存在于 `crates/tauri-plugin-cambia`（独立 workspace、独立 CI 轨道，根 workspace 里已 `exclude`）。检验标准是**删掉整个适配层，内核测试仍然全绿**。

## 语言约定

- **代码一律英文**：注释、测试名、lint 报错文案等一切代码里的文本，理由是这个仓库要开源、外人读到的就是这些
- **文档暂时中文**：`docs/`、`CONTRIBUTING.md`、各 README 与 CHANGELOG 先保持中文，之后再单独做一轮（`packages/core/test/semantics/README.md` 里引用的注释标记已经是 `// Locks:` / `// Needed by:`）

## 常用命令

```bash
pnpm check                                  # 一次跑完：build → typecheck → test → lint
pnpm lint                                   # eslint（规则集见下）
pnpm --filter @cambia/core test             # 上游行为锁定测试（cordis 升级的唯一安全网）
pnpm --filter cambia-example-hello-plugin test   # 契约测试（示例插件装载 → 卸载）
pnpm --filter @cambia/core check:publish    # publint + attw（导出范围回归的代价极高）
```

## lint：上游隔离规则是真的会报错的检查

kernel.md 5.3.1 的两条规则由 `@cambia/eslint-config` 强制（[../packages/eslint-config](../packages/eslint-config)），仓库内部与插件模板共用同一份：

- **规则 1**：插件只 import `@cambia/core`——`no-restricted-imports` 封住 `cordis` 与 `@cambia/core/*` 子路径
- **规则 2**：声明合并目标只能是 `@cambia/core`——`no-restricted-syntax` 封住 `declare module 'cordis'`

`examples/**` 按插件预设检查；`packages/**` 是内核实现层，本来就直连上游。**规则真的会报错**这件事由 `packages/eslint-config/test/rules.test.ts` 断言：故意违规的 fixture 必须被拦在对应规则上，真实的示例插件必须零告警。

## 发布流程（changesets）

- 任何改动都带一个 changeset：`pnpm changeset`（`.changeset/*.md` 里写清"改了什么、为什么"，别只写版本类型）
- 发版：`pnpm version-packages`（改版本 + 生成 CHANGELOG）→ 提交 → `pnpm release`（先 `pnpm -r build` 再 `changeset publish`）
- `@cambia/*` 用 **fixed 模式**（`.changeset/config.json`）：组内包版本统一；`private: true` 的包被 changesets 跳过（等它能发布时再加入组内一致）
- **首次发布**：`@cambia/core@0.1.0` 的版本与 CHANGELOG 已由 changesets 生成（K1.3），只差 registry 上的那一次 `pnpm --filter @cambia/core publish`。发布前需要两件外部前提：npm 上 `@cambia` scope 可用，以及定下"公开发布还是私有 registry"（plan.md D0 的欠账）
