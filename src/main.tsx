import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { bootHost, PluginHostProvider } from "./plugin";
import { provideSharedRuntime } from "./plugin/shared";
import "./index.css";

// 先注入共享依赖（插件包在模块初始化时就要它），再起内核（装载插件），最后渲染
provideSharedRuntime();

bootHost().then(
  (host) => {
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