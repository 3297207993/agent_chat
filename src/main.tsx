import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { bootHost, PluginHostProvider } from "./plugin";
import { installConversationsBridge } from "./plugin/bridges/conversations";
import { installLlmBridge } from "./plugin/bridges/llm";
import { installSkillCatalogBridge } from "./plugin/bridges/skills";
import { installToolBridges } from "./plugin/bridges/tools";
import { provideSharedRuntime } from "./plugin/shared";
import "./index.css";

// 先注入共享依赖（插件包在模块初始化时就要它），再起内核（装载插件），最后渲染
provideSharedRuntime();

bootHost((ctx) => {
  // P3 的临时宿主服务：agent-loop / chat-view 的 inject 依赖它们，必须在插件挂载前就位。
  // P4 把 llm / skills / 对话域收编成插件后，这里逐块删除。
  installLlmBridge(ctx);
  installConversationsBridge(ctx);
  installSkillCatalogBridge(ctx);
}).then(
  (host) => {
    // 临时 bridges：skill / MCP 工具注册与旧审批逻辑，P2c / P4 逐块删除
    installToolBridges(host);

    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <PluginHostProvider ctx={host}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </PluginHostProvider>
      </React.StrictMode>,
    );
  },
  (error: unknown) => {
    // 启动失败要看得见，不能留一个白屏
    console.error("[plugin-host] 启动失败", error);
    const root = document.getElementById("root");
    if (root) {
      root.textContent = `插件宿主启动失败：${error instanceof Error ? error.message : String(error)}`;
    }
  },
);