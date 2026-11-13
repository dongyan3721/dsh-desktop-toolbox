# Zed / Copilot：beta.5 内嵌主控台

本任务由用户授权，覆盖旧 CodeBuddy/Antigravity 本轮所有权。保留 Zed 中用户已选模型与模式。仅工作于 `D:\Code\dsh-toolbox\.worktrees\antigravity` / `agent/antigravity-bridge`，不要创建/改名分支或工作树。Codex 已将 beta.4 main 合并到该工作树；先读本地 AGENTS、`docs/BETA5_FEEDBACK_PLAN.zh-CN.md`、A2/A3/H1 契约、原 UI 和固定参考指南。

每次命令以该目录为 cwd 并先 dot-source `scripts/Use-ProjectEnvironment.ps1`。Zed 编辑器当前仍附着 main，编辑必须使用本工作树绝对路径。main、其他工作树、C 盘原工程、用户 Profile/数据库只读。无真实 GUI/快捷键/采集测试，无全局安装。SDK/cache junction 只读。

## 目标

侧边栏“工具箱”打开的页面就是可用主控台，不再在 mount 自动 showMain。保留十模块目录、原卡片布局/文案、开启功能与独立 Agent 授权（五支持/五不支持）、加载/禁用/失败状态、一般显示偏好和快捷键设置的可达性。具体功能打开原窗口；提供明确的独立主窗入口，共享同一内核。保留原生启动/托盘/快捷键行为。优先复用原 Vue Dashboard/ModuleManager/PreferencesPanel 及样式，不大范围复制业务逻辑；先核实如何给 Harness Client 打包并报告技术选择，然后交付实现。

允许编辑：`packages/dsh-toolbox-client/client.js`、客户端新源码/前端配置文件（不改根 manifest/lock）；`native/YourAllIn1Helper/src-ui/src/components/Dashboard.vue`、`ModuleManager.vue`、`ProductLogo.vue` 的必要适配；`src-ui/src/api/ipc.ts`、新增 embedded 入口/传输辅助与专属样式；以上相关的新增测试及 `packages/dsh-toolbox/tests/human-entry.client.test.mjs`；`docs/handoffs/ZED_B5_COPILOT.md`。不要编辑 PreferencesPanel.vue / locales（Grok 所有）或 Rust/Host/root scripts。所需 Host/build/资源清单改动交给 Codex，不编造 API/成功值。

## 人用接口草案（Codex 配套；先检查既有服务形状）

沿用 `connection.rpc.call('/api','toolbox-human/console', {action,args}, signal)` 和现有 `{ok,value}` / `{ok:false,error}` envelope；不改变已有 status/showMain/openPanel。

闭集 action：`snapshot {}`、`setModuleEnabled {moduleId,enabled}`、`setAgentAccess {moduleId,allowed}`、`getShortcutPreferences {}`、`checkShortcut {actionId,hotkey:string|null}`、`checkAllShortcuts {}`、`updateShortcut {actionId,hotkey:string|null}`、`updateGeneral {language?,theme?}`、`openManual {}`。打开具体窗口复用现有 openPanel；独立主窗复用 showMain。禁止 action 直接取任意 cmd、额外 actor、任意配置/path、Agent method、密码、脚本执行。特殊原生快捷键录制依赖真实 WebView 焦点，不能在浏览器伪造 Tauri 身份；若内嵌录制需要额外协议，及早报告精确需要，先保留明确进入原生设置的可达路径，勿声称完整录制已通过。

`snapshot` 返回够原 Dashboard 渲染的最小原生投影（target_os、module_catalog、config.general 的 language/theme），不回传完整 KernelStatus/AppConfig 或个人内容。其他返回复用既有 kernel 命令的规范结构。最终 wire 由 Codex 复核，不另起 HTTP daemon/第二内核。若与组件实际需求不符，先报告字段/命令证据。人用设置不要求 Agent 授权；所有 setAgentAccess 必须由点击发起，挂载/重连不得修改授权。

## 验证与交付

聚焦测试覆盖：mount 不调用 showMain；真正显示目录与双开关；禁用/未支持/错误/服务断开；互相独立的开关和不同模块并发操作；卸载取消/清理；显式打开原窗。测试用合成 fixture，区分接线未到位与成功。保留 Grok 对共享 PreferencesPanel 的兼容，不改其文件。

提交只包含本任务路径，不合并 main、不发布/打 tag/安装用户 Profile。handoff 写工作树、commit、改动、接口和打包需求、精确测试命令/结果及未完成项。测试/构建临时文件只能写该工作树 D 盘。完成后在此 Zed thread 回复交付摘要。
