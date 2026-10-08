/**
 * 插件构建流水线：**扫描 cambia.json → 逐个打成单文件 ESM → 产出目录清单**。
 *
 * 产物落在 `public/plugins/<name>/`（dev 由 Vite 静态服务，app build 时原样拷进 dist），形态与
 * "外部装进来的插件包"完全一致——宿主那条装载路径不区分两者。
 *
 * ## 共享 React 怎么解决
 *
 * 插件包是独立 bundle，不能把 `react` 留成裸导入（浏览器解析不了），也不能自带一份（两份 React
 * 会让 hooks 直接抛 invalid hook call）。这里走 **宿主注入的全局 + 构建期改写 import**：
 *
 * 1. 宿主启动时把 React 放到 `globalThis.__AGENT_CHAT_SHARED__.react`，**然后**才 import 插件包；
 * 2. 构建期把每个模块里的 `import { useState } from "react"` 改写成
 *    `import __r from "<shim>"; const useState = __r.useState;`——也就是运行时属性访问。
 *
 * 为什么必须改写（而不是生成一份逐名转发的 shim）：`react` 的具名导出里有**类**（`Component`，
 * 会被 `class X extends Component` 用）和**符号**（`Fragment` / `Suspense`），转发函数会把它们
 * 变成不可用的东西。改写之后所有形态都保持原样，也不需要维护一份 API 名单。
 *
 * 这一层与 Vite 在 dev 下处理 CJS 依赖是同一个手法。代价是插件包在模块初始化时就会读那个全局，
 * 所以**宿主必须先注入再加载**——这条由 `assertBundle` 的求值检查兜住。
 *
 * ## 两条硬约束（构建后逐条断言）
 *
 * 1. **产物必须自包含**：不能残留任何裸导入（`@cambia/core` 只许 `import type`）。残留裸导入 =
 *    浏览器解析不了 = 插件加载即失败。
 * 2. **必须导出 `apply`**：入口约定（kernel.md 3.2）。
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const builtinDir = path.join(root, "src", "plugin", "builtin");
const outRoot = path.join(root, "public", "plugins");

/**
 * 宿主件：由宿主**编译进来**、不可卸载（pluginization.md §2 / §6），不参与扫描。
 *
 * 它们不能成为独立包：`storage` 要拿宿主的 Dexie 引擎（打进去就是第二个实例、同一个库被打开
 * 两次），`views` 是外壳的注册点本身。
 */
const HOST_PIECES = ["storage", "views"];

/** 宿主注入共享依赖用的全局键。 */
const SHARED_KEY = "__AGENT_CHAT_SHARED__";

const SHIM_REACT_ID = "\0agent-chat-react-shim";
const SHIM_JSX_ID = "\0agent-chat-jsx-shim";

const SHARED = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime"]);

async function main() {
  const names = await scan();
  if (names.length === 0) throw new Error(`没有扫描到任何插件：${builtinDir}`);

  await rm(outRoot, { recursive: true, force: true });

  for (const name of names) await buildOne(name);

  await writeFile(
    path.join(outRoot, "index.json"),
    `${JSON.stringify({ plugins: names }, null, 2)}\n`,
  );

  console.log(`\n插件包已产出：${names.length} 个 → public/plugins/`);
  for (const name of names) console.log(`  - ${name}`);
}

/** 扫 builtin 下每个含 cambia.json 的目录，宿主件排除在外。 */
async function scan() {
  const entries = await readdir(builtinDir, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (HOST_PIECES.includes(entry.name)) continue;
    if (!existsSync(path.join(builtinDir, entry.name, "cambia.json"))) continue;
    names.push(entry.name);
  }
  return names.sort();
}

async function buildOne(name) {
  const dir = path.join(builtinDir, name);
  const outDir = path.join(outRoot, name);
  const state = { external: [] };

  await build({
    configFile: false,
    logLevel: "warn",
    root,
    // 产物就写在 public/plugins/ 里，而 Vite 默认会把 publicDir 拷进 outDir —— 那是自我递归
    publicDir: false,
    // JSX 交给 esbuild 编成对 react/jsx-runtime 的 import，再由下面的改写接住
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    plugins: [sharedDepsPlugin(state)],
    build: {
      outDir,
      emptyOutDir: true,
      target: "es2022",
      minify: false,
      sourcemap: true,
      lib: { entry: path.join(dir, "index.ts"), formats: ["es"], fileName: () => "index.js" },
      // 只有类型导入的包挂在这里；真出现运行时导入会被下面的断言拦下
      rollupOptions: { external: [/^@cambia\//, "cordis"] },
    },
  });

  // manifest 原样拷过去：主字段写的就是产物名（index.js），宿主只认 manifest 不看目录约定
  await cp(path.join(dir, "cambia.json"), path.join(outDir, "cambia.json"));

  assertSelfContained(name, state);
  await assertRunnable(name, path.join(outDir, "index.js"));
}

/**
 * 把 `react` / JSX 运行时的导入改写成对 shim 默认导出的属性访问。
 *
 * 排在 `post`：要等 esbuild 把 TS/JSX 编译掉，才能用普通 JS 解析器（`this.parse`）读它。
 */
function sharedDepsPlugin(state) {
  return {
    name: "agent-chat:shared-deps",
    enforce: "post",
    resolveId(id) {
      if (id === SHIM_REACT_ID || id === SHIM_JSX_ID) return id;
      // 改写漏网时（比如动态 import）把裸标识符指到 shim 上，别留成裸导入
      if (!SHARED.has(id)) return undefined;
      return id === "react" ? SHIM_REACT_ID : SHIM_JSX_ID;
    },
    load(id) {
      if (id === SHIM_REACT_ID) return REACT_SHIM_SOURCE;
      if (id === SHIM_JSX_ID) return JSX_SHIM_SOURCE;
      return undefined;
    },
    transform(code, id) {
      if (!/\.[cm]?[jt]sx?$/.test(id)) return undefined;
      if (!code.includes("react")) return undefined;
      return rewriteSharedImports(this, code);
    },
    /**
     * 自包含检查用 Rollup 自己的账本，而不是扫文本。
     *
     * 扫文本会假阳性：react-router 的源码里就有 `from "${chunk.module}"` 这样的字符串模板（它在
     * 生成 import 语句），跟真的导入长得一样。`chunk.imports` 只有**真的**外部依赖。
     */
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        state.external.push(...item.imports, ...item.dynamicImports);
      }
    },
  };
}

/**
 * 就地改写共享依赖的 import 声明。
 *
 * - `import { a, b as c } from "react"` → `import __r from "<react shim>"; const a = __r.a, c = __r.b;`
 * - `import * as R from "react"`        → `import R from "<react shim>";`（默认导出就是那份对象）
 * - `import { jsx as _jsx } from "react/jsx-runtime"` → 同一个套路，换成 JSX shim
 *
 * 返回 `undefined` 表示这个文件不用改。
 */
function rewriteSharedImports(ctx, code) {
  let ast;
  try {
    ast = ctx.parse(code);
  } catch {
    return undefined;
  }

  const edits = [];
  let counter = 0;

  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue;
    const source = node.source?.value;
    if (!SHARED.has(source)) continue;

    const shim = source === "react" ? SHIM_REACT_ID : SHIM_JSX_ID;
    const temp = `__agentChat${source === "react" ? "React" : "Jsx"}${++counter}`;

    const defaults = node.specifiers.filter((s) => s.type === "ImportDefaultSpecifier");
    const namespaces = node.specifiers.filter((s) => s.type === "ImportNamespaceSpecifier");
    const named = node.specifiers.filter((s) => s.type === "ImportSpecifier");

    // 默认导出的名字优先复用（`import React, { useState } from "react"`）
    const holder = defaults[0]?.local.name ?? namespaces[0]?.local.name ?? temp;
    const lines = [`import ${holder} from ${JSON.stringify(shim)};`];

    if (named.length > 0) {
      const pairs = named.map((s) => {
        const imported = s.imported.name ?? s.imported.value;
        return `${s.local.name} = ${holder}.${imported}`;
      });
      lines.push(`const ${pairs.join(", ")};`);
    }

    edits.push({ start: node.start, end: node.end, text: lines.join("\n") });
  }

  if (edits.length === 0) return undefined;

  let out = code;
  for (const edit of edits.reverse()) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { code: out, map: null };
}

/**
 * React 的 shim：默认导出是一个**转发到宿主实例的 Proxy**，具名导出按 React 自己的名字生成。
 *
 * 正常路径上具名导出用不到（import 已被改写），留着是为了"改写漏了"时函数类 API 仍然能跑；
 * 类与符号那两类必须走默认导出，所以改写才是主路径。
 */
const REACT_SHIM_SOURCE = `${shimPrelude()}
export default new Proxy({}, { get: (_, prop) => react()[prop] });
${reactForwarders()}
`;

/**
 * JSX 运行时的 shim：**转发宿主那份官方 jsx 运行时**。
 *
 * 不能用 `createElement` 自己拼：React 的 `jsx/jsxs` 会给静态子元素打标记（`children` 是编译期
 * 已知的数组），少了这个标记，`<button>{a}{b}</button>` 这类写法会开始报 "unique key" 警告。
 *
 * `Fragment` 必须转发 React 的真符号（而不是包一个组件），否则与宿主渲染树里的 Fragment 不是
 * 同一个东西。这三者都在模块初始化时取——宿主保证先注入、后加载。
 */
const JSX_SHIM_SOURCE = `${shimPrelude()}
const runtime = () => {
  const shared = globalThis.${SHARED_KEY};
  if (!shared?.jsxRuntime) {
    throw new Error("宿主未注入共享 JSX 运行时：插件包只能在宿主启动之后加载");
  }
  return shared.jsxRuntime;
};

export const jsx = (...args) => runtime().jsx(...args);
export const jsxs = (...args) => runtime().jsxs(...args);
export const jsxDEV = (...args) => (runtime().jsxDEV ?? runtime().jsx)(...args);
export const Fragment = runtime().Fragment;

export default { jsx, jsxs, jsxDEV, Fragment };
`;

function shimPrelude() {
  return `
const react = () => {
  const shared = globalThis.${SHARED_KEY};
  if (!shared?.react) {
    throw new Error("宿主未注入共享 React：插件包只能在宿主启动之后加载");
  }
  return shared.react;
};
`;
}

function reactForwarders() {
  const react = require("react");
  const names = Object.keys(react).filter(
    (name) => !name.startsWith("__") && typeof react[name] === "function",
  );
  return names.map((name) => `export const ${name} = (...args) => react().${name}(...args);`).join("\n");
}

/**
 * 自包含断言：产物**不能带任何外部导入**（`@cambia/core` 之类的裸标识符浏览器解析不了）。
 *
 * 这份账本来自 Rollup 的 chunk 元数据（见 `generateBundle`），不是扫文本。
 */
function assertSelfContained(name, state) {
  const external = [...new Set(state.external)];
  if (external.length > 0) {
    throw new Error(
      `${name} 的产物带着外部导入：${external.join(", ")}。` +
        `插件包必须自包含（共享依赖走宿主注入的 ${SHARED_KEY}，其余打进来）`,
    );
  }
}

/**
 * 可运行性断言：**能带着真 React 求值并导出 `apply`**。
 *
 * 它顺带证明另一件事：**插件模块可能在模块初始化时就用到 React**（lucide-react 就在模块级建了
 * 一个 context），所以宿主必须**先注入共享依赖、再 import 插件包**——顺序不是可选项。
 */
async function assertRunnable(name, file) {
  globalThis[SHARED_KEY] = {
    react: require("react"),
    jsxRuntime: require("react/jsx-runtime"),
  };
  const module = await import(pathToFileURL(file).href);
  if (typeof module.apply !== "function" && typeof module.default?.apply !== "function") {
    throw new Error(`${name} 的产物没有导出 apply，不是一个插件入口`);
  }
}

await main();
