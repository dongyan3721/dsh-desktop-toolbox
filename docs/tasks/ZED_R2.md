# Zed 第二轮：工具边界与取消结果

用户已授权继续。保持 Claude Agent ACP / 当前自定义 DeepSeek Flash。工作树 `D:\Code\dsh-toolbox\.worktrees\zed`，分支 `agent/zed-features`，第一轮提交 9ab4be3。先核对分支，不修改主目录或其他 agent 工作树。

读取主目录最新 `docs/NEXT_PHASE_PLAN.zh-CN.md`、`docs/BRIDGE_PROTOCOL.md` Round 2 decisions。你工作树中的第一轮协议副本较旧，本轮以主目录的只读最新协议为准。

只修改自己工作树 features/**、features*.test.mjs、docs/handoffs/ZED_R2.md。允许只提交自己的文件，不改入口、bridge、根配置或公共协议，不合并 main。

任务：

1. 将分页改为 limit 1..20、offset 0..10000，描述/领域校验一致。按新协议对齐标题500、ID80、查询200、正文1048576 Unicode scalar 上限；拒绝孤立 surrogate 与不允许的控制符，保留合法原文。
2. 补真实原生结果形状兼容与边界测试。保持 JSON-safe、输出净化、纯 render；不在 render 中 IO。
3. 已发送请求的取消终态由 bridge 决定：权威成功结果不因 signal 事后 aborted 被工厂改成取消；CANCELLED/OUTCOME_UNKNOWN/其他稳定错误原样传播，不自动重试。
4. 保持图片授权 fail-closed；授权期间取消不发请求；bridge 权威返回成功时不谎报取消。未实现的 capability 不由你注册。
5. 回归 fake 仅在测试中，增加未授权不调用桥、非法分页/长度/控制字符/Unicode、取消后已提交成功与未知结果传播的测试。

先加载自己工作树环境，实际跑 focused tests。交付新 commit 与 handoff，写清已测/未测，不读旧数据库。Codex负责真实 E2E、工具注册和文件策略。现在执行。
