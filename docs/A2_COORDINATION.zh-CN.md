# A2 本机派工与集成记录

日期：2026-11-13。本轮只完成规划、契约准备与实际派工，不将计划项写成实现或验收通过。

后续更新：三位前轮交付已齐；用户新增便笺为第五项支持模块。交付复核与后续计划见 [A2_NEXT_PHASE.zh-CN.md](A2_NEXT_PHASE.zh-CN.md)。以下保留前轮实际派工记录，不表示已派发修订后的补开发任务。

## 已完成

- main `eb2ff2b` 提交最新范围、双开关行为、共同契约和三份 A2 任务书；同步修正 AGENTS、人用计划、迁移计划和 README 中的旧支持名单。
- 派工前确认三个工作树干净，沿用原分支，合并同步验证过的 H1 alpha.6 与 A2 文档；合并后逐个检查工作树内容与 main 一致，保留原提交历史，无新分支/工作树。
- 通过本机原会话输入并发送自然语言任务：Cursor 已显示 `Planning next moves`；Antigravity 已显示 `Working`；Zed 已显示新任务消息和运行中的停止按钮。未更改所选模型、权限或全局设置。

| 会话 | 既有工作树/分支 | 同步提交 | 本轮交付 |
| --- | --- | --- | --- |
| Cursor / Grok 4.7 High | `.worktrees/cursor` / `agent/cursor-native` | `0ebadd1` | 原生授权、四模块共享桥、Rust 聚焦测试 |
| Antigravity / Gemini 3.8 Flash High | `.worktrees/antigravity` / `agent/antigravity-bridge` | `903a328` | 原 Vue 双开关、文案、组件验证，后续确认协议后接原画布 |
| Zed / Claude Code ACP / deepseek-flash 自定义模型 | `.worktrees/zed` / `agent/zed-features` | `f56247f` | 四类 Agent 工具、授权同步、取消与 SDK 图像结果 |

任务书为 `tasks/CURSOR_A2.md`、`tasks/ANTIGRAVITY_A2.md`、`tasks/ZED_A2.md`。规范为 [A2 契约](A2_CONTRACT.md)，总体顺序见 [A2 计划](AGENT_ACCESS_PLAN.zh-CN.md)。三位仅修改各自分配路径并提交，Codex 独占集成工作树和真实桌面验收。

## Codex 下一步

1. 检查首批原生 policy/catalog 与 Vue 双开关提交，先集成配置迁移、默认拒绝和原人用回归。
2. 扩展 `toolboxDesktop` 的 access snapshot / call / subscription；元数据轮询不读取共享内容。补根 Bundle/导出、旧便笺/图片 Agent 退役及旁路回归。与 Cursor 确定受控图像传输，与两端确定原画布 acknowledgment，再接 Zed 工具。
3. 自动验证直接 RPC 拒绝、四组合、授权隔离/撤回/重启、未知写入不重试、单内核与有界产物。代理 fixture 成功不算真实系统通过。
4. 在隔离数据与已登录 Harness 完成四模块共享：可识别测试图/文本/注释/短时统计；确认人的 UI 能看到 Agent 操作，Agent 能读获授权的人用数据。验证原键位/窗口/托盘/启停与卸载。记录实际 SDK、模型与结果。
5. 验收通过再构建并安装新预览；保留现有 alpha.6、登录目录与冻结历史包。构建/打包/临时文件在 D 盘工作区，复用 D 盘缓存。

本轮派工不等于四模块已开发完成；H2 十模块人用对等、H3 个人数据迁移与后续发布验收继续保留。开发过程不读取真实私人剪贴板、个人统计或密码库。
