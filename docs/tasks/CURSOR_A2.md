# Cursor A2：原生授权与四模块共享

继续现有 Grok 4.7 会话/模型。在 `D:\Code\dsh-toolbox\.worktrees\cursor`、分支 `agent/cursor-native` 工作；已同步 main 的 H1 alpha.6 基线和本轮契约。先读 AGENTS、`docs/AGENT_ACCESS_PLAN.zh-CN.md`、`docs/A2_CONTRACT.md`。用户最新名单优先于旧 H1/R2 任务。

1. 先交付 app-core 双开关配置迁移、四项静态白名单、catalog 三字段、Tauri `kernel_set_agent_access` 与逐次执行端权限检查。人的启用命令/快捷键行为保留；agent_access 默认 false，不支持模块手工 true 仍拒绝。为这部分单独提交，方便先联调界面。
2. 在现有 GUI DesktopControl/同一 DesktopHost 实现 `agent.get_access` 和 A2 中的精确方法；先 JSON，再图片/注释。不得 headless 新实例、泛化转发旧 IPC 或开放便笺/图片/翻译/脚本/置顶/密码本。原使用时长只供人用的旧要求已被本轮授权取代。
3. 四项共享现有业务/数据，确保启停模块时监听器即时同步、无重复采集，不要只有启动时检查 enabled。剪贴板显式写入实际 OS+同一历史；统计按日期限量；截图产物和真正共享注释的绘制/快照必须诚实。原画布若需 Vue 接线，在首份 handoff 明确事件名/结构/ack，交 Codex/Antigravity；不要跨界编辑 Vue。
4. 生成数据的无界面聚焦 Rust 测试：旧配置默认拒绝、四组合、独立授权、不支持/伪造请求、持久化失败、撤回与取消、边界数量/大小和共享状态。不要运行真实截屏、系统剪贴板写入、监听、热键或 GUI 测试；mock_hal 要与真 OS 路径可区分。

可改 `native/YourAllIn1Helper/crates/app-core/**`、`src-tauri/**` 及四个指定模块必要扩展；仅必要时更新原生 Cargo.lock，说明原因。不可改 Vue、Node、根脚本/契约/manifest；构建只用本工作树 `.tmp/build/runtime`、D盘缓存。命令先 dot-source 环境。shared SDK/node_modules 只读，不更改全局环境。聚焦测试优先，不做全量打包，不抢占 Codex 桌面。

完成 `docs/handoffs/CURSOR_A2.md`：分阶段 commit、命令/结果、实际方法列表、响应样例、图片传输与画布接线请求、尚未实现/未测项。每个阶段可独立提交，完成后报告给原会话；不合并 main。
