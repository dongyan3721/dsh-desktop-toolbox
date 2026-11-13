# Antigravity 第二轮交接文档：Node 桥客户端修正 (Round 2)

## 1. 基础信息

- **Agent / 模型**: Antigravity / Gemini 3.8 Flash (High)
- **Git 工作树**: `D:\Code\dsh-toolbox\.worktrees\antigravity`
- **当前分支**: `agent/antigravity-bridge`
- **基线**: `3901564` (第一轮交付 commit: `f4f91cc`)
- **遵循协议规范**: 主目录 `docs/BRIDGE_PROTOCOL.md` (包含 2026-11-13 Round 2 decisions 权威裁定)

---

## 2. 第二轮改进与收口项清单

严格只修改分配的写入范围：`packages/dsh-toolbox/src/bridge/**`、`packages/dsh-toolbox/tests/bridge*.test.mjs`、`docs/handoffs/ANTIGRAVITY_R2.md`。

### 2.1 审查收口项落实详情
1. **`close()` 必须等实际 `close` 事件**:
   - `close()` 严禁仅凭 `socket.destroyed` 就提前 resolve，也不在 `error` 或 `forceDestroyTimer` 触发时提前结束。
   - `onError` 仅确保调用 `socket.destroy()`，统一由 socket 底层的 `'close'` 事件触发最终的 `finish()` 并 resolve。
   - 结算时严格清理 `forceDestroyTimer`，消除后台残留定时器。
2. **已派发请求在 `socket.write` 错误或 `close()` 时均报告 `OUTCOME_UNKNOWN`**:
   - 一旦帧已提交给 `socket.write`（即已被操作系统/管道接管），若写入回调报错或被 `close()` 中断，客户端无法断定原生端是否已读取或提交写入，统一拒绝为 `OUTCOME_UNKNOWN`，并附加脱敏的 `causeCode`（如 `'DISCONNECTED'` 或 `'CLOSED'`）。
   - 尚未发出的请求（如调用 `request()` 时客户端已处于 `isClosed` 或 `signal.aborted` 状态）直接拒绝为 `CLOSED` 或 `CANCELLED`，确保“未执行”与“未知终态”边界清晰。
3. **`ready` 分支支持批次后续帧处理**:
   - 修复 `socket.on('data')` 循环中 `!isHandshaken` 校验通过后直接 `return resolve(client)` 导致同一数据块中粘包的后续帧丢失的问题。
   - 现改为 `isHandshaken = true; resolve(client); continue;`，继续无缝处理同一数据块中的后续 `response` 或 `event` 帧。
4. **全面覆盖取消与超时的权威终态演变测试**:
   - 保留并更新所有取消/超时测试断言：验证在宽限期内返回权威成功、原生确认 `CANCELLED`、宽限期耗尽返回 `OUTCOME_UNKNOWN`（`causeCode: 'CANCELLED'` / `'TIMEOUT'`）并拆除管道。

### 2.2 严格 UTF-8 与信封校验 (`framing.js`, `validation.js`)
- **严格 UTF-8 解码**: 采用 `new TextDecoder('utf-8', { fatal: true })` 替代默认的 `Buffer.toString('utf8')`，遇到非法字节（如 `0xff`）时立即抛出 `PROTOCOL_ERROR`，严禁使用替换字符静默掩盖。
- **信封结构与非空对象限定**: 拦截 JSON 数组和基本类型信封；校验未成对 Unicode 代理（Lone surrogates）。
- **字段白名单与互斥校验**:
  - `ready`: 严格要求 `v: 1`、`type: 'ready'`、`instanceId` 与去重且非空的 `capabilities` 字符串数组，拒绝未知字段。
  - `response`:
    - 成功分支 (`ok: true`): 必须包含 `result`，严禁包含 `error`。
    - 失败分支 (`ok: false`): 必须包含 `error`（且内含有效字符串 `code` 与 `message`），严禁包含 `result`。
  - `event`: 必须包含 `v: 1`、`type: 'event'`、`id`、`event`、`data`，拒绝未知字段。
- **错误脱敏**: 畸变或超限帧的错误信息均使用固定模板，绝不回显原始载荷或潜在私密内容。

### 2.3 资源限制与清理
- 限制在途请求数量上限 `MAX_ACTIVE_REQUESTS = 1000`，超限时稳定拒绝为 `RESOURCE_LIMIT_EXCEEDED`。
- 请求完成、取消、超时或客户端关闭时，严格注销关联的 `signal` 监听器和各种 timer。

---

## 3. 测试命令与实际结果

在工作树执行测试：

```powershell
Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity'
. .\scripts\Use-ProjectEnvironment.ps1
node --test packages/dsh-toolbox/tests/bridge*.test.mjs
```

### 实际输出 (37 测全部通过)：

```text
✔ successful connection, handshake, and capabilities exchange (73.8162ms)
✔ handshake failure on version mismatch (6.1599ms)
✔ handshake failure on instanceId mismatch (4.2221ms)
✔ handshake failure on bad capabilities: not array, empty string, or duplicates (14.3444ms)
✔ handshake timeout when server never responds (62.207ms)
✔ handshake aborted via AbortSignal (21.5297ms)
✔ validates timeoutMs and cancelTimeoutMs parameters as positive finite numbers (1.5617ms)
✔ request and response roundtrip with ok: true (58.3663ms)
✔ request and response error with ok: false maps to BridgeError with stable code (56.2584ms)
✔ rejects response frames with contradictory or malformed envelopes (16.0314ms)
✔ concurrent requests maintain ID mapping and resolve correctly out of order (54.9956ms)
✔ pre-aborted signal rejects immediately without sending request frame (57.7006ms)
✔ dispatched cancellation: server confirms CANCELLED, client rejects CANCELLED (56.5723ms)
✔ dispatched cancellation: server committed before cancel, client resolves canonical success (54.545ms)
✔ dispatched cancellation: server silent, cancel grace expires, rejects OUTCOME_UNKNOWN and tears down (84.8787ms)
✔ request timeout: server silent, cancel grace expires, rejects OUTCOME_UNKNOWN with causeCode TIMEOUT (103.5515ms)
✔ request timeout: server committed before cancel, returns authoritative success during grace (105.9179ms)
✔ request timeout: server acknowledges cancel during grace period, rejects CANCELLED (105.033ms)
✔ coalesced ready and response frames in same data batch are both processed without frame dropping (53.7713ms)
✔ server sudden disconnection rejects in-flight request with OUTCOME_UNKNOWN and causeCode DISCONNECTED (2.925ms)
✔ close() is idempotent, clears forceDestroyTimer, rejects dispatched pending with OUTCOME_UNKNOWN (53.7353ms)
✔ request properly cleans up signal abort listeners on completion and on abort (55.3043ms)
✔ progress event delivery to onEvent callback (89.2319ms)
✔ malformed frame received post-handshake triggers PROTOCOL_ERROR and connection teardown (5.0225ms)
✔ rejects requests when MAX_ACTIVE_REQUESTS limit is exceeded (136.3276ms)
✔ encodeFrame produces valid 4-byte unsigned LE length header followed by UTF-8 JSON (4.8874ms)
✔ encodeFrame rejects invalid input types and out-of-bounds frames (28.0927ms)
✔ encodeFrame rejects unpaired Unicode surrogates (0.3189ms)
✔ FrameDecoder handles single complete frame (1.6377ms)
✔ FrameDecoder handles partial frames split across multibyte UTF-8 boundaries (2.4215ms)
✔ FrameDecoder handles coalesced frames in a single chunk (1.3772ms)
✔ FrameDecoder rejects zero-length frame header (0.4999ms)
✔ FrameDecoder rejects oversized frame header exceeding 4MiB (0.3222ms)
✔ FrameDecoder rejects invalid UTF-8 sequence with fatal decoder (0.5657ms)
✔ FrameDecoder rejects malformed JSON payload without echoing private contents (0.6085ms)
✔ FrameDecoder rejects JSON array envelopes (0.5783ms)
✔ FrameDecoder rejects non-object JSON primitive payloads (0.4663ms)
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1708.7034
```

---

## 4. API 变化与 Codex 集成要点

1. **`connectBridge` 选项**:
   - `cancelTimeoutMs`: 正有限数字，默认 `1500` ms。
2. **错误码与错误对象**:
   - `OUTCOME_UNKNOWN`: 适用于取消宽限期超时、中途掉线、写入回调失败或 close 发生时在途的已派发请求。其 `error.causeCode` 提供底层诱因（如 `CANCELLED`、`TIMEOUT`、`DISCONNECTED`、`CLOSED`）。
   - `RESOURCE_LIMIT_EXCEEDED`: 在途请求超出 1000 上限时触发。
3. **集成层原则**:
   - 收到 `OUTCOME_UNKNOWN` 时，代表操作可能已落盘，客户端已拆除通信连接。集成层切勿盲目无幂等重试写操作，应由上层在重启后通过查询或对账进行核实。
