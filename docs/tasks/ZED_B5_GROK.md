# Zed / Grok Build：beta.5 快捷键冲突诊断

使用用户已经选择的 Zed Grok Build 模式/模型。只在 `D:\Code\dsh-toolbox\.worktrees\cursor` / `agent/cursor-native` 工作，历史目录名不表示运行 Cursor。已由 Codex 同步 beta.4。读 AGENTS、BETA5_FEEDBACK_PLAN、H1/A2/A3 契约及参考指南。每次命令以本工作树为 cwd，先 dot-source `scripts/Use-ProjectEnvironment.ps1`；Zed 编辑器附着 main 时必须使用本工作树绝对编辑路径。不创建工作树/分支，不改其他 agent 文件、根 manifest/lock、环境或全局工具。D cache/SDK 只读。

## 目标和边界

用户希望知道哪个程序占用热键。先核实 Windows 公开 API 实际可提供什么，按证据实现：内部冲突精确指出模块/动作/脚本；系统失败展示组合键、失败动作、错误分类和可展开原始详情；外部占用 PID/程序只有可靠来源才标“已确认”。`RegisterHotKey`/GetLastError 不直接提供占用者，`WM_GETHOTKEY` 不代表所有全局注册；不得用前台进程、进程列表或常见软件猜测冒充确定结果。若无可靠办法，明确“系统未提供占用程序信息”，提供相关软件设置、逐个退出后重检、换组合键等可操作排查。常见软件提示只能标为排查建议。

不加载驱动、进程注入、暴力模拟热键、不终止任何程序、不撤销外部绑定。保留现有 non-destructive probe、串行 gate、注册失败回滚。区分内部冲突/非法组合/系统保留/系统不允许/探测失败/未检测；仅系统错误 1409 等证据才可认定注册占用，不把所有 register 错误说成另一应用占用。

允许编辑：`native/YourAllIn1Helper/src-tauri/src/shortcut_conflicts.rs`、`preferences.rs` 的必要诊断变化、新增 `shortcut_diagnostics.rs`；`src-ui/src/components/PreferencesPanel.vue`、新增 `src-ui/src/utils/shortcutDiagnostics.ts`（包括专属 wire 类型）；`src-ui/src/locales/{zh-CN,en-US,ja-JP}.json`；对应聚焦测试、handoff `docs/handoffs/ZED_B5_GROK.md`。不写 tauri_app.rs/lib.rs（需要接线时提供确切 patch 建议由 Codex 接入）；不写 ipc.ts（Copilot 所有，类型新增可暂放专属 helper），不写 Dashboard/ModuleManager 或 Node Host。

响应保留原 `status/conflicts/detail` 兼容，可新增可选 `diagnosis`（category、os_error_code?、owner?、guidance）。新增字段的实际精确定义和 code 证据写 handoff，未知字段不伪造。`owner` 只有 confirmed 证据才有值，未知 null；不要在日志收集私有窗口标题、命令行或用户路径。UI 不再只在 title 悬停显示错误；键盘用户能展开详情和重新检测。不要额外“自动修复”改键或自动关闭软件。Copilot 正在复用设置页，保持非 Tauri 渲染可用，原生专属能力需真实可用性提示。

用合成 backend/fixture 测覆盖分类、内部动作名称、未知占用者、无虚假归因、清理失败、重检和显示详情/可达性。不能运行真实 OS 注册/GUI/全局按键，留给 Codex 独占验收。只提交任务路径，handoff 写 commit、精确命令/结果、API 证据/限制和接线需要，不发布/tag/安装用户 Profile。
