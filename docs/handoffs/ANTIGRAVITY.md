# Antigravity 交接文档：Node 桥客户端 (Bridge Client)

## 1. 基础信息

- **Agent / 模型**: Antigravity / Gemini 3.8 Flash (High)
- **Git 工作树**: `D:\Code\dsh-toolbox\.worktrees\antigravity`
- **当前分支**: `agent/antigravity-bridge`
- **上游基线**: `caf643f`
- **对应协议规范**: `docs/BRIDGE_PROTOCOL.md` (v1)

---

## 2. 交付与修改文件范围

严格在分配的写入范围内工作，不修改根 manifest、lockfile、插件入口 `src/index.js`、共享协议、原生源码或 Zed 的 features：

- `packages/dsh-toolbox/src/bridge/errors.js`:
  - 导出 `BridgeError`，包含稳定的协议错误代码（如 `INVALID_REQUEST`, `UNSUPPORTED`, `DISABLED`, `CANCELLED`, `TIMEOUT`, `NOT_FOUND`, `CONFLICT`, `ACCESS_DENIED`, `DEPENDENCY_MISSING`, `INTERNAL`, `DISCONNECTED`, `CLOSED`, `PROTOCOL_ERROR`, `HANDSHAKE_FAILED`）。
- `packages/dsh-toolbox/src/bridge/framing.js`:
  - 实现 4 字节 unsigned Little-Endian 长度前缀与 UTF-8 JSON 编码解码器。
  - 导出 `encodeFrame(message)`、`FrameDecoder` 类及边界常量 `MIN_FRAME_LENGTH` (1)、`MAX_FRAME_LENGTH` (4MiB / 4,194,304 字节)、`HEADER_LENGTH` (4)。
  - `FrameDecoder` 支持流式累积分包（Partial frames）、合并包（Coalesced frames）、超界检测（0 字节或 > 4MiB 立即抛 `PROTOCOL_ERROR`）、非 JSON 及非对象载荷拦截。
- `packages/dsh-toolbox/src/bridge/client.js`:
  - 导出 `connectBridge({ pipePath, instanceId, signal, timeoutMs = 5000 })`。
  - 返回 Promise<{ request, close, capabilities, isClosed }>。
  - 严格握手验证：连接建立后发送 `{ v:1, type:'hello', instanceId }`，校验服务端返回 `{ v:1, type:'ready', instanceId, capabilities }`，包含版本、实例 UUID 及 capabilities 数组结构校验。
  - 并发请求与 ID 映射：使用 `crypto.randomUUID()` 映射 activeRequests，支持乱序到达终端响应。
  - 请求取消与超时：通过 `signal` 和 `timeoutMs` 协作式发送 `{ v:1, type:'cancel', id }`，拒绝为 `CANCELLED` (`AbortError`) 或 `TIMEOUT`。
  - 服务端事件：支持接收 `{ v:1, type:'event', id, event, data }` 并分发给请求的 `onEvent` 回调，不终结请求。
  - 优雅关停与清理：`close()` 为异步且幂等，立即拒绝所有 pending 请求为 `CLOSED` 并安全等待 socket 关闭，彻底清理 signal/timer 监听器。
  - 异常隔离：连接意外断开或收到非法帧时，拒绝所有 pending 请求为 `DISCONNECTED` 或 `PROTOCOL_ERROR`，且**绝对不自动重试副作用请求**。
- `packages/dsh-toolbox/src/bridge/index.js`:
  - 统一导出 `connectBridge`、`BridgeError`、`encodeFrame`、`FrameDecoder` 及相关常量。
- `packages/dsh-toolbox/tests/bridge-framing.test.mjs`:
  - 9 项针对 framing 编解码、分包拼接、多包合并、0 长度帧、超 4MiB 帧、畸变 JSON/非对象载荷的单元测试。
- `packages/dsh-toolbox/tests/bridge-client.test.mjs`:
  - 17 项针对 Named Pipe 真实通信、握手、并发 ID 乱序映射、取消、超时、异常断线、重复 `close()`、事件分发、监听器清理的测试。
- `docs/handoffs/ANTIGRAVITY.md`:
  - 本交接文档。

---

## 3. 测试命令与实际结果

在工作树 `D:\Code\dsh-toolbox\.worktrees\antigravity` 下执行：

```powershell
Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity'
. .\scripts\Use-ProjectEnvironment.ps1
node --test packages/dsh-toolbox/tests/bridge*.test.mjs
```

### 实际输出 (26 测全部通过)：

```text
✔ successful connection, handshake, and capabilities exchange (97.8461ms)
✔ handshake failure on version mismatch (9.2721ms)
✔ handshake failure on instanceId mismatch (8.3944ms)
✔ handshake failure when server responds with non-ready frame (15.9914ms)
✔ handshake timeout when server never responds (68.1513ms)
✔ handshake aborted via AbortSignal (22.9287ms)
✔ request and response roundtrip with ok: true (55.3689ms)
✔ request and response error with ok: false maps to BridgeError with stable code (55.1179ms)
✔ concurrent requests maintain ID mapping and resolve correctly out of order (54.5657ms)
✔ request cancellation sends cancel frame and rejects with CANCELLED/AbortError (105.8636ms)
✔ pre-aborted signal rejects immediately without sending request frame (53.9565ms)
✔ request timeout sends cancel frame and rejects with TIMEOUT (154.141ms)
✔ server sudden disconnection rejects pending requests with DISCONNECTED (2.3553ms)
✔ close() is idempotent, rejects pending requests with CLOSED, and cleans up (52.5742ms)
✔ progress event delivery to onEvent callback (83.2906ms)
✔ request properly cleans up signal abort listeners on completion and on abort (52.4613ms)
✔ malformed frame received post-handshake triggers PROTOCOL_ERROR and connection teardown (1.4588ms)
✔ encodeFrame produces valid 4-byte unsigned LE length header followed by UTF-8 JSON (11.2531ms)
✔ encodeFrame rejects out-of-bounds frames (18.1779ms)
✔ FrameDecoder handles single complete frame (0.9293ms)
✔ FrameDecoder handles partial frames split across multiple chunks (0.5527ms)
✔ FrameDecoder handles coalesced frames in a single chunk (0.681ms)
✔ FrameDecoder rejects zero-length frame header (3.9625ms)
✔ FrameDecoder rejects oversized frame header exceeding 4MiB (0.6047ms)
✔ FrameDecoder rejects malformed JSON payload (2.1633ms)
✔ FrameDecoder rejects non-object JSON payload (0.9485ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1335.406
```

---

## 4. 建议 Codex 在插件层接入 `ctx.effect` 的清理顺序

当 Codex 在插件入口中接入桥生命周期时，建议按如下严格顺序进行资源销毁与注销：

1. **停止派发新调用**: 工具层标记不可用（或从 Cordis 卸载 tool 定义），不再接受新工具执行。
2. **协作式取消在途请求**: 触发正在执行请求关联的 `AbortController`，使得客户端向原生桥发送 `type: 'cancel'` 消息。
3. **通知原生端安全关停**: 若原生子进程正常可达，可调用 `await bridge.request('bridge.shutdown', {}, { timeoutMs: 1500 })` 通知原生服务刷盘并释放独占锁。
4. **关闭客户端连接**: 调用 `await bridge.close()`。此方法是幂等的，会自动将残留 pending 请求拒绝为 `CLOSED` 并关闭 socket 连接。
5. **管理原生子进程销毁**: 等待原生进程自然退出（如 1 秒）；若超时未退出，由集成层进程管理器执行 `childProcess.kill()` 强行结束。
6. **释放 Fiber/Dispose**: 调用 `ctx.fiber.dispose()` 卸载插件上下文，清理临时管道及命名空间。

---

## 5. 跨边界与后续集成备忘

1. **测试夹具独立性**: 测试采用动态随机 Named Pipe `\\.\pipe\dsh-test-pipe-<uuid>`，测试结束后自动关闭并销毁连接，不干扰系统任何现有实例。
2. **Zed 工具工厂适配**: Zed 在 `features/notes.js` 和 `features/images.js` 中创建的工具工厂接收到本客户端后，可直接调用 `bridge.request(method, params, { signal: exec.signal })`。
3. **Cursor 原生桥对齐**: 客户端已完全实现 `BRIDGE_PROTOCOL.md` 规定的 4 字节小端长度前缀与 hello/ready 握手。Cursor 在 Rust 侧以同款 Named Pipe 监听并实现相应帧逻辑即可无缝互通。
