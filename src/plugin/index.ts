/** 插件宿主的对外入口：启动、React 绑定、以及词汇表类型。 */
export { bootHost, hostContext } from "./host";
export { PluginHostProvider, useGlobalSystemPrompt, useHost, useViewSlot } from "./react";
export type {
  ContributionProps,
  MainPage,
  PanelTab,
  PromptService,
  SettingsSection,
  StorageService,
  TopbarAction,
  ViewItem,
  ViewSlot,
  ViewSlots,
  ViewsService,
} from "./vocabulary";
