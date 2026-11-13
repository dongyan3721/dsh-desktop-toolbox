# Antigravity A2 交接文档：原界面双开关与共享画布准备

## 1. 基础信息

- **Agent / 模型**: Antigravity / Gemini 3.8 Flash (High)
- **Git 工作树**: `D:\Code\dsh-toolbox\.worktrees\antigravity`
- **当前分支**: `agent/antigravity-bridge`
- **当前基线**: `903a328` (合并验证过的 H1 基线与 A2 契约)
- **第一阶段提交**: `e750d17` (`feat(ui): add dual switches for feature enablement and agent access in ModuleManager`)
- **遵循协议与规范**:
  - `AGENTS.md` (协作总则)
  - `docs/A2_CONTRACT.md` (A2 共享契约：人用启用与 Agent 授权)
  - `docs/AGENT_ACCESS_PLAN.zh-CN.md` (双开关与四模块 Agent 共享计划)
  - `docs/tasks/ANTIGRAVITY_A2.md` (A2 任务书)

---

## 2. 完成工作与实现细节

### 2.1 模块卡片双独立开关 (ModuleManager.vue)
- **保留“开启功能” (Human Feature Enablement)**:
  - 维护原有启用/停用逻辑，调用 `kernel_set_module_enabled({ module_id, enabled })`。
  - 仅在模块 available 且 supported 时可切换，关闭时不丢弃已有配置。
- **新增“允许 Agent 访问” (Agent Access Grant)**:
  - **白名单严格限定**：仅 `screenshot`、`clipboard`、`screen_ink`、`app_usage` 四模块支持 Agent 访问并显示授权开关；其余六项（`sticky_note`、`translator`、`password_vault`、`media_proc`、`script_runner`、`window_pin`）明确展示“不支持 Agent”（`agentUnsupported`），绝不渲染可用交互开关。
  - **即使后端返回伪造 `agent_supported: true`，前端仍依据契约白名单强制拦截**，不向不支持模块暴露授权控件。
  - **四种开关状态组合健全支持**：
    1. 功能开启 × Agent 授权：正常协同运行。
    2. 功能关闭 × Agent 授权：保留授权选择，并在卡片清晰提示 `t('moduleManager.agentIneffectiveNotice')`（“功能未开启，Agent 访问暂不生效”），重新开启功能后即刻恢复。
    3. 功能开启 × Agent 未授权：人用功能正常使用，拒绝 Agent 访问。
    4. 功能关闭 × Agent 未授权：完全关闭。
  - **独立并发与失败回滚**：
    - 人用开关与 Agent 开关分别使用独立的状态变量 `pendingHuman` 和 `pendingAgent`，互不阻塞。
    - 引入单调递增的请求序号（`humanSeq`, `agentSeq`），自动丢弃晚于新操作返回的过期响应。
    - 发生 IPC 异常时自动回滚乐观状态，并在卡片顶部显示 `role="alert"` 错误提示。
    - 接收后端返回的权威完整 catalog 数组更新本地响应式状态，并向外派发 `changed` 事件。

### 2.2 共享范围文案与国际化 (i18n)
- 在 `zh-CN.json`、`en-US.json`、`ja-JP.json` 补充对齐的文案键值：
  - `enableFeature`: 开启功能 / Enable Feature / 機能を有効化
  - `allowAgent`: 允许 Agent 访问 / Allow Agent Access / Agent アクセスを許可
  - `agentSwitchAria`: {name} Agent 访问授权开关 / Agent access grant switch for {name} / {name}の Agent アクセス許可スイッチ
  - `agentUnsupported`: 不支持 Agent / Agent access unsupported / Agent 未対応
  - `agentIneffectiveNotice`: 功能未开启，Agent 访问暂不生效 / Module disabled; Agent access temporarily ineffective / 機能が無効なため、Agent アクセスは現在適用されません
  - `agentScopeTitle`: 共享范围 / Shared Scope / 共有範囲
  - `agentScope.screenshot`: 显示器枚举、截取指定区域与图像产物 / Enumerate displays, capture monitor regions, and generate image artifacts / ディスプレイ列挙、指定領域キャプチャおよび画像アーティファクトの生成
  - `agentScope.clipboard`: 历史记录有限查询、文本读取与显式写入 / Bounded query, read text history, and write plain text to clipboard / 履歴の限定検索、テキスト読み取りおよび明示的書き込み
  - `agentScope.screen_ink`: 同一画布状态、绘制涂鸦、清空与快照 / Inspect canvas state, draw strokes, clear, and capture snapshot on the shared canvas / 同一キャンバスの状態確認、ストローク描画、消去およびスナップショット
  - `agentScope.app_usage`: 统计状态、跨日概览、按应用与小时统计 / Inspect usage status, date range overview, app and hourly breakdown / 統計ステータス、日次概要、アプリ別および時間別統計
- 运行 `i18n.test.mjs`，验证三语言字典 Schema 结构 100% 相同，无空缺键。

### 2.3 无障碍可达性 (A11y) 与样式规范
- 两个开关均符合标准规范：`role="switch"`、`:aria-checked`、`:aria-label`、`:aria-busy`。
- 保留 `:focus-visible` 原生轮廓样式，键盘 `Tab` 可清晰导航聚焦，`Space`/`Enter` 可直接触发切换。
- 不破坏原 macOS 白蓝主题设计与暗色模式适配。

---

## 3. 测试与验证记录

### 3.1 本轮确实执行的命令与结果 (Commands Actually Executed)

1. **依赖环境加载**：
   ```powershell
   Set-Location 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
   . 'D:\Code\dsh-toolbox\.worktrees\antigravity\scripts\Use-ProjectEnvironment.ps1'
   ```

2. **多语言一致性测试**：
   ```powershell
   node --test tests/unit/i18n.test.mjs
   ```
   *结果*：2 测全部通过（Schema 完美一致）。

3. **双开关专项聚焦测试 (tests/unit/module-manager.test.mjs)**：
   ```powershell
   node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/unit/module-manager.test.mjs
   ```
   *覆盖项*：
   - 4 模块支持 Agent 访问，其余 6 模块严格不支持且伪造 flag 仍被拦截。
   - 4 种开启/授权状态组合及暂不生效状态提示。
   - `kernel_set_agent_access` IPC 调用及权威 catalog 状态响应。
   - IPC 失败时乐观更新回滚与错误输出。
   - 双开关独立 pending 与并发非阻塞。
   - 模板 `role="switch"`, `aria-*`, `:focus-visible` 规范。
   *结果*：6 测全部通过。

4. **全量前端单元测试回归**：
   ```powershell
   pnpm test
   ```
   *结果*：12 个测试套件，共 109 项单元测试全部通过（109 pass, 0 fail, 耗时 3.65s）。

5. **TypeScript 类型检查与生产打包构建**：
   ```powershell
   pnpm build
   ```
   *结果*：`vue-tsc --noEmit && vite build` 成功完成，122 modules transformed，0 错误，0 警告（耗时 4.40s）。

### 3.2 可复现命令集 (Reproducible Commands)

```powershell
# 进入前端工程目录并点源环境
Set-Location 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
. 'D:\Code\dsh-toolbox\.worktrees\antigravity\scripts\Use-ProjectEnvironment.ps1'

# 跑全量 109 项单元测试（包含 i18n 与 module-manager 专项）
pnpm test

# 跑生产构建与类型检查
pnpm build
```

---

## 4. 提交物与跨边界接线请求 (Coordination with Cursor & Codex)

### 4.1 已交付修改
- `native/YourAllIn1Helper/src-ui/src/api/ipc.ts`: 扩展 `ModuleStatus` 类型（`agent_supported`, `agent_allowed`, `agent_effective`）。
- `native/YourAllIn1Helper/src-ui/src/components/ModuleManager.vue`: 交付双独立开关与共享范围提示卡片。
- `native/YourAllIn1Helper/src-ui/src/locales/{zh-CN,en-US,ja-JP}.json`: 补充双开关及 4 模块共享范围多语言词条。
- `native/YourAllIn1Helper/src-ui/tests/unit/module-manager.test.mjs`: 新增专项测试套件。
- `native/YourAllIn1Helper/src-ui/package.json`: 挂载新增单测。

### 4.2 结构化画布绘制对接准备 (Coordination for ScreenInkCanvas)
- **现状**：`ScreenInkCanvas.vue` 当前已具备离线画布涂鸦、清空事件（`screen-ink://clear-canvas`）及模式切换（`screen-ink://mode-changed`）通信链路。
- **接线请求**：
  1. 请 Cursor / Codex 在确定原生桌面发出结构化笔画的 Tauri 事件名称（如 `screen-ink://agent-draw`）及载荷规范（`{ strokes: Array<{ points: Array<{ x: number, y: number }>, color: string, width: number }> }`）后，在群板或接线文档中发布。
  2. 收到确定协议后，Antigravity 将立即在 `ScreenInkCanvas.vue` 中接入真实的渲染方法（复用人类绘制同一离屏与屏幕 Canvas），并在绘制完成后通过统一 IPC 或确认事件回复 ack，确保“人和 Agent 看见同一张真实画布，绝不画隐藏假画布”。
