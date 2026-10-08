/**
 * 插件构建预设：把一个插件包打成宿主能装载的单文件 ESM。
 *
 * 主张：**插件自己产出，宿主只负责安装**。包自己的 `build` 跑这个预设写进自己的 `dist/`；宿主的
 * 编排脚本用同一个预设把产物写进插件目录（`public/plugins/<name>/`）。两条路共用同一份实现，所以
 * "能自己构建"与"宿主能装"不会漂移。
 *
 * ## 共享 React
 *
 * 插件包是独立 bundle，不能把 `react` 留成裸导入（浏览器解析不了），也不能自带一份（两份 React
 * 会让 hooks 直接抛 invalid hook call）。做法是 **宿主注入全局 + 构建期改写 import**：
 *
 * 1. 宿主启动时把 React 放到 `globalThis.__AGENT_CHAT_SHARED__`，**然后**才 import 插件包；
 * 2. 构建期把 `import { useState } from "react"` 改写成 `import __r from "<shim>"; const useState =
 *    __r.useState;`——也就是运行时属性访问。
 *
 * 必须改写而不是逐名转发：React 的具名导出里有**类**（`Component`，会被 `class X extends Component`
 * 用）和**符号**（`Fragment` / `Suspense`），转发成函数就废了。JSX 运行时也转发宿主那份官方运行时
 * ——用 `createElement` 自己拼会丢掉 React 对静态子元素的标记，冒出一堆假的 key 警告。
 */
import { createRequire } from "node:module";
import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const require = createRequire(import.meta.url);

/** 宿主注入共享依赖用的全局键（与 `src/plugin/shared.ts` 必须一致）。 */
const SHARED_KEY = "__AGENT_CHAT_SHARED__";

const SHIM_REACT_ID = "\0agent-chat-react-shim";
const SHIM_JSX_ID = "\0agent-chat-jsx-shim";

const SHARED = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime"]);

/** 契约包只许 `import type`；真出现运行时导入会被自包含断言拦下。 */
const TYPE_ONLY_PACKAGES = [/^@cambia\//, /^@agent-chat\//, "cordis"];

/**
 * 打一个插件包。
 *
 * @param dir    插件包根目录（含 `cambia.json` 与 `src/index.ts`）
 * @param outDir 产物目录；manifest 的 `parts.frontend.main` 就写在这里
 */
export async function buildPlugin(dir, outDir) {
  const manifest = JSON.parse(await readFile(path.join(dir, "cambia.json"), "utf8"));
  const entryName = manifest.parts?.frontend?.main ?? "index.js";
  const entry = path.join(dir, "src", "index.ts");
  const state = { external: [] };

  await build({
    configFile: false,
    logLevel: "warn",
    root: dir,
    // 包目录里没有 public/，而 Vite 会去拷它 —— 关掉，别让它去猜
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
      lib: { entry, formats: ["es"], fileName: () => entryName },
      rollupOptions: { external: TYPE_ONLY_PACKAGES },
    },
  });

  // manifest 原样拷过去：主字段写的就是产物名，宿主只认 manifest 不看目录约定
  await cp(path.join(dir, "cambia.json"), path.join(outDir, "cambia.json"));

  const id = manifest.id ?? dir;
  assertSelfContained(id, state);
  await assertRunnable(id, path.join(outDir, entryName));
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
 * 正常路径上具名导出用不到（import 已被改写），留着是为了"改写漏了"时函数类 API 仍然能跑。
 */
const REACT_SHIM_SOURCE = `${shimPrelude()}
export default new Proxy({}, { get: (_, prop) => react()[prop] });
${reactForwarders()}
`;

/**
 * JSX 运行时的 shim：**转发宿主那份官方 jsx 运行时**。
 *
 * `Fragment` 必须转发 React 的真符号，否则与宿主渲染树里的 Fragment 不是同一个东西。
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

/** 产物不能带任何外部导入：浏览器解析不了裸标识符，插件加载就会失败。 */
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
 * 产物要能**带着真 React 求值**并导出 `apply`。
 *
 * 它顺带证明另一件事：插件模块可能在模块初始化时就用到 React（lucide-react 就在模块级建了一个
 * context），所以宿主必须**先注入共享依赖、再 import 插件包**——顺序不是可选项。
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
