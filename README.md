# DSH Toolbox 迁移工作区

将 `C:\Users\xcxix\PyCharmProjects\YourAllIn1Helper` 迁移为 DeepSeek Harness 插件。

产品主线是**供人日常使用的工具箱**：先保留原界面、操作与快捷键，再按价值开放可选 Agent 接口。脚本、密码管理和使用时间统计可以保持人用。现有 alpha 是已验证的后端基础，桌面体验与快捷键尚未迁移，不能视为人的 MVP。

- [迁移计划](docs/MIGRATION_PLAN.zh-CN.md)：架构、十个模块的迁移范围、阶段安排、数据与发布验收。
- [人用优先实施计划](docs/HUMAN_FIRST_PLAN.zh-CN.md)：最新优先级、原快捷键对等清单和下一阶段人用闭环。
- [H1 派工与进展](docs/H1_COORDINATION.zh-CN.md)：三位本机 Agent 的当前任务、边界和实际验证状态。
- [勘察基线](docs/BASELINE.zh-CN.md)：本次实际检查结果、版本和待核对项。
- [派工与验证记录](docs/COORDINATION.zh-CN.md)：三个本机 agent 的任务、已完成的样例验证和剩余工作。
- [交付后的下一步计划](docs/NEXT_PHASE_PLAN.zh-CN.md)：第一轮交付复核、已确认缺口、联调及发布门槛。
- [第二轮集成与验收](docs/INTEGRATION_R2.zh-CN.md)：实际可用范围、测试、发布物校验和限制。
- [插件开发指南快照](docs/references/deepseek-harness-plugin-dev-guide/README.md)：按固定 commit 保存，来源见勘察基线。

插件使用本机 Harness `0.2.2-rc.1` 的实际 SDK，通过受管理的 Windows 原生进程提供便笺存储。图片工具在显式配置允许的读写根且原生实际支持时开放。原生源码按固定基线导出到 `native/YourAllIn1Helper`；原 C 盘项目保持只读。构建中间文件、测试数据和发布包均在本工作区中生成，共享缓存和工具链复用 D 盘目录。

在本工作区 PowerShell 中运行：

```powershell
. ./scripts/Use-ProjectEnvironment.ps1
./scripts/Build-Package.ps1
node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs
node ./scripts/demo.mjs
```

本机 SDK 快照在 `vendor/harness-runtime`，根 node_modules 是指向它的 D 盘 junction。初始提取使用已安装的 Electron Node 模式执行 `scripts/inspect-harness-runtime.cjs --reference --extract-sdk`，追加进程/文件系统依赖使用 `scripts/extract-process-sdk.cjs`；安装位置目前为 `E:\deepseek-harness`，仅作只读输入。提取脚本属于开发准备，不随插件包发布。

`Build-Package.ps1` 从当前工作树构建原生 release、生成版本/哈希清单、构建 ESM，并将 tarball 放入 `dist`。打包要求原生源码已提交，以便清单记录准确版本。不把 SDK、工作树或测试数据库装进包，不执行安装期编译。需要本机已准备的 Rust/MSVC、Node 与 pnpm；发布物运行无需 Rust 或原 C 盘项目。

从发布包做隔离验收（生成的便笺与图片保留在 `runtime`，日志在 `artifacts`）：

```powershell
./scripts/Test-PackagedPlugin.ps1 -Package ./dist/dsh-toolbox-0.1.0-alpha.2.tgz -Images
# 可附加 -PreviousPackage ./dist/dsh-toolbox-0.1.0-alpha.1.tgz 验证升级保留数据。
```

现有后端验收脚本启动真实 CLI/Profile，不调用模型 API；检查便笺创建/查询/更新、重启持久化、配置重载、图片实际格式和卸载配置。它不验证原生 GUI 或快捷键。Windows x64 是本轮运行目标，外部发布前仍需完整许可和额外系统兼容性审计。日常用户 Profile 不在本轮安装范围内。

三位本机 agent 使用独立工作树：Cursor 实现原生桥，Antigravity 实现 Node 客户端，Zed 实现工具工厂。Codex 在 `.worktrees/integration` 集成并执行真实测试，通过门槛后合并 main。边界与接口见 [实施基线](docs/IMPLEMENTATION_BASELINE.zh-CN.md)、[桥协议](docs/BRIDGE_PROTOCOL.md) 及 `docs/tasks/`。
