/** 插件宿主的对外入口：启动、React 绑定、以及词汇表类型。 */
export { bootHost, hostContext } from "./host";
export { PluginHostProvider, useGlobalSystemPrompt, useHost, useViewSlot } from "./react";
export type {
  AppService,
  CommandOutput,
  ContributionProps,
  FileSystemService,
  MainPage,
  PanelTab,
  PromptService,
  ScriptResult,
  SettingsSection,
  ShellCommandOptions,
  ShellScriptOptions,
  ShellService,
  StorageService,
  ToolApproval,
  ToolCall,
  ToolContribution,
  ToolExecutionOptions,
  ToolLike,
  ToolsService,
  TopbarAction,
  ViewItem,
  ViewSlot,
  ViewSlots,
  ViewsService,
} from "./vocabulary";
