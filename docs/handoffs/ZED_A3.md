# Zed A3 交接：五模块 Agent 工具、便笺与图像生命周期

日期：2026-11-13
工作树：`D:\Code\dsh-toolbox\.worktrees\zed`
分支：`agent/zed-features`
同步基线：`b7e56fb`（与 integration `4954edc` 内容一致）
模型：保持 Claude Code ACP / 自定义 DeepSeek Flash，未切换。

## 阶段提交

| 提交 | 内容 |
| --- | --- |
| `1c86f05` | 第五项 `toolbox_notes`（search/read/create/update/open）、五模块授权/撤回/旧引用、图像 16M/16MiB 上限 |
| `f903f2f` | attachments/toolboxArtifacts 动态到达与卸载清理、图像迟到取消的 committed 结果、路径不冒充图像 |
| 本文所在提交 | A3 handoff |

未合并 main、未推送、未新建分支/工作树；未改 root index/manifest/patch/build、desktop service、bridge、Vue 或 Rust。

## 实际导出接口

`packages/dsh-toolbox/src/agent/index.js`：

```js
export const name = 'dsh-toolbox-agent-tools'
export const inject = ['tools']
export function apply(ctx)
export function createAgentToolsForContext(ctx, imagePublisher?)
```

- `apply` 在 `toolboxDesktop` 可用时激活；嵌套 `ctx.inject(['attachments','toolboxArtifacts'])` 在图像服务到达时启用 capture/snapshot，在任一服务移除时撤回这些 action，不重启桌面运行时。
- 不创建 NativeOwner/headless 内核/第二数据库；所有数据操作只经 `toolboxDesktop.agentCall`。

`packages/dsh-toolbox/src/agent/registry.js`：

```js
export class AgentToolRegistry
export function createAgentToolRegistry({ tools, desktop, imagePublisher })
```

服务依赖仍为 A2 契约：`getAgentAccess({signal})`、`agentCall(method, params, {signal})`、`onAgentAccessChanged(listener)`。注册只使用 native `methods` ∩ 模块 effective（`agent_supported && agent_allowed && agent_effective`）。

## 五模块与动作

| 模块 | Tool | 固定 action |
| --- | --- | --- |
| screenshot | `toolbox_screenshot` | monitors, capture |
| clipboard | `toolbox_clipboard` | list, read_text, write_text |
| screen_ink | `toolbox_screen_ink` | status, start, stop, passthrough, clear, draw, snapshot |
| app_usage | `toolbox_usage` | status, overview, apps, hourly |
| sticky_note | `toolbox_notes` | search, read, create, update, open |

其余五个模块（`media_proc`、`window_pin`、`script_runner`、`translator`、`password_vault`）没有工厂、没有 action、即使伪造 effective 也不会注册。

## 便笺（sticky_note）

- `search`：query ≤200 scalar，limit 默认/最大 20，offset 0..10000；渲染只给 ID/标题/版本/打开状态摘要，不转储正文。
- `read`：id 1..80 scalar；只读取同一 GUI 便笺服务返回的规范记录，不读取旧 headless 数据库。
- `create`：标题 1..500 scalar 且非纯空白；Markdown/LaTeX 正文 ≤256KiB UTF-8，允许 CR/LF/TAB；默认不打开窗口。
- `update`：id、**必填** `expected_updated_at` 安全整数、至少 title 或 content_md 一项；参数原样交给 native 做 CAS，冲突保持 CONFLICT，不覆盖。
- `open`：仅 `{id}`，走 `agent.notes.open` 共享 GUI 服务；不调用通用 `desktop.open_panel`，不创建第二个编辑状态。
- 便笺工具不会调用旧 `toolbox_note_*`、`notes.*` bridge 或任何 headless 入口。
- 渲染：read 显示标题与 Markdown 正文；search 只显示摘要；open 只有 native 确认已打开才显示“已打开”，否则“已请求打开”。

## 取消与未知副作用

- 预取消：不调用 `getAgentAccess`/`agentCall`。
- `agentCall` 返回成功即视为 authoritative；不再因 signal 事后 aborted 把已提交写入改成 AbortError。便笺 update/create、剪贴板 write、注释写动作和 open 都保留真实结果。
- 图像在 capture/snapshot 已返回 descriptor 后若 cancel 到达，返回：
  ```js
  { artifact, image: null, publication: 'cancelled' }
  ```
  render 显示“已捕获，但取消后未发布图像。”，不生成 image block；不自动重试。
- 未知/冲突/不可用错误原样传播；不自动重试；不会把拒绝变成成功空结果。
- 图像正常路径在 artifact 读取前、attachment 写入前、返回前重新检查授权；撤权则不读/不发布。

## 图像与动态服务

- 上限统一为 **16MiB**（16×1024×1024 bytes）和 **16,000,000 pixels**；descriptor 必须是 `image/png`，宽高/字节数需与 transfer 一致。
- `createAgentImagePublisher({ attachments, artifactReader })`：
  - `attachments.saveImage({ data, mediaType:'image/png', name })`，与已安装 attachment contract 一致。
  - `artifactReader.read(descriptor, {signal})` 由 Codex 的 `toolboxArtifacts` 提供；只传 descriptor，不接受路径。
  - 最终 `image` 是 attachment ref；render 返回真实 `{type:'image', attachment}`。
- `apply` 使用嵌套 `ctx.inject(['attachments','toolboxArtifacts'])`：服务到达时动态注册 capture/snapshot；任一服务卸载时 `setImagePublisher(undefined)` 并撤回这些 action。测试用 fake service host 覆盖到达、移除、重新到达。
- 路径字符串或普通 JSON 结果不会生成 image block；测试明确断言。

## SDK / 实际安装证据

- `vendor/harness-reference/@deepseek-ai/dsh-tool-fs/lib/index.js`：
  - `IMAGE_VALUE_SCHEMA` 要求 `attachmentId`/`mediaType`/`bytes`/`width`/`height`。
  - `imageReadContent` 返回 text + `{type:'image', attachment: imageRefFromValue(value.image)}`。
  - `read_image` 调用 `attachments.saveImage({ data, mediaType, name })`。
- 安装物 `app.asar` 的 `@deepseek-ai/dsh-attachment-local/lib/index.js`：`saveImage` 归一化并返回 `{attachmentId,mediaType,width,height,bytes,name?,originalDimensions?}`。
- `@deepseek-ai/dsh-tools` 的 `defineTool` 与真实 output render；本实现仍使用真实 DSL，没有伪造 SDK。
- 未运行真实 attachment backend、artifact transfer 或 native image 方法。

## 测试命令与结果

```powershell
powershell.exe -NoProfile -Command ". 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'; Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed'; node --test packages/dsh-toolbox/tests/agent-*.test.mjs"
```

结果：**38 tests / 38 pass / 0 fail**。

```powershell
node --test packages/dsh-toolbox/tests/*.test.mjs
```

结果：**147 tests / 147 pass / 0 fail**。

覆盖：五模块独立授权/撤回/再授权、旧引用复核、五个人用专属模块无工具、默认无授权、断连、预取消/在途取消、便笺 CAS/冲突/Unicode/字节边界、剪贴板未执行取消、图像 16M/16MiB、动态 attachments/artifact 到达与卸载、图像 late-cancel committed 结果、路径不冒充图像、数据保真。

## Codex 跨界接线请求

1. 为 `packages/dsh-toolbox/src/agent/index.js` 增加包导出/Entry（如 `"./agent"`、`toolbox-agent`），并保持 `inject = ['tools']`；不要恢复旧 `toolbox_note_*`/旧 headless notes 产品入口。
2. 按 A2_CONTRACT 扩展 `toolboxDesktop`：`getAgentAccess`、`agentCall`、`onAgentAccessChanged`；便笺新增 `agent.notes.search/read/create/update/open`，并在 methods 中仅广告真实实现。
3. 提供 `ctx.attachments` 与动态 `toolboxArtifacts.read(descriptor,{signal})`；artifact reader 不得读取 descriptor path。`agent.artifacts.read` 是内部传输方法，不作为模型 action 注册。
4. 便笺必须继续走同一 GUI 内核/同一数据库、mandatory CAS、打开窗口握手与旧 autosave 失效；Node 只调用 `agent.notes.*`，不建第二份存储。
5. 由 Codex 做真实 isolated Electron/模型验收：五模块授权组合、撤权旧调用、便笺冲突/打开窗口、图像真实进入模型、动态服务卸载、迟到取消 committed 结果。

## 未实现/未测

- 未启动真实 GUI、截图、剪贴板、注释、统计、便笺窗口或模型；未安装 Profile、未发热键。
- 未运行真实 native 便笺/图像/artifact transfer；图像与数据方法均为 fixture/fake service 验证。
- 未实现长截图/GIF/OCR；未扩大五模块支持名单。
- 旧便笺/图片工具退役、权限迁移、Vue 双开关和 Rust 实现由 Codex/Cursor/Antigravity 完成。
