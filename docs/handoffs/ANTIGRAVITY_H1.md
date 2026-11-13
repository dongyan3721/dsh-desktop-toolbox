# Antigravity H0/H1 交接文档：原 Vue 功能/偏好界面与对等清单 (修订版)

## 1. 基础信息

- **Agent / 模型**: Antigravity / Gemini 3.8 Flash (High)
- **Git 工作树**: `D:\Code\dsh-toolbox\.worktrees\antigravity`
- **当前分支**: `agent/antigravity-bridge`
- **上游基线**: `ba6c700` (Codex 同步的最新 main)
- **遵循协议与规范**:
  - `docs/HUMAN_FIRST_PLAN.zh-CN.md` (人用优先实施计划)
  - `docs/H1_CONTRACT.md` (H0/H1 桌面集成契约)
  - `docs/tasks/ANTIGRAVITY_H1.md` (H1 任务书)

---

## 2. 完成工作与审计结论

### 2.1 依赖安装与独立性
- 严格遵循只在嵌套工作树 `native/YourAllIn1Helper/src-ui` 下安装前端依赖，严禁触碰根目录只读 SDK。
- 依赖安装使用工作树根绝对路径点源环境脚本：
  ```powershell
  Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
  . 'D:\Code\dsh-toolbox\.worktrees\antigravity\scripts\Use-ProjectEnvironment.ps1'
  pnpm install --frozen-lockfile --ignore-workspace
  ```
- 结果：通过 D 盘离线缓存直接复用依赖包（7.3 秒完成），未向外网发送不必要下载，未改动根配置。

### 2.2 现有界面与代码审计结论
- **代码无需强行修改，保持原汁原味与高内聚**：
  - 经全面审查 `App.vue`、`Dashboard.vue`、`PreferencesPanel.vue`、`FeaturePanel.vue`、`StickyNote.vue` 及各组件源码，所有组件均使用标准 Tauri 2.x `invoke` 和 `event.listen` 通信，生命周期钩子规范完整，无旧环境硬编码假设。
  - **快捷键录入框 (`PreferencesPanel.vue`)**：已完备实现物理按键提取、输入法合成态 (`isComposing`) 屏蔽、修饰键与按键连发 (`repeat`) 过滤、`Tab` 键保留原生焦点导航、`Escape` 键放弃录制、冲突预检 (`kernel_check_shortcut`) 拦截阻断、恢复默认与清除 (`null`)。
  - **便笺面板 (`StickyNote.vue`)**：已完备实现便笺主题、透明度无极滑动、置顶窗口绑定、400ms 存盘防抖、关停前冲刷 (`sticky://flush-save` 配合 `sticky_flush_result`) 及 Markdown 导出。
  - **窗口路由 (`App.vue`)**：通过 `?window=<type>&mode=native&id=<id>` 动态挂载全部 10 个独立功能视图或主控制台，无需重构或额外适配。
  - 严格不新增伪造 HTTP 回退或非必要的 Agent 暴露接口。

### 2.3 产物对等文档交付
- 更新并纠正交付 [docs/HUMAN_UI_PARITY.zh-CN.md](file:///D:/Code/dsh-toolbox/.worktrees/antigravity/docs/HUMAN_UI_PARITY.zh-CN.md)。
- **核心纠正与核实点**：
  1. **修正长截图动作 ID**：核对 Rust `crates/mod-screenshot/src/lib.rs` 与前端 API，滚动长截图动作为 `screenshot:scroll`（非 `screenshot:long_capture`）。
  2. **逐项核实 Tauri Event 命名（连字符）**：核对 `src-tauri` 与 Vue 源码，修正 `media://job-progress`、`sticky://flush-close`、`sticky://flush-save`、`sticky://flush-cancel`、`screen-ink://clear-canvas`、`screen-ink://mode-changed`、`translator://stream-chunk`、`translator://selection-ready` 等所有事件名称（全部使用连字符 `-`，非下划线 `_`）。
  3. **架构明确为主控台 + 十大模块**：主控台（`Dashboard.vue`、`PreferencesPanel.vue`、`ModuleManager.vue`，归属于 `mod-desktop`）作为宿主管理，十个功能模块为 `01 mod-screenshot`、`02 mod-clipboard`、`03 mod-screen-ink`、`04 mod-sticky-note`、`05 mod-translator`、`06 mod-password-vault`、`07 mod-media-proc`、`08 mod-script-runner`、`09 mod-window-pin`、`10 mod-app-usage`。
  4. **诚实验证测试覆盖范围**：
     - `launcher.test.mjs`（9 测）：仅测试快捷键录制格式/偏好防抖/冲突预检，以及窗口置顶候选列表属性合并 Fake。绝不宣称动态脚本热键或底层置顶已测。
     - `mod-script-runner` 与 `mod-media-proc`：在前端无直接单测文件（标注为“无直接前端单测”，底层逻辑由 Rust 后端覆盖）。
     - `mod-window-pin`：仅在 `launcher.test.mjs` 有 1 项候选列表属性合并单测，拾取与底层置顶无直接前端单测。
  5. **密码本安全边界**：密码本涉及 Master Password 主密码设置/解锁、Windows Hello / 生体认证、密码复制与查看，按安全与规范严格标记为**用户本人手工操作验收 (Human Manual Acceptance Only)**，绝不委托给任何 AI Agent 自动化执行。

---

## 3. 命令执行记录

### 3.1 本轮确实执行的命令与结果 (Commands Actually Executed in This Session)

1. **依赖独立安装**：
   ```powershell
   Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
   . 'D:\Code\dsh-toolbox\.worktrees\antigravity\scripts\Use-ProjectEnvironment.ps1'
   pnpm install --frozen-lockfile --ignore-workspace
   ```
   *结果*：61 个包离线安装，0 漏洞，耗时 7.3s。

2. **前端无头单元测试**：
   ```powershell
   Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
   pnpm test
   ```
   *结果*：11 个测试套件，共 103 项前端单元测试全部通过（103 pass, 0 fail, 耗时 4.4s）。

3. **前端类型检查与生产构建**：
   ```powershell
   Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
   pnpm build
   ```
   *结果*：`vue-tsc --noEmit && vite build` 成功，122 modules transformed，0 错误，0 警告。

### 3.2 可复现验证命令集 (Reproducible Verification Commands)

```powershell
# 1. 切换到工作树前端目录并加载环境
Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
. 'D:\Code\dsh-toolbox\.worktrees\antigravity\scripts\Use-ProjectEnvironment.ps1'

# 2. 运行 103 项前端无头单元测试
pnpm test

# 3. 运行类型检查与生产打包
pnpm build
```

---

## 4. 提交给 Codex 的跨边界原生集成请求 (Native Integration Requests)

1. **多窗口 URL 格式**:
   - 原生端创建子窗口时，请确保加载 URL 携带原参数：`?window=<type>&mode=native&id=<id>`。
2. **快捷键录制事件**:
   - 在录制状态（前端调用 `kernel_set_shortcut_recording: true`）期间，原生端捕获到全局按键时请发射 `'shortcut://recorded'` 事件，载荷为 `{ hotkey: string }`。
3. **主界面导航事件**:
   - 外部调用呼出特定功能或偏好设置时，可向主界面发射 `'dashboard://navigate'`，载荷为目标路由字符串（如 `'preferences'`）。
4. **便笺退出前冲刷握手**:
   - 关停便笺或原生宿主退出前，先向便笺窗口发射 `'sticky://flush-save'`（带 `request_id`），前端在完成防抖存盘后会向后端发送 `sticky_flush_result`，随后再销毁窗口。
5. **密码本人工验收**:
   - 密码本 Master Password 与生物识别由用户在真实桌面手工体验验收，请 Codex 在自动化 GUI 测试集中排除密码本敏感凭据写入/解锁操作。
