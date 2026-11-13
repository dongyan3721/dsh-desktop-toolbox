# H0/H1 人用优先派工与进展

2026-11-13 用户授权实施。三位使用原本机模型与已有独立工作树，Codex 已将经验证的 main 同步合并到各分支，并核对同步后文件内容一致；没有新建工作树，也没有丢弃旧交付历史。

| 负责人 | 同步提交 | 已发送的任务 | 观察状态 |
| --- | --- | --- | --- |
| Cursor / Grok 4.7 High | `7427cd6` | `tasks/CURSOR_H1.md`：Tauri 正式插件模式、单实例、私有控制管道、原快捷键与退出保存 | 任务已进入原会话，界面开始执行 |
| Antigravity / Gemini 3.8 Flash High | `ba6c700` | `tasks/ANTIGRAVITY_H1.md`：原 Vue 功能/偏好/面板、快捷键控件、对等清单与测试 | 任务已进入原会话，界面显示 Working |
| Zed / Claude Code ACP、自定义 DeepSeek Flash | `e02ae29` | `tasks/ZED_H1.md`：实际 Harness 人用可见入口核实、受支持的 Client/Host adapter | 任务已进入原会话并开始执行 |
| Codex | `integration/notes-mvp` | 共享契约、无 tools 依赖的运行服务、环境、集成和集中 GUI/物理按键验收 | 正在实施；没有声称人用闭环已验收 |

约定见 `H1_CONTRACT.md`。Rust 桌面源、Vue 源、Harness 入口和 Codex 运行服务各有独立写入范围。三位不启动 GUI 或全局按键测试，避免同时抢焦点、重复注册或访问个人数据。脚本、密码本和统计保持人用，不增加 Agent 工具。

Codex 已在集成目录准备嵌套前端依赖，未触碰共享根 SDK junction。原 Vue 基线通过 `vue-tsc --noEmit`、Vite 生产构建与 **103 项前端测试**；此结果不是 GUI 实测。实际宿主相关 README/JS/manifest 追加到项目内共享 reference 目录，E 盘安装只读。

运行服务已完成第一组真实 Cordis Loader/受管理子进程/协议夹具测试，验证无 `tools` 服务也可工作、已知退出后的显式再打开、保存失败不伪报成功。夹具不创建窗口、托盘或快捷键；真实 GUI 验收仍待 Cursor 桌面交付与可见入口集成。
