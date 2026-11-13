# Cursor / Grok 4.7 High 交接 — A2 授权与四模块共享

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`

分支：`agent/cursor-native`

未合并 `main`。没有启动桌面，没有真实截屏、系统剪贴板写入、全局热键或安装 Profile。`MockOsHal` 路径在结果里标成 `synthetic: true` 或 `backend: "mock"`，不能当成真实显示器或系统剪贴板。

## 提交

- `1f3375c` 配置版本 5、`modules.agent_access`、四项白名单、目录三个字段、人的 `kernel_set_agent_access`、每次调用的 `authorize_agent`。
- `f3e796b` 同一 `DesktopHost` 上的 Agent 数据方法。控制管道、参数隔离和快捷键回归仍在 H1 提交里。

## 阶段 1：目录与授权

人的“开启功能”和“允许 Agent 访问”分开保存。缺省授权是 false。旧版本 4 配置迁到 5 时只补空的 `agent_access`，保留 `enabled`、`settings`、快捷键和未知字段。不支持的模块即使被写成 true 也不算授权。

`kernel_list_modules` 增加 `agent_supported`、`agent_allowed`、`agent_effective`。有效访问还要模块已挂载并且已开启。

`kernel_set_agent_access` 只接受 `{module_id, allowed}`，返回完整目录。未知模块、不支持模块、额外的 `actor` 都拒绝。功能关闭时可以保存授权；关闭功能不清除授权；关闭授权不关功能，也不改 `usage_tracking`。保存失败时内存授权不变。

`AppKernel::authorize_agent` 的顺序是支持、是否挂载、是否开启、是否授权，对应 `UNSUPPORTED`、`UNAVAILABLE`、`MODULE_DISABLED`、`AGENT_ACCESS_DENIED`。控制管道不接受 `kernel_set_agent_access`。人的 `clipboard_list_items` 在未授权时仍可用。

默认目录样例：

```json
{"id":"clipboard","enabled":true,"agent_supported":true,"agent_allowed":false,"agent_effective":false}
{"id":"sticky_note","agent_supported":false,"agent_allowed":false,"agent_effective":false}
```

阶段 1 测试：`agent_access` 4 通过，`test_config_migration` 1 通过，`human_grant` 2 通过。

## 阶段 2：已实现的方法

都在原来的 GUI `DesktopHost` 上。`agent.get_access` 只返回修订号、目录三字段和下面这些方法名，不带配置、剪贴板正文或统计明细。`methods` 不包含尚未完成的绘制和快照。

已广告：

- `agent.screenshot.monitors` `{}`
- `agent.screenshot.capture` `{monitor_id, region?}`
- `agent.clipboard.list` `{keyword?, limit?}`，默认 20，最大 100
- `agent.clipboard.read_text` `{id}`
- `agent.clipboard.write_text` `{text}`，最大 64KiB
- `agent.ink.status` / `start` / `stop` `{}`
- `agent.ink.passthrough` `{enabled}`
- `agent.ink.clear` `{}`
- `agent.usage.status` `{}`
- `agent.usage.overview` / `apps` `{start_date, end_date, limit?}`
- `agent.usage.hourly` `{date}`

`agent.notes.create`、伪造字段和人的授权命令都是 `UNSUPPORTED` 或 `INVALID_REQUEST`。取消发生在写入或返回产物之前时返回 `CANCELLED`，不留下剪贴板记录。

响应样例（测试用 mock，不是真实桌面）：

```json
{"revision":1,"modules":[{"id":"clipboard","agent_supported":true,"agent_allowed":false,"agent_effective":false}],"methods":["agent.screenshot.monitors"]}
{"synthetic":true,"monitors":[{"id":1,"name":"Built-in Retina Display","x":0,"y":0,"width":1920,"height":1080,"scale_factor":2.0,"is_primary":true}]}
{"artifact_id":"<32 hex>","mime_type":"image/png","byte_length":0,"width":8,"height":8,"relative_path":"agent-artifacts/screenshot/<id>.png","synthetic":true,"revision":2}
{"items":[{"id":1,"item_type":"text","created_at":0,"updated_at":0,"preview":"synthetic-agent-clip"}]}
{"id":1,"text":"synthetic-agent-clip"}
{"id":1,"backend":"mock","recorded":true}
{"is_active":true,"is_passthrough":false,"active_tool":"pen","color":"#ef4444","stroke_width":4.0}
{"tracking":true,"sample_interval_ms":1000}
```

`agent.usage.overview` 与人的 `usage_get_overview` 使用同一张统计表，测试里两边的 `total_seconds` 相等。查询不会打开采样；关掉 `app_usage` 会停掉采样线程，再打开会重新启动，不会另起一条。剪贴板监听在桌面进程里只启动一次，循环每次都看模块是否仍开启，关闭后不再读系统剪贴板。这条监听没有在本轮测试里启动。

显式写入在 mock 宿主里进入 `agent_clipboard_writes`，并调用同一历史表的 `record_explicit_text`。生产宿主才会调用 `arboard`。相同文本仍受历史表的哈希唯一约束，会更新原行而不是插入第二行；系统写入本身不会因为内容相同而跳过。本轮没有调用 `arboard`。

截图产物写在数据目录的 `agent-artifacts/screenshot/<id>.png`，旁边有同名 json，记录模块和授权修订。像素上限 1600 万，PNG 上限 16MiB。读取函数会再次检查截图授权；撤回后测试读不到字节。管道上没有把 PNG 分块交给模型的方法，结果里也没有 base64。

## 请 Codex / Antigravity 接的画布和图片

`agent.ink.draw` 和 `agent.ink.snapshot` 已做参数检查，但没有广告，调用返回 `UNAVAILABLE`。绘制不会发出半次生效的事件，快照也不会改用桌面抓屏冒充画布。

建议原画布增加：

1. 原生在校验通过后发 `screen-ink://agent-draw`：
   `{"request_id":"<uuid>","strokes":[{"points":[{"x":10,"y":12}],"color":"#112233","width":2}]}`
2. Vue 在现有画布上画完后回 `screen-ink://agent-draw-ack`：
   `{"request_id":"<uuid>","applied":1}`
3. 原生只有收到对应 ack 才返回 `{applied, revision}`。
4. 快照由 Vue 把当前画布 PNG 交给原生，原生写入 `agent-artifacts/screen_ink/<id>.png` 并返回与截图相同的描述符。不要由 Agent 提供路径，也不要用整屏抓图代替画布。

图片传输仍缺一段：描述符里的 `relative_path` 只在 GUI 数据目录内有效。需要 Codex 定一种不超过 4MiB 帧的分块或 SDK 图像结果，并在下载和交给模型前再次检查截图或注释授权。只有路径字符串还不能算模型已经看到图。`agent.ink.clear` 继续走原来的 `screen-ink://clear-canvas`。

## 阶段 2 测试

```powershell
. .\scripts\Use-ProjectEnvironment.ps1
$env:CARGO_TARGET_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target'
$env:CARGO_BUILD_BUILD_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\intermediates'
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 agent_api
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 ready_waits human_grant
```

`agent_api` 6 通过。`ready_waits` 与两条 `human_grant` 通过。没有跑全量库测试，没有打包。

## 未做

真实显示器、系统剪贴板、全局热键、WebView 画布和模型看图都没有验收。长截图、GIF、OCR 不在本轮 Agent 方法里。六个不支持模块没有 Agent 适配。
