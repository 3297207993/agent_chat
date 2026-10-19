import type { Context } from "@cambia/core";
import type {
  RendererComponent,
  RenderersService,
} from "@agent-chat/plugin-api";
import CodeRenderer from "./CodeRenderer";
import MarkdownRenderer from "./MarkdownRenderer";

export const name = "renderers";

/**
 * `ctx.renderers`：结构化渲染器注册表（pluginization.md §3 的第二层）。
 *
 * 宿主自己也在这里注册一个 `code` 渲染器——shiki 是宿主依赖，不能塞进 chat-view 的插件包；
 * 插件侧只负责按类型键位查询并渲染。其它键位（例如 `tool:<name>`）留给功能插件注册。
 */
export function apply(ctx: Context) {
  const renderers = createRenderersService();
  ctx.provide("renderers", renderers);

  // 宿主内置渲染器随宿主件激活；没有卸载路径（宿主件永不卸载）
  ctx.effect(() =>
    renderers.register("markdown", MarkdownRenderer),
  );
  ctx.effect(() => renderers.register("code", CodeRenderer));
}

function createRenderersService(): RenderersService {
  const renderers = new Map<string, RendererComponent>();
  const listeners = new Set<() => void>();

  return {
    register<T>(key: string, renderer: RendererComponent<T>) {
      renderers.set(key, renderer as RendererComponent);
      for (const listener of [...listeners]) listener();

      return () => {
        // 同键的新注册可能已经接管了这个位置，撤销旧注册不能把新的删掉
        if (renderers.get(key) !== (renderer as RendererComponent)) return;
        renderers.delete(key);
        for (const listener of [...listeners]) listener();
      };
    },

    get: (key) => renderers.get(key),

    list: () => [...renderers.keys()],

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
