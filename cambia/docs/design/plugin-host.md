# `crates/plugin-host` 设计

> 状态：**草稿**（未开工；K2.5 / K2.6 动手前需评审）
> 对应批次：K2.5（`.tap` 打包 / 校验 / 下载 / 原子安装）、K2.6（后端子进程托管、控制面协议）。K2.4 只用它的最小接线，不实现本模块。
> 只写这一个模块。语义以 [../kernel.md](../kernel.md) 3.3 / 4 为准，选型以 [../implementation.md](../implementation.md) 3.3 为准，本文不重新定义它们。
> **包名定案（2026-10-08）**：`cambia-plugin-host`，目录仍是 `crates/plugin-host`（[../kernel.md](../kernel.md) 5.1 只定目录形态，没定包名；crates.io 上需要一个可注册的名字）。
> 姊妹文档：TS 侧的端口清单在 [host.md](./host.md)（"与宿主运行时的接缝"）；Tauri 接线在 `tauri-plugin-cambia.md`（**尚未建**，动手前补）。

## 边界

**负责**（"必须比 WebView 活得久"或"要用 OS 权限"的那一半）：

- **`.tap` 与安装**：打包与解包（**唯一实现**，可复现的打包规范）、sha256 校验、下载到 staging、原子替换、journal 恢复、卸载
- **安装目录的权威**：布局、`<id>/<version>-<hash>` 命名、**"装了哪些"这一事实的唯一来源**
- **文件读取**：端口 `readText` 的实现（本模块不解析 manifest 语义，只交字节）
- **后端子进程托管**：spawn、启动超时、重启退避、优雅关闭、**宿主退出时的全量回收**
- **控制面传输**：stdio 管道、帧、请求关联、超时/取消（**分层已定案 2026-10-08，见下方专节**）
- **平台键映射**：spec 的 `win|mac|linux` + `x64|arm64` → `std::env::consts::{OS, ARCH}` 的显式映射表

**不负责**：

| 不负责的东西 | 归谁 |
|---|---|
| manifest 的**语义**校验（`engines` 判定、激活匹配、错误码映射） | TS 侧 `@cambia/host`（[host.md](./host.md)，K2.1 已落地）。本模块只做 schema 级安装期校验，读 `spec/v1/manifest.schema.json` |
| 插件前端模块的装载（`import()`、判定、卸载） | TS 侧 `@cambia/host`（K2.2 已落地） |
| **编排策略**：何时装、何时起后端、失败怎么办 | TS 侧中枢（详见 [host.md](./host.md)"端口清单"的分工规则） |
| 展示协议、服务键的**领域语义** | 宿主应用（[../kernel.md](../kernel.md) 1.9） |
| Tauri 符号（协议注册、命令集合、权限文件） | 适配层 `crates/tauri-plugin-cambia`（独立 workspace / CI 轨道） |

**硬约束**：crate **不出现任何 Tauri 符号**——内核实现层不依赖 Tauri（CONTRIBUTING 硬规定 3）。所以它能被纯 `cargo test` 完整覆盖，也能被任何 Rust 宿主复用。

## 接口

### 与 TS 端口的对应关系

TS 声明端口，**实现在本 crate**，中间由适配层转成 Tauri 命令：

```
TS（@cambia/host）        端口           适配层（tauri-plugin-cambia）      本 crate
loadPluginModule(url) ← moduleURL(rel) ← command          ← 路径与 scheme（asset: 由适配层做）
parseManifest(text)   ← readText(rel)  ← command          ← 文件读取
判定 → 编排            ← listInstalled() ← command          ← 安装目录 + journal
                        ← spawn/kill                            ← 进程监督器
                        ← call/onCall                           ← 控制面（分层已定案）
```

| 端口 | Rust 侧对应 | 批次 |
|---|---|---|
| `readText(relPath)` | 读安装根目录下的文件，返回文本 | 待分配（建议 K2.5） |
| `listInstalled()` | 扫安装目录 + 读 journal，返回 `[{id, version, hash, dir, enabled}]` | 待分配（建议 K2.5） |
| `spawn(spec)` / `kill(id)` | 进程监督器 | K2.6 |
| `call` / `onCall` | 控制面传输 | K2.6（**分层已定案**，见专节） |

**进程句柄不进 TS**：`spawn` 返回的是**标识**（插件 id + 世代号），不是句柄；`kill(id)` 是**请求**。理由不是风格——见 [host.md](./host.md)"进程端口"一节：退出回收必须由 OS 级机制保证（Job Object / 进程组），"JS 调用 kill"这条路径在 WebView 崩了、窗口被关、应用被强杀时根本不会执行。`tauri-plugin-shell` 被否掉正是同一个坑（implementation.md 事实 9）。

### 进程与控制面（K2.6 交付）

形状如下；**签名在实现时可以调，语义不可调**（语义以本节与 [../../spec/v1/protocol.md](../../spec/v1/protocol.md) 为准）。

```rust
/// 一次运行实例的标识：插件 id + 世代号。TS 拿到的就是它，不是句柄。
pub struct BackendId { plugin: String, generation: u64 }

pub struct SpawnSpec {
  plugin: String,
  /// manifest 的 `backend.bin` 里平台键命中的那条：字符串 = 相对安装目录的可执行文件；数组 = argv
  target: BinTarget,
  /// 安装目录；`target` 里的相对路径以它为根解析（越界拒绝，规则与 K2.4 的路径净化同源）
  root: PathBuf,
  protocol: ProtocolName,   // v1 只有 "jsonrpc-stdio"；不认识就拒绝，不猜
}

/// **值由 TS 给**（策略在编排层），执行在本 crate。
pub struct StartPolicy { start_timeout: Duration, restart: RestartPolicy }
pub struct RestartPolicy { max_attempts: u32, base_delay: Duration, max_delay: Duration, jitter: bool }

pub enum BackendStatus { Spawning, Handshaking, Ready, Stopping, Exited(ExitReason) }
pub struct ExitReason { code: Option<i32>, signal: Option<i32>, expected: bool, generation: u64 }

impl Supervisor {
  /// 立刻返回标识；**不 await 就绪**（与前端 `load` 的纪律相反，因为这里要的是"进程已接管"）
  fn spawn(&self, spec: SpawnSpec, policy: StartPolicy) -> BackendId;
  /// 后台推进：exec → `$/initialize` → Ready，或按 `RestartPolicy` 退避重试
  fn status(&self, id: &BackendId) -> BackendStatus;
  fn stop(&self, id: &BackendId, timeout: Duration) -> StopOutcome;
  /// 宿主退出时全量回收（适配层的钩子调它）
  fn reclaim_all(&self);
  /// 退出 / 世代变化 / 退避用尽，交给 TS 决定"要不要再起"
  fn subscribe(&self, sink: ExitSink);
}

impl Transport {
  /// 关联 + 超时 + 取消都在这里（专节定案）；`timeout` 必填
  fn call(&self, id: &BackendId, method: &str, params: Value, timeout: Duration) -> CallFuture;
  /// 后端反向调用 → 交给 TS 路由（服务契约是宿主的词汇表）
  fn set_inbound(&self, dispatch: InboundDispatch);
}
```

适配层把它转成命令（`spawn` / `kill` / `call` / `respond`），命令集合见 [tauri-plugin-cambia.md](./tauri-plugin-cambia.md)。

**`spawn` 命令等到真结论才返回**：crate 内部在"Ready 或失败"之后才让命令返回（失败带 `PROCESS_SPAWN_FAILED` / `PROCESS_START_TIMEOUT` / `PROCESS_PLATFORM_UNSUPPORTED`）。这样 TS 的 `startBackend` 天然 await 到一个可信状态，不需要自己轮询 `status`——与 K2.2 的"判定只在 `ACTIVE` / `FAILED` 上返回"是同一条纪律。

## 数据流与状态

**安装（K2.5）**：

```
.tap → 下载到 staging → sha256 校验 → 解包到 staging/<id>/<version>-<hash>
    → 写 journal（意图） → 同卷 rename 进 plugins/ → journal 提交
```

**状态权威（必须唯一）**：

| 想知道 | 权威在哪 | 谁只是视图 |
|---|---|---|
| 装了哪些、哪些被禁用 | **本 crate**：安装目录 + journal | TS 侧（`listInstalled` 的返回值） |
| 某个插件前端激活了没有 | TS 侧运行期：`Fiber.state`（[host.md](./host.md)） | — |
| 某个插件后端在不在 | **本 crate**：进程表 | TS 侧（`BackendHandle.status`） |

两份状态各说一套是必须避免的（[host.md](./host.md) 的"三处状态各有唯一来源"是同一条纪律）。所以 TS 侧**不缓存**"装了哪些"——它每次问 `listInstalled`，或接受它是缓存但明确写"以 crate 为准"。

**进程（K2.6）：状态机、世代号、退出码、退避**

进程表在本 crate，条目含 `plugin`、`generation`、pid、job object / 进程组句柄、stdout/stderr 位置、`$/initialize` 状态与在途请求表。状态机只有五个状态：

```
                     spawn()
   (absent) ───────────────────► Spawning ──exec 成功──► Handshaking ──$/initialize 应答──► Ready
                                   │                        │                                │
                                   │ exec 失败               │ 超时／版本不接受／提前退出        │ $/shutdown
                                   ▼                        ▼                                ▼
                              Exited(SPAWN_FAILED)     Exited(START_TIMEOUT / VERSION)     Stopping ──退出──► Exited(expected)
                                                                                            │
   Ready 期间进程自己退出（崩溃）─────────────────────────────────────────────────────────► Exited(crashed)
                                                                                            
   Exited ──(TS 策略允许重启 && 未超上限)──► 退避等待 ──► Spawning（generation + 1）
   Exited ──(上限用尽)──► 上报 PROCESS_RESTART_EXHAUSTED，**不自己禁用**（禁用是 TS 的策略）
```

- **启动超时是"一个总时限"**（exec + 握手），因为对使用者而言只有一个问题——"它起来没有"；失败原因用两个码区分：`PROCESS_SPAWN_FAILED`（exec 就没起来）与 `PROCESS_START_TIMEOUT`（起来了但握手没完成）。
- **世代号**每次 spawn 单调 +1，进程表按 `(plugin, generation)` 键控。**迟到的退出事件按世代号丢弃**——否则上一世代的退出会被算成这一世代的崩溃，进而多重启一次。stderr 也按世代分文件：`<plugin>/<generation>.log`。
- **退出码语义**（决定要不要进退避，因此必须写死）：

| 退出情况 | 判定 |
|---|---|
| `code = 0` 且是 `Stopping` 期间（我们要求的） | 预期退出，**不进退避** |
| `code = 0` 但不是我们要求的（后端自己退出） | 异常终止，进退避 |
| `code != 0` | 崩溃，进退避，留 `code` |
| 被信号杀死（`signal` 非空） | 崩溃，留 `signal` |

- **退避的参数由 TS 给、执行在本 crate**：TS 决定策略（`maxAttempts` / `baseDelay` / `maxDelay` / `jitter`，以及"上限用尽后要不要永久禁用"），crate 决定时机——它同时看得到 exec 失败与退出码，重试不必回一趟 JS。**不做"TS 驱动的重试"**：那会把重试状态拆到两处（crate 知道进程没了、TS 记着第几次），而每次重试都要跨一次 WebView IPC。
- **优雅关闭**：`$/shutdown` → 等 `shutdownTimeout` → 关 stdin → 等进程退出 → 收拾整棵进程树（job object / 进程组）→ 确认回收。退出时**缩短预算**：应用正在退出，不能因为一个不回消息的后端把关闭流程挂住。
- **全量回收走双保险**：`RunEvent::ExitRequested` / `Exit` 钩子 **+** `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`（Windows）/ 进程组（Unix）——**不能只靠钩子**，钩子本身可能跑不到（implementation.md 3.3(e)）。这正是"句柄不进 TS"的理由：WebView 崩了、窗口被关、应用被强杀时，只有 OS 级机制能收拾后端自己起的孙进程。
- **`reclaim_all()` 的顺序**：先停止接受新的 spawn → 对每个 `Ready` / `Handshaking` 尝试优雅关闭（短预算）→ 收拾进程树 → 清空进程表。已在 `Exited` 的条目只清表。
- **stderr**：按 `<plugin>/<generation>.log` 落盘并按体量轮转（阈值随实现定）；stdout **永不落日志**（它是协议通道，见 [../../spec/v1/protocol.md](../../spec/v1/protocol.md) §1）。

**"没有 WebView 时后端还能不能活着"——v1 的答案**：**不能，而且这是选择而不是遗漏**。spawn 由 TS 中枢发起，所以"应用启动即起后端""托盘常驻、没有窗口也跑插件"在 v1 不成立；**回收不需要 WebView**（上面那条双保险）。支撑这个选择的理由：插件后端的生命周期由宿主策略决定，而策略在 TS；让 crate 自己决定"该起谁"等于把编排语义搬进内核实现层。后置选项是"在本 crate 留一个 `Ready` 时的最小触发点，只负责拉起、不接管语义"——真要常驻再定，别顺手做。

## 失败路径

| 失败 | 表现 | 本模块的行为 | 对应码 |
|---|---|---|---|
| 下载失败 / 中断 | 网络错误 | 留在 staging，不碰已装版本 | `INSTALL_*`（随 K2.5 的命令集合补） |
| sha256 不符 | 校验失败 | 丢弃 staging，原子安装不开始 | 同上 |
| 解包失败（不是 `.tap` / 结构不符） | 解包抛错 | 丢弃 staging | 同上 |
| 打包格式的版本不认识 | 规范版本高于本宿主 | 明确拒绝，不"尽力而为" | 同上 |
| 并发安装 / 更新 / 卸载同一插件 | 两个进程同时动 | 幂等；journal 保证只有一个赢 | 同上 |
| 中途崩溃（进程被杀） | journal 停在"意图"阶段 | 下次启动按 journal 恢复（回滚或补完） | 同上 |
| **Windows 文件占用**：更新时旧版本仍被进程占用 | rename 失败 | **先停该插件的后端再替换**（所以 crate 要知道"这个后端属于哪个插件"）；仍失败则推迟到下次启动 | 同上 |
| 平台键无命中 | `bin` 里没有本平台的键 | **只禁用该插件的后端**，不降级到别的形态、不猜路径（kernel.md 3.3） | `PROCESS_PLATFORM_UNSUPPORTED` |
| spawn 失败 / 启动超时 | exec 失败，或起来了但 `$/initialize` 没在时限内完成 | 记失败，按 `RestartPolicy` 退避重试到上限；上限用尽只**上报**，是否禁用由 TS 决定 | `PROCESS_SPAWN_FAILED` / `PROCESS_START_TIMEOUT` / `PROCESS_RESTART_EXHAUSTED` |
| 后端崩溃 | 进程退出（非预期） | **只影响它自己**：回收 + 按策略重启，**不许连带停掉前端**；退出码与 stderr 留存 | `PROCESS_EXITED` |
| 后端起孙进程 | 只杀直接子进程会留孤儿 | Job Object / 进程组收拾整棵树——这是 K2.6 的验收项 | —（进程层，无码） |
| 协议帧损坏 / 无响应 | 解析失败或超时 | 单次调用失败，**不等于进程死亡**；解析失败则断开并让监督器回收 | `PROTOCOL_CALL_TIMEOUT` / `PROTOCOL_PARSE_ERROR` 等（见 [../../spec/v1/protocol.md](../../spec/v1/protocol.md) §6） |

## 验收方式

| 手段 | 覆盖 | 对应验收 |
|---|---|---|
| `cargo test`（纯 Rust，无 Tauri） | `.tap` 往返、sha256、journal 恢复、平台键映射表、进程监督器的状态机 | K2.5 / K2.6 |
| **两侧一致性** | JS 打的包能被 Rust 解开、Rust 打的包能被 JS 校验（同一批 fixtures 判定一致） | K2.5（[../plan.md](../plan.md) 4 节） |
| 注入故障 | 并发安装 / 更新 / 卸载幂等；journal 恢复 | K2.5 |
| Windows 断言 | 宿主退出后**没有孤儿进程**，含"后端再起孙进程"的用例 | K2.6 |
| Windows 文件占用用例 | 先停后端再替换；失败则推迟 | K2.5 |
| 双向协议用例 | 宿主→后端 与 后端→宿主 两个方向，Node 与 Python 两个 SDK 结论一致 | K2.6 |

#### 两个最小 SDK 与"结论一致"怎么落地

验收里有一条"两种语言的 SDK 跑同一组双向协议用例，结论一致"（[../plan.md](../plan.md) K2.6）。要让它不是空话，做法必须定死：

- **SDK 是"最小的后端"**，放 `examples/backend-sdk-node/`（`backend.mjs`，零依赖）与 `examples/backend-sdk-python/`（`backend.py`，只用标准库）。每个都要会五件事（[../../spec/v1/protocol.md](../../spec/v1/protocol.md) §11）：一行一帧、应答 `$/initialize` / `$/shutdown` 并回写原 id、自己分配出站 id 并维护在途表、丢弃未知 id 的应答、退出前让在途请求失败。除这些之外只有三个**服务不了领域用途的测试方法**：`test/echo`（回声）、`test/call-host`（反向调用宿主）、`test/hang`（**故意不回答**——一致性用例要证明"调用超时不等于进程死亡"，就需要一个肯保持沉默的后端）。
- **用例只有一份**：`crates/plugin-host/tests/protocol.rs` 里**同一段断言**，参数化成"× 两个命令"跑两次（`node examples/backend-sdk-node/backend.mjs`、`python3 examples/backend-sdk-python/backend.py`）。"结论一致"因此是**机械成立**的——同一段断言跑两个进程，不是人工比对两份报告。
- **解释器缺失时用例失败并说明要装什么**，不静默跳过：静默跳过会让这条验收变成空话（本地确实没有 python 的人用 `cargo test -- --skip protocol` 显式跳过——跳过是人的决定，不是测试的默认）。
- 用例集至少覆盖：握手成功 / 版本不接受、宿主→后端调用、后端→宿主反向调用、通知、超时（含"超时不等于进程死亡"）、`$/cancel` 后被取消方的失败形态、未知 id 的应答被丢弃、进程退出让在途请求以 `PROCESS_EXITED` 失败、单帧超限被拒。

### 落地结论（2026-10-08，K2.6 的 crate 半边）

实现落在 `src/{error_codes,protocol,transport,process}.rs`，测试在 `tests/{spec,protocol,supervisor}.rs`，两个最小 SDK 在 `examples/backend-sdk-{node,python}/`。

- **已落地**：码表镜像与两侧漂移检查（`tests/spec.rs`）、协议层（帧、消息、方向与 id 规则）、传输层（读循环、出站 id 表、超时 + 取消、在途上限、入站分派、EOF/对端 cancel 的行为）、进程监督器（spawn + **握手即就绪** + 世代号 + 退出码语义 + 退避 + 优雅关闭 + `reclaim_all` + stderr 分文件）、两个 SDK 与"同一段断言 × 两个语言"的一致性用例。
- **未落地**（同批的另一半）：TS 侧 `@cambia/host` 的 `startBackend` / `loadPlugin` / 代理 Service，适配层的 `spawn` / `kill` / `call` / `respond` 命令与退出回收钩子。**"宿主退出后没有孤儿进程"这条验收里，OS 级那一半（Job Object 随宿主进程结束回收整棵树）要等真宿主退出才验得了，归 K2.7 的端到端。** 这里验到的是：失败/停止/回收路径都真的把进程收掉了（用 pid 存活性断言，不是靠回调）。

实测（来自真进程、真 SDK 或上游源码，不是推测）：

- **`process-wrap` 的 `ChildWrapper` 方法返回装箱 future，不能直接 `.await`**：`Box<dyn Future>` 自身没有 `Future` 实现（那个 impl 要求 `Unpin`），`kill_tree()` 里用 `Box::into_pin` 才是能 await 的形状。
- **Job Object 的"致命性"挂在 `KillOnDrop` 上**：上游 `make_job_object(handle, kill_on_drop)` 读的是包装链里有没有 `KillOnDrop`。所以"宿主死了整棵树也被内核回收"要求链里**同时**有 `JobObject` 与 `KillOnDrop`，少一个就只剩"退出钩子"这半边。
- **握手超时必须翻译成 `PROCESS_START_TIMEOUT`**：传输层只会说"这次调用超时"（`PROTOCOL_CALL_TIMEOUT`），而调用方问的是"它起来没有"。两个码对应两个判定，换码在 `spawn_once` 的边界上做（测试先红）。
- **重启计数不能在成功重启后清零**：清零会让"起来就崩"的插件永远重启下去，"退避到上限"永远不可达——测试因此挂到 60 秒才被发现。计数是**每个 episode** 的，episode 从宿主显式 `start` 开始。
- **退避抖动必须可关**：`jitter: true` 时延迟随机，时序断言就变成抛硬币；测试关掉它，生产默认开。
- **Node SDK 的串行队列会把反向调用锁死**：应答必须**绕过**请求队列——正在等宿主答复的处理函数会排在"它等的那条应答"前面。这是"两个 SDK 同一组断言"第一次跑就抓到的真 bug。
- **Windows 上 Python 的 `select` 不接受文件对象**（只接受 socket），所以同步 SDK 的"等待 + 超时"改用读取线程 + 队列。
- **`python3` 在 Windows 可能是 Store 桩**：它"存在"、能启动、什么都不打印就退出——所以解释器探测必须真的跑一段代码并检查输出，而不是看 `--version` 起不起得来。

## 未决项

| 未决项 | 现在怎么办 |
|---|---|
| ~~控制面薄层放哪一侧~~（本 crate vs TS）——**已定案 2026-10-08** | 帧 / id 关联 / 超时 / 取消在本 crate，服务契约与路由在 TS。逐跳依据见下方专节 |
| **无窗口时中枢还能不能在** | **已定 2026-10-08（v1）**：不能——spawn 由 TS 中枢发起，所以"应用启动即起后端""托盘常驻"在 v1 不成立；**回收不需要 WebView**（job object / 进程组双保险，见"进程"一节）。后置选项是在本 crate 留一个 `Ready` 时的最小触发点（只拉起、不接管语义），要常驻时再定 |
| 后端崩溃后重启的具体参数（退避曲线、次数上限、是否永久禁用） | **已定 2026-10-08**：**值由 TS 给**（`RestartPolicy`）、**执行在本 crate**（它看得到 exec 失败与退出码，重试不必回 JS）；"上限用尽后是否永久禁用"归 TS，crate 只上报 `PROCESS_RESTART_EXHAUSTED`。曲线形状（base × 2ⁿ、cap、jitter）用测试固定 |
| 签名（minisign） | 后置；K2.5 只做 sha256（implementation.md 3.3(b)） |
| stderr 日志的轮转策略与体量上限 | 本 crate 负责分文件（`<plugin>/<generation>.log`）与轮转（implementation.md 3.3(e)）；具体阈值随实现定 |
| `.tap` 打包规范的版本号与兼容窗口 | 随 K2.5 定；"规范版本高于宿主即拒绝"这条行为要先写测试 |

### 专节：控制面薄层放哪一侧（**已定案 2026-10-08**）

**定案**：**帧、请求 id 关联、超时、取消留在本 crate；服务契约、方法名 ↔ 服务键的路由留在 TS。** v1 **一律经 TS 中转**——包括落点是另一个后端的入站请求；"TS 把路由表下发给本 crate、由 Rust 直接转发"列为 K2.6 的**待量化优化项**，不在 v1。

#### 先把反向路径逐跳画一遍（定这条的前置）

后端 → 宿主/前端：后端请求宿主暴露的服务方法。

```
后端 SDK：call('sessions.append', params)          # id 由后端分配（它是发起方）
  ① 写 stdout（JSONL 帧）→ OS 管道
  ② 本 crate 读循环：解析帧 → 判定方向（有 method = 入站请求）→ 记下 id
  ③ 转交 → Tauri event → WebView 消息队列         ← 排队点 A
  ④ JS 事件循环（主线程）                          ← 排队点 B
  ⑤ TS：方法名 → 服务键 → 调用（可能进入前端插件代码）← 排队点 C
  ⑥ Tauri command（respond：id + payload）→ WebView 队列 ← 排队点 A'
  ⑦ 本 crate：按 id 找到挂起项 → 写 stdin 帧
  ⑧ 后端 SDK 收到响应
```

**判据不是"哪边跳数少"，而是排队点。** 排队点 B / C 就是"没有 Worker 隔离"的代价——前端插件死循环会卡住整个 JS 主线程，**而这个排队点在两种方案里都存在**：终点本来就在 JS 的服务键上，架构上消不掉。所以规则只能是：

> **凡是必须在"JS 主线程卡死"时仍然准时的机制，都不能放在 JS 里。**

据此逐项分：

| 机制 | 放哪 | 理由 |
|---|---|---|
| 帧的读写、JSONL 语法 | 本 crate | 与 JS 无关；Rust 侧阻塞读天然处理背压（排队点 A 不会积压到内存里） |
| **请求 id 表** | 本 crate（**两个方向各一套**） | 出站 id 由 `call()` 分配；入站 id 由**后端**分配，本 crate 只原样保留、按它回写，**不重编号**。这就是"谁维护 id 表"的答案 |
| **超时定时器** | 本 crate | 排队点 B 卡死时 JS 的定时器根本不跑——超时会从"准时失败"退化成"永远挂着"，而挂着的是后端 |
| 取消 | 本 crate | 同超时：它必须能在 JS 卡死时仍然发起 |
| 方法名 ↔ 服务键的路由 | TS | 服务键是**宿主领域词汇**（kernel.md 1.9）；本 crate 不认识它，也不该认识（kernel.md 5.1 的单向纪律）。本 crate 只搬 `{ id, method, params }` |
| 服务契约：方法集、参数、代理 Service 的注册 | TS | 同上 |

对外形状因此是：本 crate 暴露 **已经关联好、已经带超时**的 `call(method, params) → result`，TS 只回答"哪个方法名对应哪个服务键"。每帧仍然只跨一次 IPC。

#### 两条由此固定、K2.6 不许另做主张的行为

1. **超时定时器在"转交给 TS"之前就启动**，不是等 TS 确认收到。否则"TS 收到了却永远不回"（前端插件卡住）没有任何兜底——对后端而言那是最坏形态：永远等下去，且宿主自己也不知道。
2. **超时只判"这一次调用失败"，不判"进程死亡"**（本文件失败路径表已写）：超时要回一个带错误码的响应给后端，进程与前端都不受影响。

#### 这个选择**没有**解决什么（免得被读成"顺手解决了"）

**"没有 WebView 时后端还能不能活着"**仍是未决项（见上表最后一行）。它只是把问题收窄成一个具体形状：**只有"落点是 TS 服务键"的入站请求需要 WebView**；纯 Rust 的部分（帧、超时、进程回收）不依赖窗口。要不要让"后端 → 宿主原生能力"与"后端 ↔ 后端"绕过 WebView，属于 K2.6 的接口形状问题——定它之前先量化，别顺手做。
