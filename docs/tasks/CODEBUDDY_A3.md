# CodeBuddy A3：接替前端开发

用户最新指令：停止使用 Antigravity/Gemini，将其工作交给已经切好模型与页面的 CodeBuddy。保持当前模型和模式，不调整全局设置，不再向旧 Agent 派工。

## 工作树与基线

- **唯一可写工作树**：`D:\Code\dsh-toolbox\.worktrees\antigravity`。
- **现有分支**：`agent/antigravity-bridge`。名称沿用历史，不新建/重命名分支或工作树。
- 原代码基线 `5cfc7cc`，内容与集成基线 `4954edc` 一致，含三位前轮 A2 实现与 A3 共同协议。接手前两次核对工作树干净，未发现 Antigravity 新增 A3 代码；保留已交付的 A2 Vue 双开关和测试。
- 应用当前打开的是主目录时，所有编辑必须使用上述工作树绝对路径；所有命令 cwd 也必须是上述目录或其子目录。**主目录 main、integration、Cursor/Zed 的工作树均只读。**

先读本树 AGENTS.md、`docs/A3_IMPLEMENTATION_CONTRACT.md`、`docs/A2_CONTRACT.md`、`docs/A2_NEXT_PHASE.zh-CN.md`、`docs/handoffs/ANTIGRAVITY_A2.md`；接替原 `ANTIGRAVITY_A3.md` 范围。

## 交付顺序

1. 原 ModuleManager 以明确的原生 catalog agent_supported 为支持依据，缺字段保守false；加入便笺文案/独立授权，支持名单共五项。修复两类开关/跨模块响应整份 catalog 覆盖的竞态、旧 props 响应、失败回滚与 pending，保留原键盘/布局。先提交这部分和真正执行组件逻辑的可控Promise测试。
2. 按 A3 **精确** ready/result IPC 和 `sticky://agent-command` 实现原 StickyNote 的 prepare/apply/release：非关闭地冲刷草稿、冻结/解冻、处理新write_session_id、旧autosave失效、已提交内容在原窗口同步、冲突/超时保留草稿；不创建另一份编辑器。
3. 同协议实现原 ScreenInkCanvas 的 draw/snapshot/clear/ack：同一历史/撤销栈、物理桌面坐标/DPI转换、用户正在画时BUSY、真实透明画布PNG、有界结果、会话/超时/迟到回复/卸载清理。原快捷键、工具栏、人用清屏和穿透保留。
4. 防止 Agent 写入 Markdown 后执行原始HTML事件、脚本或javascript URL触达人用IPC。保留正常Markdown/LaTeX，使用正确的安全渲染/转义，并用恶意合成内容测试。不能以禁用便笺预览代替修复。

仅可改 `native/YourAllIn1Helper/src-ui/**` 和自己的 `docs/handoffs/CODEBUDDY_A3.md`。Rust/原生网关由 Cursor；Node tools 由 Zed；桌面服务、图像传输、根 Entry/Bundle/构建脚本/协议由 Codex。若接口确有问题，写清具体字段/代码证据交接，不擅自另造协议或跨界改文件。

每组工作独立提交，交接说明commit、文件、实际测试/构建命令与结果、尚未实现/未测项。跑前端单测与typecheck/build；mock不能称真实系统通过，模板字符串断言不能代替并发行为测试。不合并main、不发布。

所有命令先点源本工作树 `scripts/Use-ProjectEnvironment.ps1`；测试、构建、临时文件只在本工作树/D盘缓存。共享SDK/root node_modules只读，不做全局安装。需要嵌套依赖时只用本树冻结lock且ignore-workspace安装。**不启动GUI、真实截屏、系统剪贴板读写/监听、全局热键或安装Harness Profile**；Codex独占真实桌面与模型验收。原C盘工程和个人数据不可修改/读取。用户已授权继续开发，直接实施，不等待重复确认。
