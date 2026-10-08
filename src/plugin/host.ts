import { Context, FiberState, type Plugin } from "@cambia/core";
import {
  DEFAULT_ENTRY,
  ERROR_CODES,
  PluginError,
  checkEngines,
  isPluginError,
  parseManifest,
  type Manifest,
} from "@cambia/host";
import storageManifest from "./host-pieces/storage/cambia.json";
import viewsManifest from "./host-pieces/views/cambia.json";
import "./vocabulary";

/**
 * 宿主的身份。manifest 的 `engines.host` 必须匹配它——版本改了却不改这里，插件会在启动时
 * **响亮地**失败（engines 判定不通过），而不是悄悄跑在错误的宿主上。
 */
const HOST_ID = "agent-chat";
const HOST_VERSION = "0.1.0";

/** 运行的内核版本，对应 `cambia/packages/core/package.json`。 */
const CAMBIA_VERSION = "0.1.0";

/** 插件目录的清单（由 `scripts/build-plugins.mjs` 扫描产出），相对应用根。 */
const CATALOG_PATH = "plugins/index.json";

/**
 * 宿主件的入口：**编译进应用**的模块（pluginization.md §2 / §6）。
 *
 * 它们是宿主自己的一部分，没有包也没有 URL，所以入口在这里静态映射——这是"宿主件"与"插件包"
 * 唯一的区别。功能插件一律从插件目录装载：读 manifest 文本 → 校验 → 解析入口 URL → import。
 */
const HOST_MODULES: Record<string, () => Promise<unknown>> = {
  storage: () => import("./host-pieces/storage"),
  views: () => import("./host-pieces/views"),
};

/** 宿主件自己的 manifest。宿主件没有磁盘包，所以走编译期导入（`resolveJsonModule` 已开）。 */
const HOST_MANIFEST_TEXT: Record<string, string> = {
  storage: JSON.stringify(storageManifest),
  views: JSON.stringify(viewsManifest),
};

/** 内置插件只支持随应用启动。按需激活（`<prefix>:<pattern>`）宿主侧还没实现。 */
const ACTIVATION_ALWAYS = "always";

/**
 * 等激活的上限。
 *
 * 内核侧"等 `ACTIVE` 的超时"归 K2.3，尚未落地；码表里也还没有这个码（所以这里抛的是普通
 * Error，不是带 spec code 的 PluginError）。没有它，一个依赖等不到的插件会让启动静默挂住。
 */
const MOUNT_TIMEOUT_MS = 5_000;

/**
 * 已启动的宿主 context。
 *
 * 组件树走 `<PluginHostProvider>` + `useHost()`；**非组件代码**（如 `lib/ai/runAgent.ts` 的 prompt
 * 装配）用 `hostContext()` 取服务。两者是同一个 context——`bootHost()` 记录的就是它返回的那个，
 * 所以不存在"两套宿主"的可能。
 */
let bootedHost: Context | null = null;

/**
 * 装载一个插件包：**读 manifest 文本 → 解析 → 校验 → engines 判定 → 解析入口 → 装载**。
 *
 * 这里没有"编译期解析入口"这条特殊路：功能插件一律是磁盘上的包，入口就是 manifest 里写的相对路径。
 * 宿主件（`storage` / `views`）只在"入口从哪来"上不同——它们是宿主自己的模块，走 `HOST_MODULES`。
 */
async function loadPlugin(ctx: Context, item: MountPlanItem) {
  const manifest = readManifest(item.name, item.manifestText);
  const entry = (await item.loadEntry(manifest)) as PluginEntry;
  return mount(ctx, manifest, entry);
}

/**
 * 宿主启动：创建内核根 context，装载宿主件与插件目录里的全部插件（pluginization.md 的 P1）。
 *
 * 两类**走同一套关**（读文本 → 校验 → engines → 等 `ACTIVE` / `FAILED`），差别只在入口来源：
 * 宿主件是编译进来的模块，其余是插件目录里由 manifest 指定的 bundle。装载顺序不由宿主规定——
 * 依赖写在插件的 `inject` 里、由内核解析，所以先把所有插件挂上去，再统一等判定。
 */
export async function bootHost(): Promise<Context> {
  const ctx = new Context();
  const mounting: Promise<void>[] = [];
  const failures: string[] = [];

  const plan = await planMounts();

  for (const item of plan) {
    try {
      mounting.push(loadPlugin(ctx, item));
    } catch (error) {
      failures.push(describe(error));
    }
  }

  for (const result of await Promise.allSettled(mounting)) {
    if (result.status === "rejected") failures.push(describe(result.reason));
  }

  if (failures.length > 0) {
    throw new Error(`插件装载失败：\n- ${failures.join("\n- ")}`);
  }

  bootedHost = ctx;
  return ctx;
}

interface MountPlanItem {
  /** 目录名（宿主件就是它的名字），只用于报错定位。 */
  readonly name: string;
  readonly manifestText: string;
  /** 入口来源：宿主件返回编译进来的模块，插件包按 manifest 里的相对路径取 URL 再 import。 */
  readonly loadEntry: (manifest: Manifest) => Promise<unknown>;
}

/**
 * 装配清单：先宿主件，再扫插件目录的清单。
 *
 * 插件目录里的清单是**构建期扫描的产物**（`scripts/build-plugins.mjs` 扫 `cambia.json` 得到），
 * 运行期只管消费它——所以"内置"与"外部装进来"在宿主眼里是同一个东西。
 */
async function planMounts(): Promise<MountPlanItem[]> {
  const plan: MountPlanItem[] = Object.keys(HOST_MODULES).map((name) => ({
    name,
    manifestText: HOST_MANIFEST_TEXT[name],
    loadEntry: HOST_MODULES[name],
  }));

  const base = new URL(CATALOG_PATH, document.baseURI);

  let catalog: { plugins?: unknown };
  try {
    const response = await fetch(base);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = (await response.json()) as { plugins?: unknown };
  } catch (error) {
    throw new Error(`读不到插件目录清单 ${base.href}：${describe(error)}。先跑 pnpm build:plugins`);
  }

  const names = Array.isArray(catalog.plugins) ? (catalog.plugins as unknown[]) : [];
  for (const name of names) {
    if (typeof name !== "string") continue;

    const dir = new URL(`${name}/`, base);
    plan.push({
      name,
      manifestText: await fetchText(new URL("cambia.json", dir)),
      // 入口由 manifest 说了算（相对插件目录），宿主不猜文件名
      loadEntry: (manifest) => {
        const entry = manifest.parts?.frontend?.main ?? DEFAULT_ENTRY;
        return import(/* @vite-ignore */ new URL(entry, dir).href);
      },
    });
  }

  return plan;
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new PluginError({
      code: ERROR_CODES.LOAD_FETCH_FAILED,
      path: url.pathname,
      message: `读不到 ${url.href}（HTTP ${response.status}）`,
    });
  }
  return response.text();
}

/** 取已启动的宿主 context；给非组件代码用（组件用 `useHost()`）。 */
export function hostContext(): Context {
  if (!bootedHost) {
    throw new Error("宿主尚未启动：hostContext() 只能在 bootHost() 成功之后调用");
  }
  return bootedHost;
}

/** 读 manifest 文本 → 解析 → 校验 → engines 判定。任何一步不过都带着 spec 错误码抛出。 */
function readManifest(path: string, text: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new PluginError({
      code: ERROR_CODES.MANIFEST_PARSE_FAILED,
      path,
      message: `${path} 不是合法 JSON`,
      cause: error,
    });
  }

  const manifest = parseManifest(json);

  const events = manifest.activationEvents ?? [ACTIVATION_ALWAYS];
  if (!events.includes(ACTIVATION_ALWAYS)) {
    throw new PluginError({
      code: ERROR_CODES.MANIFEST_ACTIVATION_EVENT_INVALID,
      path,
      message: `${manifest.id} 声明了按需激活（${events.join(", ")}）；内置插件只支持随应用启动`,
    });
  }

  const verdict = checkEngines(manifest, {
    cambia: CAMBIA_VERSION,
    host: `${HOST_ID}@${HOST_VERSION}`,
  });
  if (!verdict.ok) {
    throw new PluginError({
      code: verdict.code,
      path,
      message: `${manifest.id} 的 engines 与运行时不符：${verdict.mismatches
        .map((mismatch) => `${mismatch.subject}（${mismatch.detail}）`)
        .join("；")}`,
    });
  }

  return manifest;
}

/**
 * 挂一个插件并**等它真的激活**。
 *
 * `await ctx.plugin()` 等的是惯性、不是激活（cambia 的 K1.1 事实 10），所以判定只能自己观察：
 * 先订阅 `internal/status`、再重读一次 `fiber.state`，关掉"订阅之前已经迁移"的窗口。
 */
/** 入口模块的形状（按入口约定检查，不假设它是什么类型）。 */
interface PluginEntry {
  apply?: unknown;
}

/**
 * 挂一个插件并**等它真的激活**。
 *
 * `await ctx.plugin()` 等的是惯性、不是激活（cambia 的 K1.1 事实 10），所以判定只能自己观察：
 * 先订阅 `internal/status`、再重读一次 `fiber.state`，关掉"订阅之前已经迁移"的窗口。
 */
async function mount(ctx: Context, manifest: Manifest, entry: PluginEntry): Promise<void> {
  const id = manifest.id;

  if (typeof entry.apply !== "function") {
    throw new PluginError({
      code: ERROR_CODES.LOAD_NO_APPLY,
      path: id,
      message: `${id} 的入口没有导出 apply，不是一个插件入口`,
    });
  }

  const plugin = entry as unknown as Plugin;
  const fiber = ctx.plugin(plugin);
  const uid = fiber.uid;

  // 判定落地之后才去读它的 rejection；这个 handler 只是避免 unhandled rejection
  Promise.resolve(fiber).then(undefined, () => {});

  let undo: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settled = new Promise<number>((resolve) => {
    undo = ctx.on("internal/status", (changed) => {
      if (changed.uid !== uid) return;
      if (changed.state === FiberState.ACTIVE || changed.state === FiberState.FAILED) {
        resolve(changed.state);
      }
    });
    if (fiber.state === FiberState.ACTIVE || fiber.state === FiberState.FAILED) {
      resolve(fiber.state);
    }
  });

  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${id} 在 ${MOUNT_TIMEOUT_MS}ms 内没有激活：inject = [${waitingOn(plugin)}]。` +
            `内核的激活超时归 K2.3，这里是宿主侧兜底`,
        ),
      );
    }, MOUNT_TIMEOUT_MS);
  });

  try {
    const state = await Promise.race([settled, timedOut]);

    if (state === FiberState.FAILED) {
      const reason = await Promise.resolve(fiber).then(
        () => undefined,
        (error: unknown) => error,
      );
      throw new PluginError({
        code: ERROR_CODES.LOAD_EVALUATION,
        path: id,
        message: `${id} 激活失败：${describe(reason)}`,
        cause: reason,
      });
    }
  } finally {
    clearTimeout(timer);
    undo?.();
  }
}

function waitingOn(plugin: Plugin): string {
  if (!plugin.inject) return "";
  return Array.isArray(plugin.inject) ? plugin.inject.join(", ") : Object.keys(plugin.inject).join(", ");
}

function describe(value: unknown): string {
  if (isPluginError(value)) return `[${value.code}] ${value.message}`;
  return value instanceof Error ? value.message : String(value);
}
