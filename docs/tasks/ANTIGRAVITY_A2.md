# Antigravity A2：原界面双开关与共享画布

继续现有 Gemini 3.8 Flash 会话/模型。在 `D:\Code\dsh-toolbox\.worktrees\antigravity`、分支 `agent/antigravity-bridge` 工作；已同步当前 main。先读 AGENTS、`docs/AGENT_ACCESS_PLAN.zh-CN.md`、`docs/A2_CONTRACT.md`。旧任务的统计人用专属/便笺图片 Agent 范围已作废。

1. 原 ModuleManager 保留“开启功能”，对 screenshot/clipboard/screen_ink/app_usage 显示独立“允许 Agent 访问”。类型与返回数据以契约 catalog 为准，不能把现有平台 supported 混作 agent_supported。其他六项显示“不支持 Agent”，不可呈现可用授权控件。
2. 新授权默认关闭；关闭模块保留授权选择并说明暂不生效；关闭 Agent 不影响人用。给四项清楚、简洁的共享范围文案。授权保存调用新的 human IPC，采用后端 canonical 返回，处理并发/过期响应、失败回滚、loading和重载；不让两个保存互相覆盖。
3. 保留原布局/语言/键盘导航与快捷键录入，不重做页面。添加可访问名称、可见焦点和中英文文案。准备原 ScreenInkCanvas 的结构化绘制命令+确认窄接线；Cursor/Codex 确定事件后再接，不接受任意JS、HTML或通用输入命令。截图/注释结果必须反映真实同一画布，不能画一份隐藏给 Agent 的假画布。
4. 组件聚焦测试四种组合、六项不支持、pending/失败恢复、两开关并发及 keyboard/a11y。跑既有 Vue 检查/构建；有协议未落地时用明确 fixture，不声称真实原生集成通过。

只编辑 `native/YourAllIn1Helper/src-ui/**` 与自己的 handoff；不改 Rust、根 manifests/脚本/契约或 Node。命令先 dot-source 环境；嵌套 Vue 依赖只可用工作树内 `pnpm --dir native/YourAllIn1Helper/src-ui install --ignore-workspace --frozen-lockfile`，共享根 node_modules/SDK 只读。所有输出在本工作树/D缓存；不启动真实 GUI、采集、热键、不安装用户Profile。Codex 独占真实桌面验收。

分阶段提交（先双开关，后按确认协议接画布），写 `docs/handoffs/ANTIGRAVITY_A2.md`：commit、文件、真实命令/结果、跨界接线请求和未测项；在原会话报告，不合并 main。
