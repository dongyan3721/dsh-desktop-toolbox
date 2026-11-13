# Cursor / Grok 4.7 High 交接 — A3

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`

分支：`agent/cursor-native`

第一阶段提交 `52d3070` 已在 integration。本阶段提交 `1f98a56`。没有启动桌面，没有真实截屏、系统剪贴板、全局热键或安装 Profile。Vue 由 CodeBuddy 在原 antigravity 工作树实现，协议字段没有另起一套。

## 便笺

`agent.notes.search` 返回 `{items}`。每条是摘要：`id`、`title`、最多 120 字 `preview`、`updated_at`、`is_open`、位置、尺寸、`is_pinned`。没有正文。没有实现总数，响应里不放 `total`，也不填假数字。

`commit_agent_update` 成功后仍 `begin_write_session`。这个游标只挡住旧的无会话自动保存。关闭的便笺即使 `has_write_session` 为 true，read/update 也直接走数据库 CAS，不握手。

只有窗口 `is_open` 才需要编辑器会话。会话来自该便笺窗口调用 `toolbox_agent_ui_ready`，标签必须是 `sticky-note-{id}`。窗口开着但还没注册时，read/update 返回 `UNAVAILABLE`，文案是 `open note editor is not synchronized yet`。已注册时，read/update 先发 `prepare`，原生再读库并做 `expected_updated_at` CAS。冲突不覆盖。成功后 `apply` 带已提交记录和新的 `write_session_id`，然后 `release`。`apply` 丢失或提交后取消时，库记录保留，`display_sync` 为 `pending`，结果不是 `CANCELLED`。关闭便笺成功时 `display_sync` 为 `closed`；已注册编辑器 apply 成功时为 `applied`。

人保存 `save_content` 使用单调冲突令牌。同一毫秒内的 flush 也会推进 `updated_at`，避免 CAS 把刚刷入的草稿当成未变化而覆盖。

## 人机握手

只接受带真实窗口的 IPC。`invoke_ipc` 不带窗口时拒绝 `toolbox_agent_ui_ready` 和 `toolbox_agent_ui_result`。生产路径用 `window.label()`，不信参数里的 actor 或窗口名。

`toolbox_agent_ui_ready`：`{kind:'notes', note_id}` 或 `{kind:'ink'}`。返回原生生成的 `{session_id}`。新 ready 替换旧会话。

`toolbox_agent_ui_result`：`{kind, request_id, session_id, operation, ok, result?, error?}`。只接受错误码 `BUSY` 和 `CONFLICT`。窗口、会话、操作、重复或过晚的回执不提交，返回 `{acknowledged:false}`。

原生只向对应窗口发事件，不广播。

- `sticky://agent-command`：`{request_id, session_id, note_id, operation:'prepare'|'apply'|'release', record?, write_session_id?}`
- `screen-ink://agent-command`：`{request_id, session_id, operation:'draw'|'snapshot'|'clear', strokes?, canvas_bounds:{x,y,width,height,scale_factor}}`

等待在内核锁和主线程之外，默认最多 5 秒，并观察管道取消。`prepare` 失败或超时仍 `release`。

## 画布与图像

`agent.ink.draw`、`agent.ink.snapshot` 已进入数据方法和桌面能力。没有 ready 会话时返回 `UNAVAILABLE`，不假装画布已动。指针笔画进行中返回 `BUSY`。Agent 坐标是虚拟桌面物理像素，负原点有效；发给原画布的是按窗口边界和缩放过的逻辑点。draw 在 ack `{applied}` 之后返回 `{applied, revision}`，这里的 `revision` 是全局 access snapshot，不是产物 epoch。snapshot 只接受 ack 里的画布 PNG，校验签名、IHDR、解码尺寸和上限后再入库。clear 走同一握手。人的 `ink_clear_canvas` 没改。

`agent.artifacts.read` 只在 `DESKTOP_CAPABILITIES`，不在 `agent.get_access` 的 methods。参数 `{artifact_id, module_id, offset, length}`，`length` 1..65536。响应 `{artifact_id, module_id, offset, total_bytes, mime_type, width, height, revision, data_base64, eof}`。`revision` 是该模块的 `agent_grant_epoch`。descriptor 带 `module_id` 和同一个 epoch。全局 `snapshot.revision` 仍是 `AppKernel::agent_revision`，两边不比较。撤回再授权后旧产物 epoch 不匹配，读返回 `UNAVAILABLE`。账本只在内存；重启后即使 PNG 文件还在也不能读。上限 16MiB、1600 万像素、TTL 15 分钟、合计 256MiB。

提交点之后的取消不再把已成功的结果改成 `CANCELLED`。剪贴板写入、便笺 create/update CAS、产物入库都是提交点。测试钩子 `agent_flip_cancel_on_commit` 在提交后置位，返回值仍是 Ok。

## 测试

```powershell
. .\scripts\Use-ProjectEnvironment.ps1
$env:CARGO_TARGET_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target'
$env:CARGO_BUILD_BUILD_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\intermediates'
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 agent_api human_grant
```

宿主 `agent_api` 与 `human_grant` 共 12 通过。覆盖：search 只有 `items`、关闭便笺 create→update→read→再次 update、人关闭后仍可读写且写入游标还在、未注册的打开窗口为 `UNAVAILABLE`、prepare flush 后 CAS 冲突且旧自动保存不覆盖、物理点 `(4,6)` 变成逻辑 `(2,3)`、重复 ack 不生效、分块 revision 等于授权 epoch、撤回再授权不能读旧产物、提交后取消仍保留剪贴板记录。

第一阶段 app-core 授权迁移 5 通过，记录在 `52d3070`，这次没有重跑。

## 未测

真实 OS 剪贴板、真实显示器、`RegisterHotKey`、WebView 像素和 GUI。CodeBuddy 需要在原窗口处理上述两个事件并回 `toolbox_agent_ui_result`。Node 继续用全局 snapshot revision 做发布期间不变校验，用产物 epoch 核验分块。
