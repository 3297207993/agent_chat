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
import "./vocabulary";

/**
 * 宿主的身份。manifest 的 `engines.host` 必须匹配它——版本改了却不改这里，内置插件会在启动时
 * **响亮地**失败（engines 判定不通过），而不是悄悄跑在错误的宿主上。
 */
const HOST_ID = "agent-chat";
const HOST_VERSION = "0.1.0";

/** 运行的内核版本，对应 `cambia/packages/core/package.json`。 */
const CAMBIA_VERSION = "0.1.0";

/**
 * 内置插件的入口在编译期解析，所以文件名固定；manifest 的 `parts.frontend.main` 必须写它。
 * 第三方插件的入口由 manifest 指向磁盘上的 bundle，走 `asset:` 通道（P5）。
 */
const BUILTIN_ENTRY = "index.ts";

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
 * 内置插件的发现：`builtin/<name>/` 一个目录 = 一个插件包（`cambia.json` + 入口）。
 *
 * manifest 读**文本**再解析，与从磁盘装载那条路一致（先拿字节、再解析、再校验）；
 * 入口用编译期的动态 import——内置插件在 bundle 里，没有磁盘路径，也就不需要 `asset:` 通道。
 */
const manifests = import.meta.glob("./builtin/*/cambia.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const entries = import.meta.glob("./builtin/*/index.ts") as Record<string, () => Promise<unknown>>;

/**
 * 宿主启动：创建内核根 context，装载内置插件（pluginization.md 的 P1）。
 *
 * 每个插件都要过一遍与第三方相同的关：读 manifest 文本 → 校验 → engines 判定 → 解析入口 →
 * 等 `ACTIVE` / `FAILED`。返回时它们**已经激活**，所以调用方可以直接渲染。
 *
 * 挂载顺序不由宿主规定：依赖写在插件的 `inject` 里、由内核解析，所以这里先把所有插件挂上去，
 * 再统一等判定。
 */
export async function bootHost(): Promise<Context> {
  const ctx = new Context();
  const mounting: Promise<void>[] = [];
  const failures: string[] = [];

  for (const path of Object.keys(manifests).sort()) {
    try {
      const manifest = readManifest(path, manifests[path]);
      const main = manifest.parts?.frontend?.main ?? DEFAULT_ENTRY;

      if (main !== BUILTIN_ENTRY) {
        throw new PluginError({
          code: ERROR_CODES.MANIFEST_FIELD_INVALID,
          path,
          message: `${manifest.id} 的 parts.frontend.main 是 "${main}"；内置插件的入口在编译期解析，必须写 "${BUILTIN_ENTRY}"`,
        });
      }

      const entry = `${path.slice(0, path.lastIndexOf("/"))}/${BUILTIN_ENTRY}`;
      const load = entries[entry];

      if (load === undefined) {
        throw new PluginError({
          code: ERROR_CODES.LOAD_FETCH_FAILED,
          path,
          message: `找不到 ${manifest.id} 的入口模块 ${entry}`,
        });
      }

      mounting.push(mount(ctx, manifest, load));
    } catch (error) {
      failures.push(describe(error));
    }
  }

  for (const result of await Promise.allSettled(mounting)) {
    if (result.status === "rejected") failures.push(describe(result.reason));
  }

  if (failures.length > 0) {
    throw new Error(`内置插件装载失败：\n- ${failures.join("\n- ")}`);
  }

  return ctx;
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
async function mount(ctx: Context, manifest: Manifest, loadEntry: () => Promise<unknown>): Promise<void> {
  const id = manifest.id;
  // 入口是任意模块：下面只按入口约定检查它，不假设它是什么类型
  const entry = (await loadEntry()) as { apply?: unknown };

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
