import { Context, FiberState, type Plugin } from "@cambia/core";
import "./vocabulary";
import { legacyNavPlugin } from "./legacy-nav";
import { storagePlugin } from "./storage";
import { viewsPlugin } from "./views";

/**
 * 等激活的上限。
 *
 * 内核侧"等 `ACTIVE` 的超时"归 K2.3，尚未落地；没有它，一个依赖等不到的插件会让启动静默挂住。
 * 宿主自己兜一层，宁可启动时报错也不留白屏。
 */
const MOUNT_TIMEOUT_MS = 5_000;

/**
 * 宿主启动：创建内核根 context，挂上内置插件（pluginization.md 的 P1）。
 *
 * 返回时内置插件**已经激活**（`ctx.storage` / `ctx.views` 可用），所以调用方可以直接渲染。
 * `storage` 与 `views` 就是 §6 说的"宿主内置、不可卸载"：外壳和引擎不能靠插件启停来开关。
 * 第三方插件的装载走内核的装载层，与本函数无关。
 */
export async function bootHost(): Promise<Context> {
  const ctx = new Context();

  await mount(ctx, storagePlugin);
  await mount(ctx, viewsPlugin);
  await mount(ctx, legacyNavPlugin);

  return ctx;
}

/**
 * 挂一个内置插件并**等它真的激活**。
 *
 * `await ctx.plugin()` 等的是惯性、不是激活（cambia 的 K1.1 事实 10），所以判定只能自己观察：
 * 先订阅 `internal/status`、再重读一次 `fiber.state`，关掉"订阅之前已经迁移"的窗口。
 * 这条是内置插件的挂载路径；将来从磁盘装的插件走 `@cambia/host` 的装载层（P5）。
 */
async function mount(ctx: Context, plugin: Plugin): Promise<void> {
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
          `内置插件 "${plugin.name}" 在 ${MOUNT_TIMEOUT_MS}ms 内没有激活：` +
            `inject = [${waitingOn(plugin)}]。内核的激活超时归 K2.3，这里是宿主侧兜底`,
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
      throw new Error(`内置插件 "${plugin.name}" 激活失败：${describe(reason)}`);
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

function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}
