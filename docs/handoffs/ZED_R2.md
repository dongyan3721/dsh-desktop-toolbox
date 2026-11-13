# Zed 第二轮交接：工具边界与取消终态

日期：2026-11-13
工作树：`D:\Code\dsh-toolbox\.worktrees\zed`
分支：`agent/zed-features`
第一轮基线提交：`9ab4be3`
本轮提交：本文件所在分支的最新提交（`git log -1`）
模型：保持用户当前 Claude Agent ACP / 自定义 DeepSeek Flash，未切换。

## 本轮变更

仅在分配范围内修改：

| 文件 | 说明 | SHA-256 |
| --- | --- | --- |
| `packages/dsh-toolbox/src/features/notes.js` | 分页、Unicode scalar、控制符、取消终态 | `76c602d85df14e556ee3a8e525fc9781f69f4efa44def0fdd67ae9dfeb1652b2` |
| `packages/dsh-toolbox/src/features/images.js` | 路径文本校验、取消终态、结果净化 | `3c3d631d9f2b36ec19e1c8d18347dd1a01d8f708b7a7e16c634a9fc11025239a` |
| `packages/dsh-toolbox/tests/features.notes.test.mjs` | 便笺回归测试 | `ae070c44f0d68b9a66cac37604a39849474f3190968e1b23fae7a56802aa540a` |
| `packages/dsh-toolbox/tests/features.images.test.mjs` | 图片回归测试 | `eeef83bb9cabb7450d6be1269d000b8b65951db885579bba360abedf7b7aea7f` |
| `docs/handoffs/ZED_R2.md` | 本交接 | — |

未修改插件入口、bridge、根配置、公共协议、原生源码或其他 agent 文件；未从主目录复制旧协议覆盖本轮实现。

## 与最新协议的边界对齐

所有文本长度均按 Unicode scalar value（Rust `char`）计数；JavaScript 字符串中的合法代理对按一个 scalar 计，孤立 surrogate 直接拒绝。合法原文原样传给 bridge，不做 trim、NFC/NFD 或其他规范化。

| 字段 | 规则 |
| --- | --- |
| `title` | 1..500 scalars，非纯空白；拒绝所有 U+0000..U+001F |
| `id` | 1..80 scalars；拒绝所有 U+0000..U+001F |
| `query` | 1..200 scalars，非纯空白；拒绝所有 U+0000..U+001F |
| `content_md` | 0..1,048,576 scalars；仅允许 TAB/LF/CR，其他 U+0000..U+001F 拒绝 |
| `limit` | 1..20，默认 20 |
| `offset` | 0..10000，默认 0 |
| `expected_updated_at` | 非负安全整数 |
| 原生结果整数 | 全部要求 `Number.isSafeInteger`；`pos_x`/`pos_y` 允许负值 |

工具描述与实际领域校验一致。`open` 仍只接受 `false`/省略，协议请求固定发送 `open:false`。

## 取消与写入终态

- 请求发送前已取消：工厂不调用 bridge，返回调用方 `AbortSignal` 的 `AbortError`；图片授权期间取消同样不发请求。
- 请求已发送后：工厂不再调用 `signal.throwIfAborted()`，也不把 bridge 的权威成功改写为取消。bridge 返回成功即返回规范结果，即使 `signal.aborted` 在等待期间已为 true。
- `CANCELLED`、`OUTCOME_UNKNOWN`（含 `causeCode`）、`TIMEOUT`、`DISCONNECTED`、`INTERNAL` 等稳定错误原样传播；工厂不重试，测试断言每次调用只触发一次 bridge 请求。
- 图片授权仍为 fail-closed：authorizer 缺失/非函数/返回非严格 `true`/抛错都不调用 bridge。授权发生在 IPC 之前。

## 输出净化与兼容

- `StickyNoteRecord` 仍规范化为协议字段；bridge 返回的额外字段（如未来新增内部字段）被剥离。
- 真实原生字段形状已覆盖：`id,title,content_md,theme_color,opacity,pos_x,pos_y,width,height,is_pinned,is_open,updated_at`。
- 边界覆盖包括 `pos_x=-2147483648`、`pos_y=2147483647`、`width=4294967295`、`updated_at=9007199254740991`；超出安全整数的记录/`total`、非有限 `opacity` 转为 `INTERNAL`。
- 图片结果只保留 `{outputPath, format}`；输出路径也要通过合法 UTF-8/无控制符检查。
- 所有 `render()` 仍为纯函数：不读取文件、不访问时钟/随机数、不调用 bridge 或 authorizer。

## 测试

命令（工作树内，先加载项目环境）：

```powershell
powershell.exe -NoProfile -Command ". 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'; Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed'; node --test packages/dsh-toolbox/tests/features*.test.mjs"
```

实际结果：`tests 41`、`pass 41`、`fail 0`、`cancelled 0`、`skipped 0`（Node 24.x，2026-11-13）。

新增/更新覆盖：

- pagination：默认值、`limit=20`、`offset=10000` 接受，`21`、`10001` 拒绝。
- 文本：500/501、80/81、200/201、1,048,576/1,048,577 scalar 边界；emoji 标量计数；合法原文保留。
- 非法文本：孤立高/低 surrogate、C0 控制符、标题/查询纯空白；`content_md` 的 CR/LF/TAB 放行。
- 原生结果：真实字段形状、额外字段剥离、JSON round-trip、安全整数边界、非有限 opacity。
- 取消：请求前取消不调用 bridge；请求中取消信号透传；权威成功在 signal 事后 aborted 时仍成功。
- 错误：`CANCELLED`/`OUTCOME_UNKNOWN`/`TIMEOUT`/`DISCONNECTED`/`INTERNAL` 身份原样传播且不重试。
- 图片：缺 authorizer、拒绝、异常、非严格 true 均不调用桥；路径 surrogate/控制符在授权前拒绝；合法 Unicode 路径原样传递；结果净化。

## 未测与集成请求

- 未连接真实 native bridge，未运行真实 SQLite 便笺、真实图片转换、Cordis Loader、UI 或硬件测试；bridge 仅出现在测试 fake 中。真实 E2E 由 Codex 负责。
- 未注册任何工具。请 Codex 只在 ready capabilities 实际包含 `notes.create/search/update` 时注册便笺工具；当前 `media.convert_image` 未实现，必须不注册图片工具。
- 请 Codex 继续把 Harness 文件/工作区策略注入 `authorizePaths`，并保持 junction/symlink 感知；authorizer 必须显式返回 `true`。
- 工具层对已发送请求不再二次判断 signal；若宿主外层结果策略另有取消优先规则，请按宿主策略独立验证，工具层不会把原生权威成功改成取消。
- 未修改 `presentCall()`/`presentResult()`；仍等待 SDK 提供可核对的意图形状。
