# Cursor / Grok 4.7 High — 原生桥第一轮

用户已授权你在本机参与迁移。先读根 AGENTS.md、实施基线、桥协议和迁移计划。直接实现、测试，不止写计划。

实际工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`，分支 `agent/cursor-native`。后续所有路径相对此工作树；主目录只读。应用即使仍显示原项目，也必须用上述绝对路径编辑并在此目录执行命令。以本段替代旧提示中的共享工作区说明。

你的唯一写入范围：`native/YourAllIn1Helper/crates/dsh-bridge/**`、原生副本根 `Cargo.toml` / `Cargo.lock`（Cargo 生成）及 `docs/handoffs/CURSOR.md`。其他源码只读，其他 agent 正并行修改 Host，不能改根工作区 package.json、脚本、协议或插件入口。可只提交自己的分配文件到自己的分支，不合并 main。

目标：制作可启动的 Windows 原生 Named Pipe 服务 `dsh-toolbox-native`，复用原 AppKernel 和 sticky-note/media 模块。先完成协议握手、status、独占数据锁、断线/父进程退出清理，再按实际能力实现 notes.create/search/update 与图片转换。没有完成的方法不要放进 capabilities。优先交付可测试的 status+便笺真实持久化，媒体遇阻写明原因，不做假成功。

按照固定 BRIDGE_PROTOCOL.md，实现消息长度边界、取消、方法白名单、current-user pipe ACL/拒绝远程客户端及资源所有权。禁止直接暴露 DesktopHost 通用 IPC；禁止启动剪贴板/应用统计/密码本等无关模块；禁止读取用户旧数据库。第一轮可为纯 Rust 原生进程，不创建 WebView；需在 handoff 明确它不支持截图遮罩/便笺窗口，后续仍按计划复用 Tauri，不能把 MockOsHal 当生产系统能力。

构建前 dot-source `scripts/Use-ProjectEnvironment.ps1`，你的 target/build-dir 改到本工作区 `build/rust/cursor/{target,intermediates}` 以避免与 Codex 烟测锁冲突。Rust 工具链和依赖复用 D:\Dev\Rust。必须以 D 盘测试夹具验证真实数据库重启、非法方法/帧、重复实例和关停。测试 API 不得修改其他应用、系统剪贴板或触发真实认证。

优先跑针对新 crate 的 cargo check/test，release 构建允许耗时则继续；所有临时输出留在 D 盘。交付 handoff：已实现方法、确切启动参数、构建路径、测试命令和结果、未实现项及对协议的必要变更请求。实际 API 以源码为准。现在开始。
