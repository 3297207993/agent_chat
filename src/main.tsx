import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { bootHost, PluginHostProvider } from "./plugin";
import "./index.css";

// 先起内核，再渲染：注册点与引擎要在第一次渲染之前就位
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