# H1 人用优先派工与集成结果

2026-11-13。三位沿用已有分支/工作树，Codex 将交付合入已有 integration/notes-mvp，审查修复并完成真实验收。没有另开分支或工作树。最终交付本机人用预览 0.1.0-alpha.6。

| 负责人 | 交付提交 | 集成结果 |
| --- | --- | --- |
| Cursor / Grok 4.7 High | be5d8b7、af3a890 | 原 Tauri 正式插件模式、单实例/私有管道、原快捷键与保存退出；Codex 修正配置准备前取锁，并通过真实窗口测试 |
| Antigravity / Gemini 3.8 Flash High | a4f1637、dad6b70 | 原 Vue/IPC/快捷键对等清单；审查纠正动作 ID、事件名与覆盖表述，未改写原 UI |
| Zed / Claude Code ACP、自定义 DeepSeek Flash | b3a6592、54af057 | 真实外部 Client 及 sidebar/main slots、Host adapter、中文错误；Codex 按实际独立 provider 结果修正传输装配 |
| Codex | integration/notes-mvp | 无 tools 依赖的桌面服务、构建/打包、实例锁修复、内置前端协议修复、受认证的精确 Connection 路由、完整集成与 GUI/OS 键/Electron/模型共存验收 |

共 311 项自动测试通过：JS/集成 124、原 Vue 103、Rust 桌面库 65、原生桥库 19。原前端类型检查、生产构建及带 tauri/custom-protocol 的独立原生 Release 构建通过。默认人用装配不注册 Agent 工具。

真实验收包括：Web 和已登录 Electron 的可见入口，原主窗/偏好/便笺面板，便笺编辑保存/关闭/重开/进程重启，另一前台应用下临时全局键，冲突拦截/清除/默认/Esc/Tab，重复实例，父退出和装卸清理，数据保留，普通模型调用共存。实际控制路由无认证 401、跨来源 403。Windows CLI 热升级遇到运行文件占用，正常退出宿主再升级成功；不能宣称热替换通过。

完整版本、归档哈希、命令、证据及剩余范围见 [H1 验收记录](INTEGRATION_H1.zh-CN.md)。最终预览恢复安装并打开，登录和会话保留在 D 盘隔离目录；用 scripts/Open-HumanPreview.ps1 可再次打开同一实例。冻结 alpha.2 未覆盖，原 C 项目及个人数据库未改动。

这是 H0/H1 人用纵向预览。H2 仍需逐模块验证其余默认键、原生窗口和启停观察器；H3 处理旧数据/用户配置导入。密码本由本人手工验收。源码存在和总体测试通过不代表十模块均已完成 GUI 实测。后续继续以人的使用体验为先，脚本、密码本和统计无需因没有 Agent Tool 而扩展接口。
