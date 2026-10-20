# Tauri 窗口闪退 / WebView2 无法启动（Windows Low 完整性标签）

- 记录日期：2026-10-20
- 状态：已解决
- 影响环境：Windows 11（build 26200）+ Tauri 2.x + WebView2 Runtime 155.0.4283.62
- 关键词：WebView2、Tauri、闪退、白屏、`FailedToReceiveMessage`、`0x800700AA`、Low Mandatory Level、AppContainer SID、DSH 沙箱

## 1. 现象

- `pnpm tauri dev` 或直接运行 `src-tauri/target/debug/agent-chat.exe`：窗口出现约 0.2–2.5 秒后消失，**宿主进程仍然存活**。
- 没有 `msedgewebview2.exe` 子进程，`%LOCALAPPDATA%\zwq.agent\EBWebView` 也不更新。
- Tauri 侧 `app.webview_windows()` 返回 1 个 `main`，但 `is_visible()` / `outer_size()` 返回
  `Err(Runtime(FailedToReceiveMessage))`。
- 升级 Tauri 到 2.12.x 后，错误提前暴露为 WebView 创建失败：
  - 默认 identifier：`WebView2 error: WindowsError(HRESULT(0x800700AA))`（"资源正在使用"）
  - 换独立 identifier：`拒绝访问 (os error 5)`
- 扩展 `%LOCALAPPDATA%\CrashDumps` 中曾有 `msedgewebview2.exe.*.dmp`，栈顶为
  `crash_reporter::internal::PlatformCrashpadInitialization` → Crashpad 启动失败。

## 2. 快速判断（30 秒）

在**仓库根目录**执行：

```powershell
icacls .
```

如果输出里出现下面任意一项，基本可以确定是本问题：

```
Everyone:(CI)(DENY)(DC)
S-1-4-<数字>:...:(OI)(CI)(W,D,DC)
Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)
```

再确认可执行文件本身：

```powershell
icacls .\src-tauri\target\debug\agent-chat.exe
# 若显示 Mandatory Label\Low Mandatory Level，即为本问题
```

进一步可直接读取进程令牌的完整性 RID（4096=Low，8192=Medium）：

```powershell
# 启动 exe 后，用 Process Explorer 之类的工具查看 Integrity 为 Low 即可
```

> 关键判据：**exe 所在目录（或它自身）带 Low 完整性标签**。

## 3. 根因

仓库根目录被写入了 Windows 的**强制完整性控制（MIC）**标签和一组 DACL：

| 条目 | 含义 |
|---|---|
| `Everyone:(CI)(DENY)(DC)` | 拒绝 Everyone 删除子项 |
| `S-1-4-<hash>:(OI)(CI)(W,D,DC)` | 给某个工作区专属 SID 写/删权限 |
| `Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)` | 目录完整性降为 Low，并禁止低完整性进程向上写 |

Windows 创建进程时，会取「用户完整性」与「可执行文件完整性」中的**较低者**。标签会沿目录继承，
于是仓库内构建出的 `agent-chat.exe` 也带 Low 标签，运行时就是 **Low 完整性进程**。

WebView2 需要在 `%LOCALAPPDATA%`（Medium）下创建/更新 `EBWebView` 数据目录，同时启动 Crashpad，
而低完整性进程不能写 Medium 对象 —— 初始化因此失败，窗口随即消失。

### 这组 ACL 是谁写的

是 **DeepSeek Harness（DSH）的 Windows 沙箱**。它在工作区根做一次性的安全描述符写入，
把「授权 ACE + 拒绝 `FILE_DELETE_CHILD` + Low 标签」在同一个 `SetNamedSecurityInfoW` 调用里完成，
目的是让受限 token 只能写工作区、不能写用户其他文件。DSH 自己的文档说明了这一点：

> "Each grant therefore also denies `FILE_DELETE_CHILD` to the world SID … and labels the same
> directory **Low** in the one `SetNamedSecurityInfoW` call that applies all three edits."

并且：

> "The workspace-root ACE materializes once per workspace per server lifetime and **STANDS**"

也就是说：**DSH 只会写，不会撤销**；只有每个会话的临时目录授权会在退出时回收。

### 为什么其他 AI 编码工具没这个问题

多数工具只在应用层做审批（问你要不要执行），命令本身仍以用户正常的 Medium 权限运行，不会重写工作区 ACL。
DSH 在 Windows 上用了 OS 级隔离（restricted token + ACL），才会产生这个副作用。

## 4. 解决方案

在**不需要管理员权限**的情况下即可修复（当前用户是目录所有者）：

```powershell
$repo = 'C:\Users\32972\Desktop\develop\agent_chat'

# 1) 移除 DSH 的工作区 SID 授权（SID 是按路径派生的，所以固定值也可）
$acl = Get-Acl -LiteralPath $repo
$acl.Access | Where-Object { $_.IdentityReference.Value -like 'S-1-4-*' } |
  ForEach-Object { [void]$acl.RemoveAccessRuleSpecific($_) }

# 2) 移除 DSH 添加的“拒绝删除子项”
$acl.Access | Where-Object {
  $_.AccessControlType -eq 'Deny' -and
  $_.IdentityReference.Value -eq 'Everyone' -and
  ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles)
} | ForEach-Object { [void]$acl.RemoveAccessRuleSpecific($_) }

Set-Acl -LiteralPath $repo -AclObject $acl

# 3) 把完整性标签恢复为 Medium（(OI)(CI) 会传播到整棵子树）
icacls $repo /setintegritylevel "(OI)(CI)Medium"
```

如果只想用 `icacls` 并且知道确切的 SID，也可以：

```powershell
icacls $repo /remove:d "Everyone"
icacls $repo /remove:g "S-1-4-255987765-852188800"   # 本仓库对应的 SID，其他机器/路径会不同
icacls $repo /setintegritylevel "(OI)(CI)Medium"
```

> 注意：`icacls /remove:g` 对无法解析的 SID 可能提示 "Successfully processed 0 files"，
> 此时用上面的 `Get-Acl` / `Set-Acl` 方式更可靠。

## 5. 验证

```powershell
$repo = 'C:\Users\32972\Desktop\develop\agent_chat'

# 根目录应当只剩 SYSTEM / Administrators / 当前用户，标签为 Medium
icacls $repo

# 子目录与产物同样应为 Medium，且没有 S-1-4
icacls "$repo\.git"
icacls "$repo\src-tauri\target\debug\agent-chat.exe"
```

期望输出（示意）：

```
C:\...\agent_chat  NT AUTHORITY\SYSTEM:(I)(OI)(CI)(F)
                   BUILTIN\Administrators:(I)(OI)(CI)(F)
                   A\<user>:(I)(OI)(CI)(F)
                   Mandatory Label\Medium Mandatory Level:(OI)(CI)(NW)
```

功能验证：

1. 直接运行 `src-tauri\target\debug\agent-chat.exe`；
2. 应出现 `agent-chat` 主窗口，且能看到 `msedgewebview2.exe` 子进程；
3. `%LOCALAPPDATA%\zwq.agent\EBWebView` 下 `Default`、`Breadcrumbs`、`CrashpadMetrics-*.pma` 等文件时间戳刷新。

## 6. 复发条件

| 操作 | 是否重新写入 ACL |
|---|---|
| DSH 以「工作区内修改 / workspace-write」执行命令 | **会**（首次即写入，之后精确匹配则跳过） |
| DSH 以「仅可查看 / read-only」执行 | 一般不触发写授权 |
| DSH 以「完全权限 / danger-full-access」执行 | **不会**（provider 完全不参与） |
| 手动清理后再用 workspace-write | 会重新写入 |

因此清理是**临时**的：只要再让 DSH 以受限模式在这个仓库跑命令，标签就会回来。

## 7. 预防

按推荐程度排序：

1. **让 DSH 对该仓库使用「完全权限」**（设置里的默认权限模式也一并改掉，避免新会话先以 workspace-write 启动）。
2. **把构建产物放到仓库外**，产物就不会继承标签：

   ```powershell
   $env:CARGO_TARGET_DIR = "$env:LOCALAPPDATA\agent-chat-target"
   pnpm tauri dev
   ```

3. 将仓库移出 DSH 管理的工作区，或把 DSH 工作区指向其他目录。
4. 复发时重跑第 4 节的脚本。

> 不建议为了修复而放宽整个磁盘/用户目录的 ACL；Low 标签可能是有意的隔离边界。

## 8. 排查过程中已经排除的假设

以下都实测过，均**不是**原因：

- 前端代码问题：`pnpm run dev` 浏览器渲染正常，`tsc --noEmit`、`check:plugins` 通过；换成纯静态空白页同样闪退
- 插件问题：最小 `tauri::Builder::default()` 也复现；移除 `window-state` / `opener` 无效
- WebView2 运行时损坏：Store / SearchHost 等系统自带 WebView2 正常
- Crashpad / Profile 损坏：移走 `EBWebView\Crashpad`、换全新数据目录仍闪退
- 环境变量：移除 `CHROME_CRASHPAD_PIPE_NAME` 无效
- Chromium 参数：`--disable-crash-reporter`、`--disable-breakpad`、`--no-sandbox`、`--disable-gpu`、
  `additionalBrowserArgs` 均无效
- 安全软件/策略：Defender ASR、Exploit Protection、IFEO、AppCompat 均无相关配置
- 版本兼容：升级 Tauri 2.12.x / wry 0.57 / webview2-com 0.39 只是让错误码更明确，并未解决
- 控制台子系统、Task Scheduler / WMI 启动方式：无效

## 9. 附：有效的最小化验证方法

1. **最小 Tauri 探针**：新增一个只做 `Builder::default().run(generate_context!())` 的 bin，
   确认与业务代码无关（本项目实测同样复现）。
2. **.NET 宿主对照**：用 `Microsoft.Web.WebView2` 写一个最小 WinForms 宿主，
   逐项加 `AdditionalBrowserArguments`（DPI、autoplay、disable-features），全部正常，
   说明这些参数不是诱因。
3. **完整性级别对照**：同一份 exe
   - 从仓库 `target\debug` 启动 → 进程 Integrity = Low → WebView2 失败
   - 复制到 `%LOCALAPPDATA%\<任意目录>` 启动 → Integrity = Medium → 窗口与 WebView2 正常
   这一步直接锁定了根因。

   读取进程完整性 RID 可参考：`OpenProcess` → `OpenProcessToken` →
   `GetTokenInformation(TokenIntegrityLevel)`，RID 4096=Low、8192=Medium、12288=High。
