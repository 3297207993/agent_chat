import type { Context } from "@cambia/core";
import { navigate } from "../../navigation";
import type { ViewItemBase, ViewsService } from "../../vocabulary";

export const name = "views";

/**
 * `ctx.views`：外壳的注册点（pluginization.md §6）。
 *
 * 外壳（组件与路由）留在宿主代码里，插件只能"往里放东西"——注册项是纯数据加一个可选的图标组件，
 * 怎么渲染由外壳决定。内置插件与将来的第三方插件走同一套注册机制。
 */
export function apply(ctx: Context) {
  ctx.provide("views", createViewsService());
}

/**
 * 槽位注册表。
 *
 * 内部只认 `ViewItemBase`（槽位名到注册项类型的关联是编译期的，运行期只有字符串），所以在返回处
 * 做一次转换。快照是**缓存**的：`useSyncExternalStore` 要求"没变就返回同一个引用"，否则每次渲染
 * 都会认为状态变了。
 */
function createViewsService(): ViewsService {
  const buckets = new Map<string, Map<string, ViewItemBase>>();
  const snapshots = new Map<string, ViewItemBase[]>();
  const listeners = new Set<() => void>();

  const changed = () => {
    snapshots.clear();
    for (const listener of [...listeners]) listener();
  };

  const registry = {
    register(slot: string, item: ViewItemBase) {
      const bucket = buckets.get(slot) ?? new Map<string, ViewItemBase>();
      buckets.set(slot, bucket);
      bucket.set(item.id, item);
      changed();

      return () => {
        // 同 id 的新注册可能已经接管了这个位置，撤销旧注册不能把新的删掉
        if (bucket.get(item.id) !== item) return;
        bucket.delete(item.id);
        changed();
      };
    },

    list(slot: string): readonly ViewItemBase[] {
      const cached = snapshots.get(slot);
      if (cached) return cached;

      const items = [...(buckets.get(slot)?.values() ?? [])];
      // Array.prototype.sort 是稳定的，所以同 order 的项保持注册顺序
      items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      snapshots.set(slot, items);
      return items;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // 路由归外壳（§6）：这里只是把请求转给宿主登记的导航器
    navigate,
  };

  return registry as ViewsService;
}
