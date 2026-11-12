# Zed / Claude Agent ACP / 自定义 DeepSeek Flash — 便笺和图片工具适配

用户已授权你在本机参与迁移。先读根 AGENTS.md、实施基线、BRIDGE_PROTOCOL.md 和迁移计划。直接实现、测试，不止写计划。

实际工作树：`D:\Code\dsh-toolbox\.worktrees\zed`，分支 `agent/zed-features`。后续所有路径相对此工作树；主目录只读。应用即使仍显示原项目，也必须用上述绝对路径编辑并在此目录执行命令。以本段替代旧提示中的共享工作区说明。此前已写的 features 和测试会由 Codex 原样迁入此处，不要从主目录重新覆盖。

唯一写入范围：`packages/dsh-toolbox/src/features/**`、`packages/dsh-toolbox/tests/features*.test.mjs`、`docs/handoffs/ZED.md`。不要改插件入口 src/index.js、根 manifest/锁文件、bridge、原生源码或共享协议。可只提交自己的分配文件到自己的分支，不合并 main。

实现 `features/notes.js` 导出 createNoteTools(bridge)，`features/images.js` 导出 createImageTools(bridge,{authorizePaths})。使用真实 defineTool/Schema DSL（查本机 SDK README 与实现，object 必须有 additionalProperties:false）；工厂返回工具定义数组，由 Codex 后续注册。

工具：toolbox_note_create/search/update 和 toolbox_image_convert；映射到协议方法/字段。严格校验输入，传递 exec.signal，返回 JSON-safe 业务值，render/presentation 为纯函数，不泄漏 IPC 内部概念。先只支持不打开原生便笺窗口。图片授权回调必须在请求前执行；缺少 authorizer 拒绝执行，不能自己绕过 Harness 文件策略。不得执行任意 Shell、读旧数据库、读取密码或剪贴板。

重点测试：与固定协议的映射、取消信号、Schema 拒绝无效输入、错误传播、图片缺授权和授权拒绝时不调用桥、渲染不做 IO。Fake bridge 仅在测试中使用，不能作为产品成功实现。

ESM JavaScript，根 node_modules 已有 SDK；先 dot-source scripts/Use-ProjectEnvironment.ps1，再 node --test packages/dsh-toolbox/tests/features*.test.mjs。交付 handoff 列出实际 API、测试命令/结果和阻碍。保持当前用户自定义模型，不切换模型。现在开始。
