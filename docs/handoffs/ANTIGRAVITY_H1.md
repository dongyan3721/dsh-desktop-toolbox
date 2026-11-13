# Antigravity H0/H1 交接文档：原 Vue 功能/偏好界面与对等清单

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

## 2. 完成工作与验证结论

### 2.1 依赖安装与独立性
- 严格遵循只在嵌套工作树 `native/YourAllIn1Helper/src-ui` 下安装前端依赖，严禁触碰根目录只读 SDK。
- 执行命令：
  ```powershell
  Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
  . ..\..\..\scripts\Use-ProjectEnvironment.ps1
  pnpm install --frozen-lockfile --ignore-workspace
  ```
- 结果：通过 D 盘缓存直接复用 61 个离线依赖包，7.3 秒完成，未向外网发送不必要下载，未改动根配置。

### 2.2 现有界面与代码审计结论
- **代码无需修改，直接复用**：
  - 经全面审查 `App.vue`、`Dashboard.vue`、`PreferencesPanel.vue`、`FeaturePanel.vue`、`StickyNote.vue` 及工具函数，所有组件均使用标准 Tauri 2.x `invoke` 和 `event.listen` 接口通信，不存在特定旧环境假设。
  - 快捷键录入框（`PreferencesPanel.vue`）已完备实现：物理键提取、输入法/修饰键/长按重复拦截、`Tab` 键保留导航、`Escape` 键放弃录制、冲突预检（`kernel_check_shortcut`）与阻断、恢复默认与清除（`null`）。
  - 便笺面板（`StickyNote.vue`）已完备实现：多颜色主题、透明度无极调节、置顶状态绑定、400ms 存盘防抖、关停前强制冲刷（`sticky://flush_save` 握手）及 Markdown 格式化导出。
  - 窗口路由（`App.vue`）支持通过 `?window=<type>&mode=native&id=<id>` 动态挂载全部 10 个独立功能视图或主控制台。
  - 严格不添加任何伪造 HTTP 回退或 Agent 暴露接口，原 UI 零破坏。

### 2.3 产物对等文档交付
- 创建并交付 [docs/HUMAN_UI_PARITY.zh-CN.md](file:///D:/Code/dsh-toolbox/.worktrees/antigravity/docs/HUMAN_UI_PARITY.zh-CN.md)。
- 详列全部 10 个模块的“原组件/路由/IPC/事件/自动化测试/真实 GUI 状态”矩阵，并清晰列出 14 个全局动作及全部局部键盘控制（Tab、Escape、方向键微调、上下键切候选、Enter 粘贴等）。
- 严格区分三种状态：`source-present`、`automated-tested` 与 `real-GUI-unverified`（物理按键与真实窗口待 Codex 验收）。

---

## 3. 测试命令与确切输出

在 `native/YourAllIn1Helper/src-ui` 目录下执行：

### 3.1 前端单元测试 (103 测全部通过)
```powershell
Set-Location -LiteralPath 'D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui'
. ..\..\..\scripts\Use-ProjectEnvironment.ps1
pnpm test
```
**实际结果**：
```text
✔ recent range is recalculated from the current local date across midnight (10.5479ms)
✔ seven and thirty day ranges are inclusive of the current day (1.8845ms)
✔ date helpers keep leap days and year boundaries local (1.9784ms)
✔ hidden overlay presents after writing pixels without waiting for an animation frame (2821.6738ms)
...
✔ ordinary debounce saves the fictional note when its timer fires (1707.3099ms)
✔ closing while a save is pending persists edits before destroying the WebView (641.0853ms)
✔ shortcut recorder uses physical letter keys and rejects IME, repeats, modifiers and bare typing (1057.0382ms)
✔ shortcut save failure preserves old binding and recorded draft; reset uses explicit null (738.2535ms)
✔ conflict preflight blocks persistence and preserves the draft and active binding (184.4823ms)
...
✔ window drag handles title descendants but preserves controls and non-left clicks (5.5252ms)
ℹ tests 103
ℹ suites 0
ℹ pass 103
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10459.8753
```

### 3.2 生产构建与类型检查 (vue-tsc + vite build 0 错误)
```powershell
pnpm build
```
**实际结果**：
```text
> all-in-one-ui@0.1.3-beta build D:\Code\dsh-toolbox\.worktrees\antigravity\native\YourAllIn1Helper\src-ui
> vue-tsc --noEmit && vite build

vite v5.4.8 building for production...
transforming...
✓ 122 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                         0.47 kB │ gzip:  0.32 kB
...
dist/assets/index-CzrCLGHS.js                         208.46 kB │ gzip: 90.89 kB
dist/assets/StickyNote-B_QFIRAt.js                    304.68 kB │ gzip: 92.79 kB
✓ built in 14.43s
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
   - 关停便笺或原生宿主退出前，先向便笺窗口发射 `'sticky://flush_save'`，前端在完成防抖存盘后会向后端发送 `sticky_flush_ack`，随后再销毁窗口。
