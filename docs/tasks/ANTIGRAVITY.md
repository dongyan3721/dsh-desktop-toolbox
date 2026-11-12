# Antigravity / Gemini 3.8 Flash High — Node 桥客户端

用户已授权你在本机参与迁移。先读根 AGENTS.md、实施基线、BRIDGE_PROTOCOL.md 和迁移计划。直接实现、测试，不止写计划。

实际工作树：`D:\Code\dsh-toolbox\.worktrees\antigravity`，分支 `agent/antigravity-bridge`。后续所有路径相对此工作树；主目录只读。应用即使仍显示原项目，也必须用上述绝对路径编辑并在此目录执行命令。以本段替代旧提示中的共享工作区说明。

唯一写入范围：`packages/dsh-toolbox/src/bridge/**`、`packages/dsh-toolbox/tests/bridge*.test.mjs`、`docs/handoffs/ANTIGRAVITY.md`。不要改根 manifest/锁文件、插件 src/index.js、共享协议、原生源码或 Zed 的 features。可只提交自己的分配文件到自己的分支，不合并 main。

实现 connectBridge 与 request/close 的固定接口，Node net Named Pipe 客户端及可在测试进程内使用的 framing。支持部分帧/合并帧、4MiB 限制、严格握手/版本/实例校验、并发 ID 映射、请求取消/超时、断线/close 拒绝 pending、清理 signal/timer/socket 监听器。错误统一稳定 .code；副作用不重试。校验响应/事件结构，不把错误响应当成功。

第一轮不启动任何原生子进程、不使用 HTTP、不读取密钥或用户数据。启动策略和 ctx.effect 接入由 Codex 集成；请在 handoff 写出建议的清理顺序。测试可启动本工作区专用 Named Pipe fixture server，不能访问其他软件。

使用 ESM JavaScript；实际 SDK 已在根 node_modules 可用，无需全局安装。命令先 dot-source scripts/Use-ProjectEnvironment.ps1。测试用 node --test packages/dsh-toolbox/tests/bridge*.test.mjs，并实际覆盖分包、取消、握手失败、非法帧、断线和重复 close。输出 handoff 列出文件和确切结果。现在开始。
