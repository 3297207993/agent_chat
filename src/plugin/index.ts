/** 插件宿主的对外入口：启动、React 绑定、以及词汇表类型。 */
export { bootHost } from "./host";
export { PluginHostProvider, useHost, useViewSlot } from "./react";
export type {
  StorageService,
  TopbarAction,
  ViewItem,
  ViewSlot,
  ViewSlots,
  ViewsService,
} from "./vocabulary";
