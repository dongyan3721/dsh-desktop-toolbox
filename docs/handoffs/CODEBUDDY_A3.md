# CodeBuddy A3 交接文档：前端五项授权、便笺/画布握手与 Markdown 安全

## 1. 基础信息

- **Agent / 模型**: CodeBuddy（沿用用户已选模型与 Craft 模式，未改全局设置）
- **Git 工作树**: `D:\Code\dsh-toolbox\.worktrees\antigravity`（历史名称，未新建/重命名）
- **分支**: `agent/antigravity-bridge`
- **接手基线**: `a95d1c5`（前轮完整 A2 + A3 契约 + 接手文档，树干净）
- **本轮提交**（每组独立提交，均仅含 `native/YourAllIn1Helper/src-ui/**`）：
  - `3d775c9` `feat(ui): five-module agent grants from native catalog with unified switch race fixes`
  - `4f39e91` `feat(ui): sticky note agent handshake with prepare/apply/release draft protection`
  - `32d4929` `feat(ui): screen ink agent draw/snapshot/clear on the shared canvas with BUSY and coordinate normalization`
  - `28603aa` `feat(ui): sanitize agent-shared note markdown against scripts, event handlers and javascript URLs`
- **遵循协议**: `AGENTS.md`、`docs/tasks/CODEBUDDY_A3.md`、`docs/A3_IMPLEMENTATION_CONTRACT.md`、`docs/A2_CONTRACT.md`、`docs/A2_NEXT_PHASE.zh-CN.md`；原生端对齐以只读方式核对了 `.worktrees/cursor` 的 `agent_ui.rs` / `agent_api.rs` 证据，未修改任何跨界文件。

---

## 2. 完成工作与实现细节

### 2.1 五项 Agent 授权 UI 与双开关竞态修复（`3d775c9`）

`src/components/ModuleManager.vue`：

- **以原生 catalog 为准**：`isAgentSupported = module.agent_supported === true && CONTRACT_AGENT_MODULES.has(id)`。缺字段保守 `false`（不再回退白名单）；契约五项白名单（`screenshot/clipboard/screen_ink/app_usage/sticky_note`）拦截未知 ID 与伪造标记。支持名单共五项，便笺获得独立授权开关与共享范围文案（三语言 `moduleManager.agentScope.sticky_note`）。
- **统一 catalog 版本机制**（两类开关、跨模块共用）：
  - `catalogSeq`：请求发出序号；响应只按 `seq > appliedSeq` 整份应用，反序完成的旧响应整体丢弃（修复"旧功能开关响应覆盖较新授权显示"）。
  - `fullApplySeq`：只在整份权威状态（响应或 props）落地时推进；失败回滚以它判安全——有新整份状态介入则跳过回滚，否则回滚本字段（跨模块乐观更新不互相阻塞）。
  - `changeSeq` + 内容指纹（排序键 `stableStringify`）：已见过的旧 catalog 快照重放（旧 props 响应）直接忽略，未见过的外部 catalog 照常接受。
  - `pendingHuman`/`pendingAgent` 改为按模块 Set 跟踪，跨模块/跨种类并发互不覆盖。
- **保留原键盘/布局**：模板结构、类名、`role="switch"`、aria-*、focus-visible 均不变；仅 `aria-busy`/禁用判断改为 `pending*.has(module.id)`。

### 2.2 便笺 Agent 握手：prepare/apply/release（`4f39e91`）

`src/components/StickyNote.vue`，按 A3 精确 IPC（与 Cursor `agent_ui.rs` 的 `object_exact` 键位完全一致）：

- **ready**：mount 后 `toolbox_agent_ui_ready` args 精确 `{kind:'notes', note_id}`（label 映射 `sticky-note-<id>` 与 `mod-sticky-note::window_label_for` 一致），保存原生下发 `session_id`。
- **result**：`toolbox_agent_ui_result` args 精确 `{kind,request_id,session_id,operation,ok,result,error?}`；`error` 仅回 `BUSY`/`CONFLICT`（`finish()` 只接受这两个字符串），其余失败 `ok:false` 不带 error；result 有界。
- **`sticky://agent-command` 周期**（三个独立 request_id 串行处理）：
  - `prepare`：先冻结输入并清防抖计时器，再 `flushDirtyState()` 非关闭地冲刷草稿（等未完成写入 + 脏编辑落库），ack `{}`。关闭中/停用冲刷中回 `BUSY`。
  - `apply`：校验 `record`（id 匹配、title/content_md 字符串、updated_at 有限数）与 `write_session_id` 后同步进**原窗口**（同一编辑器，不新建）；adopt 新 `write_session_id`（旧 autosave 由原生拒绝；迟到的 `sticky_begin_session` 结果被 `sessionEpoch` 代次守卫拦截，不覆盖新会话）。
  - `release`：一律解冻，从不重放记录。冲突（release 无 apply）与超时都**保留草稿**。
  - **有界恢复/迟到**：每个 request_id 只完成一次（重复/迟到回复不提交）；异 session 载荷不认领；无 release 的握手（见 §4.1）由看门狗解冻（prepare 后 2.5s / apply 后 6s），超时后迟到 apply 回 `ok:false` 且不覆盖草稿。
  - **旧 autosave 失效恢复**：`sticky_save_content` 返回 `applied:false` 时仅在"该会话仍是当前会话"的前提下放弃旧会话、重新握手，草稿保留（不丢用户输入）。
- 与原 `sticky://flush-close/flush-save/flush-cancel` 停用握手共存：Agent 冻结不被 shutdown 取消误解冻，shutdown 冻结不被 Agent release 解冻。

### 2.3 画布 Agent 命令：draw/snapshot/clear/ack（`32d4929`）

`src/components/ScreenInkCanvas.vue`，同协议（`screen-ink://agent-command`，result 键位一致）：

- **ready**：args 精确 `{kind:'ink'}`（无 note_id，符合 `object_exact(["kind","note_id"])` + "ink 不得携带 note_id"）。
- **draw**：笔画经 `historyManager.push()` 进**同一历史/撤销栈**（人用 undo/redo 可撤销 Agent 笔画），渲染后 ack `{applied:n}`（n 为实际应用数，≤ 请求条数；128 条/8192 点上限）。**坐标**：事件 `strokes` 按原生 `logical_strokes` 预转换的逻辑坐标直接使用；若点位落在逻辑画布外（物理桌面坐标、负原点兼容路径），按 `canvas_bounds`（`{x,y,width,height,scale_factor}`）换算为逻辑坐标并同步除以 `scale_factor` 缩放线宽；越界/非数笔画丢弃并如实减少 `applied`。
- **BUSY**：用户指针笔画进行中（`isDrawing`）时 draw/clear 回 `error:'BUSY'`，绝不打断/丢弃用户笔画；snapshot 只读不受限。
- **clear**：走同一 `historyManager.clear()` + 激光点清理 + 重绘 + 工具栏同步，ack `{}`；原生 `screen-ink://clear-canvas` 人用清屏、`mode-changed` 穿透、工具栏 undo/redo 与快捷键行为未动。
- **snapshot**：从历史笔画离屏重绘真实透明画布 PNG（不含激光临时亮点），返回 `{png_base64,width,height}`（base64 无 `data:` 前缀，宽高为离屏物理像素以匹配 PNG IHDR 校验）；base64 超过 16MiB PNG 对应上限则 `ok:false`，不产出无界结果。
- **会话/迟到/卸载**：同便笺（request_id 单次完成、异 session 不认领、unmount 撤销监听）。

### 2.4 Agent Markdown 安全（`28603aa`）

- 新增 `src/utils/safeHtml.ts`（零新依赖，无全局安装）：逐标签词法扫描 + 白名单清洗器。
  - `script/style/iframe/object/embed/form/base/meta/link/template` 等危险容器连同内容整体丢弃；未闭合尾部标签整体丢弃；裸 `<` 转义为文本。
  - 所有 `on*` 事件属性、`srcset`/`xlink:href`/非 `a` 的 `href` 等 URL 面删除；`a[href]` 仅 `http/https/mailto/tel/#`，`img[src]` 仅 `http(s)` 与 `data:image/(png|jpeg|gif|webp);base64`（禁 `data:image/svg+xml`）；属性值先做实体解码再判协议（`&#106;avascript:`、`jav&#x09;ascript:`、`&colon;` 等绕过全部拦截）。
  - `style` 属性白名单化：拒 `url()`/`expression()`/`@import`/反斜杠；`position` 仅允许 relative/absolute/static（防 fixed 遮罩层）。
  - 保留 Markdown 结构标签、KaTeX HTML（span）与 MathML/安全 SVG 子集；`input` 强制 checkbox（GFM 任务列表）。
- `StickyNote.vue` 的 `renderedHtml` 出口（含空提示、marked、katex 失败回退）统一过 `sanitizeHtml`；**未禁用预览**，Markdown/LaTeX 正常渲染。

---

## 3. 测试与验证记录（本轮实际执行）

命令（均先 `. 'D:\Code\dsh-toolbox\.worktrees\antigravity\scripts\Use-ProjectEnvironment.ps1'`，cwd 为本树 `native\YourAllIn1Helper\src-ui`）：

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | **166/166 通过**（0 fail，约 4.1s；含 module-manager 10、sticky-note 32、ink 10、agent-markdown-safety 37 及全部既有回归） |
| `pnpm build`（`vue-tsc --noEmit && vite build`） | 通过，0 类型错误，122 modules，产物在本树 `dist/`（gitignore） |

关键可控 Promise/组件行为测试（真实执行组件逻辑，非模板字符串断言）：

- **module-manager.test.mjs**（10）：五项/缺字段保守 false/伪造拦截；三语言便笺范围文案；四种开关组合；授权 IPC 与权威 catalog；失败回滚；跨种类跨模块独立 pending 与反序完成；旧 props 重载不回退 + 新外部 catalog 接受；整份权威状态落地后跳过回滚（未落地时正常回滚）；a11y。
- **sticky-note.test.mjs**（32 = 24 既有 + 8 新增）：ready 精确 args；prepare 冲刷草稿不关闭 + 冻结 + 单次 ack；apply 换 `write_session_id` + 原窗口同步（此后保存携带新会话）；release 解冻且迟到/重复 apply 不提交；冲突保草稿；看门狗有界恢复 + 迟到 apply 不覆盖草稿；异会话不认领 + 关闭中 BUSY；旧会话被拒后重新握手且草稿不丢。
- **ink.test.mjs**（10 = 2 既有 + 8 新增）：ready 精确 `{kind:'ink'}`；draw 进同一历史/撤销栈 + `{applied}`；物理坐标/线宽按 bounds+DPI 转换；用户作画中 BUSY 不丢笔画；clear 同一历史；snapshot 真实透明 PNG（无 data: 前缀、宽高正确）；异会话/重复不提交；卸载清理。
- **agent-markdown-safety.test.mjs**（37）：29 组恶意合成夹具（script/onerror/javascript 实体与分隔符绕过/iframe/svg onload/@import/position:fixed/css url/form/meta/object/未闭合标签/MathML script/srcset 等）+ 正面保留（链接/图片/任务列表/标题/列表/表格/KaTeX 行内与块级）+ StickyNote renderedHtml 端到端。

**未测项（如实声明）**：未启动 GUI、未做真实截屏/剪贴板/监听/全局热键/真实窗口联动（Codex 独占真实验收）；真实 `sticky-note-<id>` / `screen-ink-canvas` 窗口 label 与 Tauri 事件送达仅经 Cursor 原生源码交叉核对；模型真实读图未验证（属 Zed/Codex 范围）。

---

## 4. 跨边界接口疑问与接线请求（请 Cursor/Codex 裁决，未擅改协议/跨界文件）

### 4.1 `notes_read` 成功路径缺少 `release`（证据见 Cursor 树）

- **证据**：`.worktrees/cursor/native/YourAllIn1Helper/src-tauri/src/agent_api.rs` `notes_read`（约 582-622 行）在 `note.is_open` 时调用 `sync_open_editor`（即 `prepare` roundtrip，约 862-888 行）后直接读库返回，成功路径**没有** `release_note`；`sync_open_editor` 仅在错误路径 release。A3 契约要求 "Release always unfreezes corresponding request on success/error/cancel/timeout"。
- **前端现状**：按契约 prepare 冻结；因 read 无 release，前端以看门狗（prepare 后 2.5s）有界解冻。read 频繁时打开中的编辑器会周期性短暂冻结。
- **请求**：请 Cursor 在 `notes_read` 冲刷完成后补发 `release`（或明确 read 只需 flush 不需 freeze 的协议语义）；若补发，前端看门狗仅为兜底，行为兼容。

### 4.2 画布笔画坐标/线宽：事件载荷已是逻辑坐标（与契约措辞存在歧义）

- **证据**：`agent_api.rs` `logical_strokes`（约 999-1024 行）在 emit 前已把物理点转为画布逻辑坐标（`canvas_local`，约 987-997 行），且 `canvas_ack_transforms_points_and_late_replies_do_not_apply` 测试断言事件载荷点为转换后值（输入物理 `(4,6)` → 载荷 `(2,3)`）。契约表述 "Coordinates ... are virtual desktop PHYSICAL pixels ... transformed to the original canvas's logical drawing coordinates using native actual bounds/scale" 未指明转换发生在哪端；"negative origins valid" 更像描述 pipe 输入。
- **前端现状**：按已交付原生语义消费——载荷点在逻辑画布内则直接使用；若点位在逻辑画布外（假想的未预转换载荷，含负原点）则按 `canvas_bounds` 转换并把 `width` 除以 `scale_factor`。两条路径都有测试。
- **线宽歧义**：`logical_strokes` 对 `width` 原样透传；A2 写 "validates finite physical-screen coordinates/width"。若 width 语义是物理像素，请 Cursor 在 `logical_strokes` 中一并除以 `scale_factor`（或明示 width 即逻辑像素）；前端当前按逻辑像素渲染。
- **请求**：请确认事件 `strokes` 终态是逻辑坐标 + 逻辑线宽，便于前端删除兼容分支。

### 4.3 `pointer_active` 原生预检无生产上报方

- **证据**：`agent_ui.rs` 的 `set_pointer_active` 在 `agent_api.rs::ink_draw` 中做 BUSY 预检，但 src-tauri 中无任何生产调用方（仅测试调用）；`ipc/screen_ink.rs` 的 `ink_*` 命令清单无指针状态上报。
- **前端现状**：按契约在 ack 通道回 `error:'BUSY'`（`finish()` 允许值），用户指针笔画进行中时 draw/clear 一律 BUSY——行为上已满足"不丢用户笔画"。原生预检暂为死代码。
- **请求**：请 Cursor 补一个上报接口（如 `ink_set_pointer_active`）或明示仅靠 UI ack。

### 4.4 已按约束对齐的细节（无需动作，仅供核对）

- `toolbox_agent_ui_ready` / `toolbox_agent_ui_result` 经 `invokeIpc`（`ipc` 信封）调用，与 `tauri_app.rs` 的 `request.cmd` 分支一致；result 键位恰为 `{kind,request_id,session_id,operation,ok,result,error?}`，无多余键。
- 便笺三操作 ack 的 `result` 为 `{}`（原生仅消费 `ack.ok`）；ink draw `{applied}`、clear `{}`、snapshot `{png_base64,width,height}` 与 `ink_draw`/`ink_snapshot` 消费字段一致。
- snapshot 的 `png_base64` 为标准 base64（无 data: 前缀），因为 `ink_snapshot` 直接 `STANDARD.decode`。

---

## 5. 变更文件清单（均在本工作树 `native/YourAllIn1Helper/src-ui/`）

| 文件 | 提交 | 变更 |
| --- | --- | --- |
| `src/components/ModuleManager.vue` | `3d775c9` | 五项支持判定、统一 catalog 版本机制、按模块 pending、条件回滚 |
| `src/locales/{zh-CN,en-US,ja-JP}.json` | `3d775c9` | `moduleManager.agentScope.sticky_note` 三语言 |
| `tests/unit/module-manager.test.mjs` | `3d775c9` | 重写：竞态/旧 props/回滚可控测试 |
| `src/components/StickyNote.vue` | `4f39e91`,`28603aa` | Agent 握手（ready/result/prepare/apply/release、会话代次、看门狗、旧会话恢复）；渲染出口安全清洗 |
| `tests/unit/sticky-note.test.mjs` | `4f39e91` | 机具扩展 + 8 项握手测试；既有断言过滤握手 IPC |
| `src/components/ScreenInkCanvas.vue` | `32d4929` | Agent draw/snapshot/clear、坐标归一、BUSY、有界结果、会话清理 |
| `tests/unit/ink.test.mjs` | `32d4929` | 组件级机具 + 8 项画布握手测试 |
| `src/utils/safeHtml.ts` | `28603aa` | 新增：零依赖白名单 HTML 清洗器 |
| `tests/unit/agent-markdown-safety.test.mjs` | `28603aa` | 新增：恶意合成内容 37 项测试 |
| `package.json` | `28603aa` | 测试脚本挂载新安全测试 |

未触碰：任何 Rust/Node 工具/根 Entry/协议/共享契约/其他 agent 工作树；无全局安装、无新 npm 依赖、无真实 GUI/截屏/剪贴板/监听/热键/Profile 操作；构建与临时产物全在本树。
