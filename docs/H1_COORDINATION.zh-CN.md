# H0/H1 人用优先派工与进展

2026-11-13 用户授权实施。三位使用原本机模型与已有独立工作树，Codex 已将经验证的 main 同步合并到各分支，并核对同步后文件内容一致；没有新建工作树，也没有丢弃旧交付历史。

| 负责人 | 同步提交 | 已发送的任务 | 观察状态 |
| --- | --- | --- | --- |
| Cursor / Grok 4.7 High | `7427cd6` | `tasks/CURSOR_H1.md`：Tauri 正式插件模式、单实例、私有控制管道、原快捷键与退出保存 | 连接反复中断曾停止重试，Codex 恢复原任务后已产生桌面启动/控制管道实现；尚未提交 H1 |
| Antigravity / Gemini 3.8 Flash High | `ba6c700` | `tasks/ANTIGRAVITY_H1.md`：原 Vue 功能/偏好/面板、快捷键控件、对等清单与测试 | 已交 `a4f1637` 文档；Codex 发现 ID/事件名/测试覆盖表述不准，已退回核实修订，暂未集成 |
| Zed / Claude Code ACP、自定义 DeepSeek Flash | `e02ae29` | `tasks/ZED_H1.md`：实际 Harness 人用可见入口核实、受支持的 Client/Host adapter | 已交 `b3a6592` 并集成；继续负责中文错误体验、稳定错误码与实际 SDK 验证收口 |
| Codex | `integration/notes-mvp` | 共享契约、无 tools 依赖的运行服务、环境、集成和集中 GUI/物理按键验收 | 运行服务、入口适配和构建装配已提交；完整 JS 回归 113 通过；新 Tauri GUI 尚未验收 |

约定见 `H1_CONTRACT.md`。Rust 桌面源、Vue 源、Harness 入口和 Codex 运行服务各有独立写入范围。三位不启动 GUI 或全局按键测试，避免同时抢焦点、重复注册或访问个人数据。脚本、密码本和统计保持人用，不增加 Agent 工具。

Codex 已在集成目录准备嵌套前端依赖，未触碰共享根 SDK junction。原 Vue 基线通过 `vue-tsc --noEmit`、Vite 生产构建与 **103 项前端测试**；此结果不是 GUI 实测。实际宿主相关 README/JS/manifest 追加到项目内共享 reference 目录，E 盘安装只读。

运行服务已完成第一组真实 Cordis Loader/受管理子进程/协议夹具测试，验证无 `tools` 服务也可工作、已知退出后的显式再打开、保存失败不伪报成功。夹具不创建窗口、托盘或快捷键；真实 GUI 验收仍待 Cursor 桌面交付与可见入口集成。

## 当前可审查集成结果

集成工作树：`D:/Code/dsh-toolbox/.worktrees/integration`，最新实现提交 `18f9df9`，main 保留已验证发布基线和协调文档。

- `4ccd5e5`：独立 `toolboxDesktop` 服务和桌面生命周期；无模型工具依赖，已知退出后仅用户显式打开才重启；保存关停失败明确报错。
- `4bb4d0e`：集成 Zed 的真实公开 sidebar/main slots 入口及窄 Host RPC adapter。19 项入口定向测试通过，仍不是实际 Harness Client 加载/点击验收。
- `18f9df9`：`./desktop`、`./human-entry` 导出、独立人用 patch 草案，以及原 Vue + Tauri 桌面构建/独立完整性清单脚本。脚本语法检查和 Host 构建通过；尚未构建或发布新桌面包。
- 集成目录执行 `node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs`：**113 通过，0 失败**。包含既有真实原生/Loader 回归及桌面控制协议夹具；不含真实 Tauri/物理按键。

下一项集中验收仍是：可见入口 → 原主窗/偏好 → 便笺创建/编辑/保存/重开/重启 → 另一前台应用下临时自定义全局键 → 冲突与默认恢复 → 卸载清理。需要先完成原生交付、审查及编译。密码本涉及手工验收，不由 Windows 自动化操作。构建、临时数据和产物继续留在 D 盘工作区；冻结 alpha.2 tgz 未覆盖。
