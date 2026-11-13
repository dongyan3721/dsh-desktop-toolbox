# Antigravity 第二轮：桥客户端修正

用户已授权继续。保持当前 Gemini 3.8 Flash High。工作树 `D:\Code\dsh-toolbox\.worktrees\antigravity`，分支 `agent/antigravity-bridge`，第一轮提交 f4f91cc；先核对实际分支与干净状态。主目录/其他工作树只读。

读取主目录最新 `docs/NEXT_PHASE_PLAN.zh-CN.md`、`docs/BRIDGE_PROTOCOL.md` 的 Round 2 decisions。本任务书与协议是 Codex 的新指令；不要沿用第一轮“立即取消即成功停止”的旧测试预期。

只修改自己工作树的 `packages/dsh-toolbox/src/bridge/**`、`packages/dsh-toolbox/tests/bridge*.test.mjs`、`docs/handoffs/ANTIGRAVITY_R2.md`。允许在自己分支提交这些文件，不改入口/根配置/公共协议，不合并 main。

必须完成：

1. 严格 UTF-8 解码、拒绝数组信封，validate ready/response/event 的字段与类型/版本；capabilities 为去重非空字符串。错误不得回显私密内容。
2. 按最新协议实现取消与超时的有限终态等待、OUTCOME_UNKNOWN、causeCode，不自动重试写操作。connectBridge 新选项 cancelTimeoutMs 默认 1500。先取消但服务端已提交成功时，返回权威成功；服务端确认 CANCELLED 时才按此拒绝。
3. close 真正等 socket close、幂等，正常关闭也清除 force timer；失联/非法帧时清理 pending、监听器和计时器。验证所有 timeout 参数是正有限数，限制在途请求数量。
4. 扩充真实 Named Pipe fixture 回归：非法 UTF-8、数组、坏 capabilities、缺失或矛盾 result/error、非法事件、分包/合包、取消后成功/取消确认/无响应/断线、定时器与监听器清理。旧测试应按新契约更新，不仅保持旧断言。

命令先加载自己工作树 scripts/Use-ProjectEnvironment.ps1，所有输出留在自己工作树。交付新 commit、handoff（确切测试命令/结果和 API 变化）。不要启动其他应用或读取用户数据。现在执行。
