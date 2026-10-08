# Cambia 控制面协议 v1 —— stdio JSON-RPC

> 这是 [spec/](../README.md) 的一部分：**JS 侧与 Rust 侧必须做出相同判定**的内容，因此不需要"各自解释"。
> 它只定义**通道**：帧、消息形状、id 归属、生命周期方法、超时与取消、错误码、边界。
> 语义以 [../../docs/kernel.md](../../docs/kernel.md) 3.3 为准（双向调用、传输边界、生命周期），实现方案见 [../../docs/implementation.md](../../docs/implementation.md) 3.3(f)，怎么落地见 [../../docs/design/plugin-host.md](../../docs/design/plugin-host.md) 与 [../../docs/design/host.md](../../docs/design/host.md)。
>
> **状态**：v1 初稿（随 K2.6 落地；冻结条件归 K3.1）。**协议名**是 manifest 里的 `parts.backend.protocol: "jsonrpc-stdio"`，v1 只定义这一个名字。

## 0. 一句话

宿主与插件后端之间是**两条单向字节流**：宿主写后端 stdin，读后端 stdout，一行一个 JSON 对象。
谁都能发请求，所以**两个方向各有一套请求 id**；除了少数以 `$/` 开头的控制方法，**方法名归宿主定义**（kernel.md 1.9）——Cambia 不注入领域词汇。

## 1. 帧

| 项 | v1 规定 |
|---|---|
| 编码 | UTF-8 |
| 分帧 | **JSONL**：一行恰好一个 JSON 对象，以 `\n` 结束。对象内部不得出现未转义的换行（即 JSON 字符串里的换行必须是 `\n`） |
| 空行 | 忽略（不产生消息、不报错） |
| 行尾 | 允许 `\r\n`（读侧把行尾的 `\r` 剥掉再解析） |
| 上限 | 单行 ≤ `MAX_FRAME_BYTES`（**1048576**）= 1 MiB。超限：接收方必须判协议错误并**断开**（见 §6），发送方在发出前就必须拒绝 |
| 批量 | **不支持** JSON-RPC 的数组批量：一行一个消息，一条一条来 |
| stderr | **只作日志**，永不解析。日志不得写 stdout（那是协议通道） |

## 2. 消息

三种，形状即 JSON-RPC 2.0（不做扩展字段）：

```jsonc
// request —— 有 method 且有 id
{ "jsonrpc": "2.0", "id": 7, "method": "tools/execute", "params": { } }

// response —— 有 id 且（有 result 或 有 error），没有 method
{ "jsonrpc": "2.0", "id": 7, "result": { } }
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32001, "message": "…", "data": { "code": "PROTOCOL_CALL_TIMEOUT" } } }

// notification —— 有 method 且没有 id
{ "jsonrpc": "2.0", "method": "$/cancel", "params": { "id": 7 } }
```

**方向判定只看这两个字段**（不需要握手期协商、不需要角色标记）：

| 收到的帧 | 含义 |
|---|---|
| 有 `method` | 对方向**我**发起的请求（有 `id`）或通知（无 `id`） |
| 有 `result` 或 `error` | 是我**先前发出去**的请求的应答 |

## 3. id 的归属

**两个方向各一套 id 空间，互不冲突**——这一条决定了"谁维护 id 表"：

| 请求由谁发起 | id 由谁分配 | 谁维护在途表 |
|---|---|---|
| 宿主 → 后端 | 传输层（`crates/plugin-host`）分配，整数单调递增 | 传输层 |
| 后端 → 宿主 | **后端**分配 | 后端 |

由此得出三条硬规定：

1. **收到 request 的一方不重编号**：应答时把原样的 `id` 写回。
2. **超时/取消只作用于"我发出去"的请求**，方向因此无歧义。
3. **未知 id 的 response 必须被静默丢弃**，不得判协议错误——否则"取消之后迟到的应答"会把连接判死（见 §5）。

## 4. 方法名空间

| 前缀 | 归谁 | 例子 |
|---|---|---|
| `$/` | **Cambia 协议保留**，宿主与插件都不得占用 | `$/initialize`、`$/shutdown`、`$/cancel` |
| 其余 | **宿主定义**（kernel.md 1.9）。Cambia 不预置任何领域方法，也不校验方法名形状 | `tools/execute`、`sessions/append` |

"服务契约"（哪个方法对应哪个服务键）**不在本协议里**：它是宿主的词汇表，`spec/` 不解释它。

## 5. 生命周期与控制方法

### `$/initialize`（宿主 → 后端，request，**必须第一个**）

```jsonc
// params
{ "protocolVersion": 1, "plugin": { "id": "…", "version": "…" }, "host": { "name": "…", "version": "…" } }
// result
{ "protocolVersion": 1 }
```

- **后端在收到并接受 `$/initialize` 之前不得发起任何请求**（只能应答）。违反 = 协议错误。
- 这个往返**就是"就绪"信号**：宿主判定"进程起来了 **且** 握手在超时内完成"（[../../docs/design/host.md](../../docs/design/host.md) 的启动判定）。
- 版本不匹配：后端回 `error`，`data.code = "PROTOCOL_VERSION_UNSUPPORTED"`；宿主判**该插件的后端不支持**并回收进程——**不降级、不猜**（kernel.md 3.3）。

### `$/shutdown`（宿主 → 后端，request）

开始优雅关闭。后端应停止接受新请求、释放资源，然后回 `result: null`（`null` 是唯一合法结果）。宿主随后关闭 stdin 并等进程退出，超过 `shutdownTimeout` 再收拾整棵进程树。

### `$/cancel`（双向，notification）

```jsonc
{ "jsonrpc": "2.0", "method": "$/cancel", "params": { "id": 7 } }
```

语义：**"请取消你先前发给我、id 为 7 的那条请求"**。id 落在接收方的**出站表**里，所以方向无歧义。

- **尽力而为**：收到方可以继续跑完；发取消的一方**不得**因为"对方没停"判任何失败。
- 调用方一旦超时或取消，就**不再期待**该 id 的应答；应答仍然到达时按 §3 第 3 条丢弃。

## 6. 错误

两级：`error.code` 是 **JSON-RPC 数字码**（协议层分类），`error.data.code` 是 **Cambia 的字符串码**（[error-codes.json](./error-codes.json)，唯一来源）。

| 数字码 | 含义 | `data.code` |
|---|---|---|
| `-32700` | 收到的行不是合法 JSON | `PROTOCOL_PARSE_ERROR` |
| `-32600` | 是合法 JSON，但不是本协议的消息（缺 `jsonrpc`，或 `method` 与 `result`/`error` 都不像） | `PROTOCOL_INVALID_MESSAGE` |
| `-32601` | 方法名不认识 | `PROTOCOL_METHOD_NOT_FOUND` |
| `-32602` | 参数形状不对 | `PROTOCOL_INVALID_PARAMS` |
| `-32603` | 对端内部错误 | `PROTOCOL_INTERNAL_ERROR` |
| `-32000` | 协议版本不被接受（只在 `$/initialize` 的应答里） | `PROTOCOL_VERSION_UNSUPPORTED` |
| `-32001` | 调用超时（**由传输层合成**，不跨进程传递） | `PROTOCOL_CALL_TIMEOUT` |
| `-32002` | 对端取消了这条请求 | `PROTOCOL_CANCELLED` |
| `-32003` | 单帧超过 `MAX_FRAME_BYTES` | `PROTOCOL_FRAME_TOO_LARGE` |
| `-32004` | 对端进程已退出，在途请求随之失败 | `PROCESS_EXITED` |
| `-32005` | 在途请求数达到宿主策略的上限，**立刻失败而不是排队** | `PROTOCOL_TOO_MANY_IN_FLIGHT` |

本协议要求**每一条 `error` 都带 `data.code`**（上表每一行都有），因为调用方是按 `data.code` 分派的，数字码只用来分类；两个码都稳定，措辞可变。`-32000…-32099` 是 JSON-RPC 的实现自定义区间，Cambia 自己的语义都放这里。

## 7. 超时与取消的责任划分

1. **超时值由调用方给**（`timeoutMs`），**必填**——传输层不带自己的默认值，否则就是两套默认值（宿主策略给一个值，例如 30s）。
2. 超时到点，传输层必须做三件事：给调用方回 `PROTOCOL_CALL_TIMEOUT`；向对端发 `$/cancel`；**不动进程**。
3. **超时 ≠ 进程死亡**（[../../docs/design/plugin-host.md](../../docs/design/plugin-host.md) 失败路径）：单次调用失败只影响这一次。
4. **计时从"写进管道之前"开始**，不等对端确认收到——否则"对端收到了却永不回"没有任何兜底（[../../docs/design/plugin-host.md](../../docs/design/plugin-host.md) 专节）。
5. 取消同理：它必须在对端把 JS 事件循环卡死时**仍然能发出**，所以取消的发起与计时都在传输层。

## 8. 断开与在途请求

| 事件 | 含义 | 传输层必须做的 |
|---|---|---|
| stdin 关闭 | 宿主不要这个后端了 | 后端应自行退出（**别**等下一次调用） |
| stdout EOF | 后端进程结束了 | 所有在途请求以 `PROCESS_EXITED` 失败；不再写帧 |
| 任一方向解析出协议错误 | 通道已不可信 | **断开**：停止读写、让监督器回收进程（进程层面的重启用**新世代**，不"重连"这个实例） |

**没有重连**：进程实例与世代号一一对应，重启就是新进程 + 新世代（[../../docs/design/plugin-host.md](../../docs/design/plugin-host.md) 进程表）。

## 9. 背压

- 读循环**不得**因为写而阻塞：写侧要排队，而不是"读到一半停下来等对端"。
- 在途请求数上限由宿主策略定；达到上限时调用方**必须立刻以 `PROTOCOL_TOO_MANY_IN_FLIGHT` 失败**，**不得**无限排队——排队会把"对端慢"变成"记忆体涨"。
- 大块数据**不进协议**（kernel.md 3.3）：v1 不提供带外通道，超过 `MAX_FRAME_BYTES` 的载荷由**宿主自己**走临时文件之类的手段，那不属于 Cambia 的协议。

## 10. v1 明确不做

`$/progress`（流式进度）、`$/ping`、批量数组、blob/共享内存通道、双向流（前端插件直接连后端进程）、协议版本协商出第二个版本、LSP/MCP 的任何握手或会话语义（[../../docs/implementation.md](../../docs/implementation.md) 3.3(f) 已解释为什么否决那两个候选）。

## 11. 第二种语言的实现证据

v1 的实现证据是 `examples/` 下的 **Node 与 Python 两个最小 SDK** 跑**同一组双向用例**、结论一致（[../../docs/plan.md](../../docs/plan.md) K2.6 的验收）。一个最小 SDK 的职责只有五件：

1. 一行一帧地读写；
2. 应答宿主请求（含 `$/initialize`、`$/shutdown`）与回写原 id；
3. 自己分配出站 id 并维护在途表（供超时与 `$/cancel` 用）；
4. 收到未知 id 的应答时丢弃；
5. 进程退出前让所有在途请求失败。

## 未决项

| 未决项 | 现在怎么办 |
|---|---|
| 在途请求数上限的**具体值**（码已定：`PROTOCOL_TOO_MANY_IN_FLIGHT`） | 属宿主策略；K2.6 落地时用一个明确值把行为固定下来 |
| manifest 的 `protocol` 是否收成枚举（现在 `z.string().min(1)`） | **倾向保持 string**：装了但协议不支持应当是**运行期策略**（宿主拒绝该插件的后端），而不是 manifest 校验失败——与顶层键宽松同源。归 K3.1 复核 |
| `$/shutdown` 之后后端是否必须先回再退 | 现在写的是"应回 `result: null`"（不是必须）：宿主以"进程退出"为准，`shutdownTimeout` 到点就收拾整棵树，所以一个不回的后端只是慢，不是错 |
| 协议版本推进（v2）与废弃窗口 | K3.1 定稿 |
