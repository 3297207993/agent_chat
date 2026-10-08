/**
 * 宿主的导航能力。
 *
 * 插件包是独立 bundle，用不了宿主那份 `react-router`（第二份 router = 另一个 context 对象，
 * `useNavigate` 会直接抛"不在 Router 里"）。所以路由留在外壳，插件走这个薄接缝。
 *
 * 实现方式是"外壳挂载时把 navigate 交出来"：`App.tsx` 在 `<BrowserRouter>` 里调用
 * `setNavigator(useNavigate())`，插件侧只看到 `ctx.views.navigate(path)`。
 */
let navigator: ((path: string) => void) | null = null;

/** 外壳挂载时登记。 */
export function setNavigator(fn: (path: string) => void): void {
  navigator = fn;
}

/** 跳转到一个宿主路由。 */
export function navigate(path: string): void {
  if (!navigator) {
    throw new Error("外壳尚未挂载导航器：navigate 只能在应用渲染之后调用");
  }
  navigator(path);
}
