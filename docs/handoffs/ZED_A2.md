# Zed A2 交接：四类 Agent 工具与共享图像结果

日期：2026-11-13
工作树：`D:\Code\dsh-toolbox\.worktrees\zed`
分支：`agent/zed-features`
同步基线：`f56247f`（main `eb2ff2b` 的 H1 alpha.6 合并）
模型：保持 Claude Code ACP / 自定义 DeepSeek Flash，未切换。

## 阶段提交

| 提交 | 内容 |
| --- | --- |
| `62f8140` | 授权 snapshot、动态注册/撤回、旧引用复核、四模块 JSON 工具与输入边界 |
| `7960523` | 实际 SDK 图像结果、artifact 传输 seam、截图/注释快照图像发布与测试 |
| 本文所在提交 | handoff |

未合并 main、未推送、未新建分支/工作树；未改 root index/manifest/patch/build、desktop service、bridge、Vue 或 Rust。

## 实际导出接口

### `packages/dsh-toolbox/src/agent/index.js`

```js
export const name = 'dsh-toolbox-agent-tools'
export const inject = ['tools']
export function apply(ctx) // ctx.inject(['toolboxDesktop'], ...)
export function createAgentToolsForContext(ctx)
```

- `apply` 只在 `toolboxDesktop` 服务可用时激活；服务注入 scope 结束时 dispose 全部工具、订阅和注册。
- 不创建 NativeOwner、headless 内核、数据库或第二个进程。

### `packages/dsh-toolbox/src/agent/registry.js`

```js
export class AgentToolRegistry
export function createAgentToolRegistry({ tools, desktop, imagePublisher })
```

服务依赖：

```js
desktop.getAgentAccess({ signal })
desktop.agentCall(method, params, { signal })
desktop.onAgentAccessChanged(listener) // disposer
```

注册规则：

- 仅 `screenshot`、`clipboard`、`screen_ink`、`app_usage` 四个固定模块。
- 模块必须同时满足：静态支持、`agent_allowed`、`agent_effective`；`methods` 还必须实际 advertised。
- action enum 只包含当前 advertised 的方法；未实现/未 advertised 的方法不会进入 enum。
- 图像 action 只有在 `imagePublisher` 可用时注册。
- 授权/启用/方法集合变化时按模块撤回并重建；单模块注册失败不会使其他模块获得权限。
- 旧工具引用每次 execute 都重新调用 `getAgentAccess`；撤权、模块关闭、方法下架分别返回 `AGENT_ACCESS_DENIED`、`MODULE_DISABLED`、`UNSUPPORTED`。
- `NATIVE_UNAVAILABLE`、`UNAVAILABLE`、`OUTCOME_UNKNOWN`、`NATIVE_START_FAILED`、`NATIVE_INTEGRITY`、`DESKTOP_PROTOCOL`、`DESKTOP_CAPABILITIES` 会触发撤回；不自动重试。
- 所有调用传递 `exec.signal`；预取消不调用 service，取消中的 service 结果不会被改写成成功。

### 四个工具

| 工具 | Action（闭集） |
| --- | --- |
| `toolbox_screenshot` | `monitors`, `capture` |
| `toolbox_clipboard` | `list`, `read_text`, `write_text` |
| `toolbox_screen_ink` | `status`, `start`, `stop`, `passthrough`, `clear`, `draw`, `snapshot` |
| `toolbox_usage` | `status`, `overview`, `apps`, `hourly` |

未注册便笺、图片转换/多媒体、翻译、置顶、脚本、密码本或任何通用 `agentCall`/任意 IPC 工具。

### 输入边界

- 截图：`monitor_id` uint32；region 仅 `x/y/width/height`，x/y int32，width/height 正整数；不接收路径。
- 剪贴板：list 默认 20、最大 100；keyword 最多 200 scalar；read_text ID 正整数；write_text 最多 64KiB UTF-8，保留合法原文。
- 注释：最多 128 strokes、8192 points/request；点坐标有限数值；颜色 `#RRGGBB`；宽度 > 0；未知属性拒绝。
- 使用时长：真实 `YYYY-MM-DD`；start ≤ end；最多 31 个含首尾日；apps 默认 20、最大 100。
- 所有 action 拒绝未知字段、`path`、`actor`、`method` 等身份/路由参数。
- 结果经 JSON round-trip 净化；不把 native 额外内部字段透传给模型。

### 图像结果

`packages/dsh-toolbox/src/agent/image.js`：

```js
export function createAgentImagePublisher({ attachments, artifactReader })
```

- `artifactReader` seam：`read(descriptor, { signal })` → `Uint8Array` 或 `{ data: Uint8Array, mediaType: 'image/png' }`。它必须由 Codex 通过受控 artifact 服务解析 native descriptor；不接受路径。
- `attachments` 使用已安装 `ctx.attachments.saveImage({ data, mediaType, name })`。
- native descriptor 预期：`{ artifact_id, mime_type:'image/png', byte_length, width, height }`；Node 校验 16MiB 字节上限、64M 像素上限、PNG 类型、尺寸和 artifact id。
- 在读取 artifact 前、写入 attachment 前、返回模型前各重新检查一次授权；撤权则不读取/不发布。
- 最终规范值为 `{ artifact, image }`；`image` 是 attachment ref。
- `capture`/`snapshot` 的 render 返回：

```js
[
  { type: 'text', text: '截图已附加为图像（WxHpx）' },
  { type: 'image', attachment: imageRef }
]
```

- 只有真实 attachment ref 才生成 image block；路径字符串/未知对象只按 JSON 文本展示，不会冒充模型已看图。

## 已查 SDK 证据

- `vendor/harness-reference/@deepseek-ai/dsh-tool-fs/lib/index.js`
  - `read_image` 的 `IMAGE_VALUE_SCHEMA` 要求 `attachmentId`、`mediaType`（包含 `image/png`）、`bytes`、`width`、`height`。
  - `imageReadContent(value)` 返回 `[{type:'text', text: formatImageReadOutput(...)}, {type:'image', attachment: imageRefFromValue(value.image)}]`。
  - `read_image` 实际调用 `attachments.saveImage({ data, mediaType, name })`。
- 安装物 `app.asar` 的 `@deepseek-ai/dsh-attachment-local/lib/index.js`：`saveImage` 归一化并返回 `{ attachmentId, mediaType, width, height, bytes, name?, originalDimensions? }`；`ctx.attachments` 来自 `@deepseek-ai/dsh-attachment`。
- `@deepseek-ai/dsh-tools` 的 `defineTool`/output render 支持上述 image content block；工具输出 schema 使用 author-only `json`，规范值仍是 JSON-safe。
- 测试 `agent-image.test.mjs` 对上述实际 SDK 文件做了源码形状断言；未运行真实 attachment backend 或真实 native 图像传输。

## 测试命令与结果

```powershell
powershell.exe -NoProfile -Command ". 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'; Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed'; node --test packages/dsh-toolbox/tests/agent-*.test.mjs"
```

结果：**26 tests / 26 pass / 0 fail**。

```powershell
node --test packages/dsh-toolbox/tests/*.test.mjs
```

结果：**135 tests / 135 pass / 0 fail**。

`node --check` 已通过 `src/agent/index.js`、`registry.js`、`image.js`、`common.js`。

覆盖：默认无授权、四模块独立授权/启用、动态撤回/重建、旧引用复核、断连撤回、取消、输入闭集/边界、无六项工具、图像 descriptor 限制、授权复检、图像 block 结构、数据保真、单模块注册失败隔离。

## Codex 跨界接线请求

1. **Entry 导出/装配**：为 `packages/dsh-toolbox/src/agent/index.js` 增加包导出（如 `"./agent": "./lib/agent/index.js"`）并在 A2 Profile patch 插入 Entry；建议 id `toolbox-agent`。现有构建脚本递归复制 `src/` 到 `lib/`，请构建后确认。
2. **toolboxDesktop A2 方法**：实现 `getAgentAccess({signal})`、`agentCall(method, params, {signal})`、`onAgentAccessChanged(listener)`；快照字段按 A2_CONTRACT，native 仍在每次调用执行最终授权检查。
3. **图像传输服务**：提供 `ctx.attachments`（已安装 attachment-local）和 `toolboxArtifacts.read(descriptor,{signal})`。也可提供 `toolboxAgentImages.publish(...)` 覆盖；当前 assembly 已支持该可选服务。
4. **旧工具退役**：主入口目前仍保留旧便笺/图片工具；请按 A2 由 Codex 停用/移除，不要与新 Agent entry 同时暴露旧写路径。
5. **真实验收**：在隔离 Electron/模型中验证四种授权组合、撤回后旧调用、截图/注释图像实际进入模型、剪贴板/统计共享数据、断连与取消。Zed 未做。

## 未实现/未测

- 未启动桌面/GUI、未截图、未读写真实剪贴板、未启动注释或使用统计采样、未安装 Profile、未发送热键。
- 未运行真实 attachment backend、真实 artifact 字节传输或真实 native Agent 方法；图像路径仅用 fixture 验证。
- 未验证真实模型是否实际看到 image block；这需要 Codex 真实验收。
- 未实现长截图/GIF/OCR；未扩大四模块支持名单。
- 未修改旧便笺/图片工具；退役由 Codex 完成。
