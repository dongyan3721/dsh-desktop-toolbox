# Zed / Claude Code：beta.5 剪贴板来源和旧便笺清理

保留当前 Zed Claude Code ACP 与用户选定模型。只工作于 `D:\Code\dsh-toolbox\.worktrees\zed` / `agent/zed-features`，已由 Codex 同步 beta.4。先读 AGENTS、BETA5_FEEDBACK_PLAN、A2/A3/H1 契约及参考指南。每次命令在本工作树 cwd 先 dot-source `scripts/Use-ProjectEnvironment.ps1`。Zed 编辑器仍附着 main，编辑必须用本工作树绝对路径。D cache/SDK 只读，不安装全局工具、不改原工程或用户 Profile/私有 DB，不新建分支/工作树。

## A. 系统采集补来源应用

`src-tauri/src/tauri_app.rs` 的 start_clipboard_listener 文本和 RGBA 两条采集路径硬编码 None；存储已支持 source_app_name，不更改 DB schema、不回填旧数据。实现 Windows 剪贴板所有者窗口→PID→进程/应用名的 best-effort 来源，并用于文本/图片。优先用 GetClipboardOwner，不把 GetOpenClipboardWindow（当前读取者）/前台应用当来源；来源不能证明时保留 None。GetClipboardSequenceNumber/所有者读取前后需考虑变化，避免内容和来源错配，延迟渲染/owner null/进程退出或访问拒绝都安全降级。

复用已有 OS HAL 窗口/进程 helper 或增加窄适配，不扫描所有进程/收集命令行/窗口标题/完整用户路径。捕获内容本身只按原功能写存储，不进诊断日志。保留 clipboard enabled 与敏感标记/屏蔽租约，保留去重/切换启停。检查本程序/Agent 写入路径，避免系统监听又覆盖显式来源；若现有 Agent 来源已有明确语义则保留，不用猜测进程覆盖它。macOS 未实现来源时如实返回未知、编译 cfg 隔离。

允许编辑：`native/YourAllIn1Helper/src-tauri/src/tauri_app.rs` **仅 start_clipboard_listener 段**；新增 `src-tauri/src/clipboard_source.rs` 或 `crates/os-hal/src` 的窄 helper/所需导出及其测试；`crates/mod-clipboard` 与来源相关的聚焦测试。需要 src-tauri/lib.rs 注册新模块或 Cargo features 时，给 Codex 精确接线请求，不抢改根/共享 manifest。Grok 不改 tauri_app.rs；禁止格式化整个该文件造成无关 diff。

聚焦测试至少涵盖文本/图片入库和按来源搜索、owner 未知/进程退出/权限失败、序列变化不误归因、敏感标记/停用继续拒绝、重复内容的来源语义。本轮只用 fake backend 与合成数据，不操作真实系统剪贴板或打开 GUI。

## B. 旧便笺生产代码退役

用户报告 `packages/dsh-toolbox/src/features/notes.js` 是旧实现。核对后生产确实只注册 `src/agent/notes.js` 的 toolbox_notes；但历史 fixture `tests/fixtures/legacy-headless-plugin.mjs` 和 `packages/dsh-toolbox/tests/features.notes.test.mjs` 仍 import 旧实现。不要直接删除后留下坏测试。将有用的旧实现移动为明确 test-only fixture（例如 `tests/fixtures/legacy-notes-tools.mjs`），修正 helper 相对导入与 fixture/测试引用，从生产 src 删除。旧历史 release tarball/docs 不动；src/agent/notes.js 仍为唯一生产实现，保留默认拒绝、CAS/脏草稿/取消行为。

允许编辑：上述旧 src 文件（迁出）、`tests/fixtures/legacy-notes-tools.mjs`、`tests/fixtures/legacy-headless-plugin.mjs`、`packages/dsh-toolbox/tests/features.notes.test.mjs` 及必要的新增专属测试。不要删除覆盖已实现行为的回归测试，不改成 mock success。不改根 scripts/build.mjs：它当前 cp 不清理 lib，删除源文件后旧 lib 可能仍残留，此问题由 Codex 负责清理构建和发布包验证，请在 handoff 明示。旧 profile-smoke 脚本也由 Codex 处置，不让其冒充当前生产验收。

分 A/B 可独立审查提交，只含任务路径，不 merge main/发布/tag/安装。handoff `docs/handoffs/ZED_B5_CLAUDE.md` 写 commit、确切测试命令/结果、未测/未完成项以及 Codex 必需接线。所有输出和 TEMP 必须留在本工作树 D 盘。完成后在本 Zed thread 报告。
