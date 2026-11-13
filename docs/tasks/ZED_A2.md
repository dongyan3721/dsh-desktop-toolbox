# Zed A2：仅四类 Agent 工具与数据共享结果

继续现有 Claude Code ACP / 自定义 DeepSeek Flash 模型。在 `D:\Code\dsh-toolbox\.worktrees\zed`、分支 `agent/zed-features` 工作；已同步 main 的 H1 alpha.6。先读 AGENTS、`docs/AGENT_ACCESS_PLAN.zh-CN.md`、`docs/A2_CONTRACT.md`。本轮只有截图、剪贴板、屏幕注释、应用使用时长支持 Agent；其余六项不支持，不再开发旧便笺/图片工具。

1. 在新 `packages/dsh-toolbox/src/agent/**` 提供四模块 tool factories 和装配 apply；依赖已有 `toolboxDesktop`（Codex补契约中的三个方法），严禁新建 NativeOwner/headless/另一套数据库。只注册 native 实际 advertised 且模块 effective 的方法，按授权 snapshot 撤回/重建，工具旧引用执行时也重新检查，不让模型修改授权/启用模块。
2. 严格输入闭集、日期/数量/文本大小校验、规范错误；signal传播、清理所有注册/订阅、断连撤回、未知副作用不自动重试。可按模块提供四个带固定 action enum 的 Tool，不能泛化成任意 IPC。支持名单固定不扩大，单模块注册问题不使别的模块越权。
3. 用已安装 Harness SDK JS/README 验证真实图像结果/附件方案，支持截图及注释产物让模型实际看见；不能只回本地路径。图像传输由 Codex接线，先使用明确受控 fixture和报告必要API/产物接口，不要自行读取任意路径或巨大base64。访问产物/发布数据前检查最新授权，日志不含内容。剪贴板与统计共享现有真实数据源，不造第二套库。
4. 在专属 `packages/dsh-toolbox/tests/agent-*.test.mjs` 测授权组合、动态撤回、旧回调、断连、取消、输入边界、工具名单无六项、图像SDK结果和数据保真。fixture只算适配测试，不声称真实GUI/模型已过。

只改新 `src/agent/**`、专属测试及 `docs/handoffs/ZED_A2.md`。根 index/manifest/patch/build、desktop service、bridge由Codex负责；人用Client/Vue/Rust不改。旧工具退役由Codex做。命令先dot-source环境，所有临时/测试输出工作树内；共享SDK/node_modules只读，不安装或写用户Profile、不启动桌面/截屏/剪贴板监听/热键。不要切模型或改全局设置。

可先提交授权/JSON工具框架，再补SDK图像与完整适配。handoff写commit、实际导出接口、所查SDK位置/API证据、测试命令结果、跨界接线请求及未实现/未测项。在原会话报告，不合并main。
