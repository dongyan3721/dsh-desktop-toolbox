# Zed 交接：便笺与图片工具适配

日期：2026-11-12（Asia/Shanghai 工作时段）
工作树：`D:\Code\dsh-toolbox\.worktrees\zed`
分支：`agent/zed-features`
模型：保持用户当前自定义 DeepSeek Flash（Claude Agent ACP），未切换模型。

## 交付内容

变更/新增文件（均在分配范围内）：

| 文件 | 说明 | SHA-256 |
| --- | --- | --- |
| `packages/dsh-toolbox/src/features/notes.js` | `createNoteTools(bridge)`，三个便笺工具 | `c1d6942c3aa46121a7977de2f26f18f750311872f23f18ad46bd3ca46973895c` |
| `packages/dsh-toolbox/src/features/images.js` | `createImageTools(bridge, { authorizePaths })` | `3fb37332b486f4e32fb4e99460e82227aa749b9baf8961a10b932ac8c8539fb9` |
| `packages/dsh-toolbox/tests/features.notes.test.mjs` | 便笺工具 16 项测试 | `b9644f8a71d43e7ddf452701ef18b73f3cb35d755c802e5aff7e3f8ed1c9e7c0` |
| `packages/dsh-toolbox/tests/features.images.test.mjs` | 图片工具 15 项测试 | `7efd2508866a832def0e6b3e7d18384daa4094298b1c32a7d5a76301f850eba8` |
| `docs/handoffs/ZED.md` | 本交接 | — |

未修改插件入口 `src/index.js`、根 manifest/锁文件、bridge、原生源码、共享协议或其他 agent 文件。

## 实际 API

```js
import { createNoteTools } from './features/notes.js'
import { createImageTools } from './features/images.js'

const noteTools = createNoteTools(bridge)                 // ToolDefinition[]
const imageTools = createImageTools(bridge, { authorizePaths }) // ToolDefinition[]
```

- `bridge` 必须提供 `request(method, params, { signal } = {})`，与 `BRIDGE_PROTOCOL.md` 的 Node 客户端契约一致。缺失或非法 bridge 在工厂调用时抛 `TypeError`。
- 工厂只返回 `defineTool()` 定义数组，不注册到任何全局 context。
- 所有 `execute(args, exec)` 都先 `exec.signal.throwIfAborted()`，并把同一个 `signal` 传给 bridge；未提供 `exec.signal` 时抛 `TypeError`。
- `authorizePaths` 契约：`async ({ inputPath, outputPath, format, signal }) => boolean`。只有严格返回 `true` 才允许继续；缺失、非函数、`false`、`undefined` 或其他真值都按拒绝处理（fail closed）；回调抛错原样传播。回调在 bridge 请求之前执行。
- 返回值为规范化后的普通 JSON 对象（新对象，只含协议字段），不会把 bridge 返回的额外内部字段透传给模型。

## 协议映射

| 工具 | 宿主方法 | 实际发送参数 | 返回/展示 |
| --- | --- | --- | --- |
| `toolbox_note_create` | `notes.create` | `{ title, content_md, open: false }` | `StickyNoteRecord` |
| `toolbox_note_search` | `notes.search` | `{ query, limit, offset }` | `{ items: StickyNoteRecord[], total }` |
| `toolbox_note_update` | `notes.update` | `{ id, title?, content_md?, expected_updated_at? }` | `StickyNoteRecord` |
| `toolbox_image_convert` | `media.convert_image` | `{ inputPath, outputPath, format }` | `{ outputPath, format }` |

便笺第一版不打开原生窗口：`toolbox_note_create` 的 `open` 参数为可选 `boolean` 且 `const: false`；省略或传 `false` 都向协议发送 `open: false`，传 `true` 被 Schema/领域校验拒绝。

### 输入校验

- 便笺标题、便笺 ID、搜索词：非空字符串（保留原始空格，不 trim 后发送）；正文允许空字符串。
- 搜索：`limit` 整数 1..100，默认 20；`offset` 非负安全整数，默认 0。
- 更新：`title`/`content_md` 至少提供一个；`expected_updated_at` 非负安全整数。
- 图片：`inputPath`/`outputPath` 非空字符串且不含 NUL；`format` 只接受 `png|jpeg|webp|bmp|ico`。
- 所有工具拒绝未知参数，避免模型参数被静默忽略。
- SDK 参数 Schema 的隐式根对象无法声明 `additionalProperties:false`，因此未知参数在 `execute()` 内显式拒绝；所有对象型输出 Schema 均显式设置 `additionalProperties:false`，`StickyNoteRecord` 全部字段为 required，`pos_x`/`pos_y` 使用 `integer|null` 的 `oneOf`。

### 输出与渲染

- 便笺记录字段：`id, title, content_md, theme_color, opacity, pos_x, pos_y, width, height, is_pinned, is_open, updated_at`。
- `pos_x`/`pos_y` 允许负安全整数（多显示器坐标），宽高与时间戳要求非负安全整数。
- `render()` 只基于传入的 args/value 生成文本，不读文件、不访问时钟/随机数、不调用 bridge；搜索渲染只显示标题、ID、更新时间与总数，不转储正文。
- 未添加 `presentCall()`/`presentResult()`：安装的 SDK 只说明意图类别，没有可核对的完整对象形状示例；按“不得凭空发明 API”的约束，本轮只交付已核实的纯 `output.render`。

## 测试命令与结果

命令（工作树为当前目录；先 dot-source 项目环境）：

```powershell
powershell.exe -NoProfile -Command ". 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'; Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed'; node --test packages/dsh-toolbox/tests/features*.test.mjs"
```

实际结果：`tests 31`、`pass 31`、`fail 0`、`cancelled 0`、`skipped 0`（Node 24.x，2026-11-12）。

覆盖点：

- 三个便笺工具和图片工具的实际 `defineTool` 定义及输出 Schema。
- 四个方法与固定协议的字段映射（含 `open:false`、默认分页、可选更新时间）。
- Schema 拒绝缺字段/类型错误/枚举错误；领域校验拒绝空标题、越界分页、未知参数。
- 便笺 `CONFLICT`、图片 `CONFLICT` 和授权回调异常的原样传播。
- 预取消与请求中取消：`signal` 透传，bridge 未被调用或收到同一 signal。
- 图片缺 authorizer、authorizer 非函数、返回非 `true`、抛错：均不调用 bridge。
- 无效 native 返回值转为 `INTERNAL`，错误消息不包含返回内容。
- 渲染不调用 bridge/authorizer，不执行 IO。

## 未做/未验证

- 未连接真实 native bridge：Cursor 的原生服务与 Antigravity 的 Node 客户端仍在并行开发；本轮 bridge 均为测试内 fake，未声称端到端成功。
- 未在 Codex 的插件入口注册这些工具，也未运行真实 Cordis Loader 组合；注册与生命周期由 Codex 集成。
- 未做真实图片转换、真实便笺持久化、重启、UI/窗口、多显示器或硬件测试。
- 未实现便笺窗口打开、图片覆盖、后台任务/进度；协议第一版也未提供这些能力。
- 未运行构建脚本；已核对 `scripts/build.mjs` 会递归复制 `src/` 到 `lib/`，因此 `features/` 会随现有构建进入发布 JS。该脚本属 Codex 所有，未修改。

## 给 Codex 的集成请求

1. 仅当 bridge client 已连接时注册这 4 个工具；无 bridge 时不注册。
2. 从 Harness 文件/工作区策略实现 `authorizePaths`，并在其中完成 junction/symlink 感知的路径校验；必须显式返回 `true` 才放行。
3. 保持调用方 `exec.signal` 一路传到 `bridge.request`；不要吞掉带稳定 `.code` 的 bridge 错误。
4. 若需要 Host 卡片，请先提供已核实的 `presentCall()`/`presentResult()` 意图形状，再扩展；当前渲染已是纯函数。
5. 构建时确认 `lib/features/*.js` 随 tarball 发布（现有 `files` 已包含 `lib`）。
