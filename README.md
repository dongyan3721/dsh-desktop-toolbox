# DSH Toolbox 迁移工作区

将 `C:\Users\xcxix\PyCharmProjects\YourAllIn1Helper` 迁移为 DeepSeek Harness 插件。

- [迁移计划](docs/MIGRATION_PLAN.zh-CN.md)：架构、十个模块的迁移范围、阶段安排、数据与发布验收。
- [勘察基线](docs/BASELINE.zh-CN.md)：本次实际检查结果、版本和待核对项。
- [派工与验证记录](docs/COORDINATION.zh-CN.md)：三个本机 agent 的任务、已完成的样例验证和剩余工作。
- [插件开发指南快照](docs/references/deepseek-harness-plugin-dev-guide/README.md)：按固定 commit 保存，来源见勘察基线。

已准备可运行的 `toolbox_status` 插件样例，复用了本机 Harness `0.2.2-rc.1` 的实际 SDK。原生源码已按固定基线导出到 `native/YourAllIn1Helper`；原 C 盘项目保持只读。源码、构建中间文件、测试数据和发布包均在本工作区中生成，共享缓存和工具链复用 D 盘目录。

在本工作区 PowerShell 中运行：

```powershell
. ./scripts/Use-ProjectEnvironment.ps1
node ./scripts/build.mjs
node --test ./tests/prototype.test.mjs
node ./scripts/demo.mjs
```

本机 SDK 快照在 `vendor/harness-runtime`，根 node_modules 是指向它的 D 盘 junction。需要重建时，在上述环境中使用已安装的 Electron Node 模式执行 `scripts/inspect-harness-runtime.cjs --reference --extract-sdk`；安装位置目前为 `E:\deepseek-harness`，不会写入该安装目录。

样例包：`dist/dsh-toolbox-0.0.1-prototype.1.tgz`，已安装在工作区的 `runtime/dsh-dev/profiles/toolbox-prototype` 并完成配置审计。第二项 prototype 测试要求该隔离 Profile 中的样例包已安装。样例只报告迁移状态，不执行原生桌面操作。

第一轮并行工作：Cursor 实现原生桥，Antigravity 实现 Node 客户端，Zed 实现便笺与图片工具。任务边界与接口见 [实施基线](docs/IMPLEMENTATION_BASELINE.zh-CN.md)、[桥协议](docs/BRIDGE_PROTOCOL.md) 及 `docs/tasks/`。三个 agent 的代码需经过 Codex 审查与联调后，才注册到插件入口。
