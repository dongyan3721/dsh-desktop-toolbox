# DSH Toolbox 迁移工作区

将 `C:\Users\xcxix\PyCharmProjects\YourAllIn1Helper` 迁移为 DeepSeek Harness 插件。

2026-11-14：`0.1.0-beta.5` 已完成本轮集成和受控验收：Harness 内嵌原 Vue 主控台、快捷键诊断详情、Windows 剪贴板来源、旧便笺工具迁出生产包。519 项回归通过，并在已安装 DSH `0.2.2-rc.3` 完成界面、真实热键/剪贴板及退出清理验收；两个包在 `dist/`。范围、哈希与未测项见 [beta.5 验收记录](docs/BETA5_ACCEPTANCE.zh-CN.md)，历史包/tag 保留。

2026-11-14：新增 `0.1.0-beta.4`。桌面组件在未配置 `DSH_HOME` 时使用 `%USERPROFILE%\.dsh\toolbox-desktop-data`。原生程序沿用 beta.3，依赖声明仍接受 DSH `0.2.2-rc.1` 与 `0.2.2-rc.3`。详见 [beta.4 记录](docs/BETA4_DESKTOP_DATA_DIR.zh-CN.md)。此前 [beta.3](docs/BETA3_DSH_RC3_DECLARATIONS.zh-CN.md) 只放宽了安装声明。

产品主线是**供人日常使用的工具箱**：保留原界面、窗口、托盘与快捷键。首个功能验收基线 `0.1.0-beta.2` 已完成 A3 集成和本机受控验收；五项支持 Agent 的模块为截图、剪贴板、屏幕注释、应用使用时长、便笺，功能启停与 Agent 授权独立，新授权默认关闭。其他五项只供人使用。

两个安装包位于 `dist/`，已登录隔离 Electron 预览沿用原 D 盘数据。实际测试、发布哈希与明确未测项见 [beta 1 验收记录](docs/BETA1_ACCEPTANCE.zh-CN.md)。密码本/系统认证、外部翻译服务、个人旧数据导入与多显示器兼容不列为本次全部通过。

- [迁移计划](docs/MIGRATION_PLAN.zh-CN.md)：架构、十个模块的迁移范围、阶段安排、数据与发布验收。
- [人用优先实施计划](docs/HUMAN_FIRST_PLAN.zh-CN.md)：最新优先级、原快捷键对等清单和下一阶段人用闭环。
- [双开关与 Agent 共享计划](docs/AGENT_ACCESS_PLAN.zh-CN.md)：用户最新支持名单、三位 Agent 的 A2 任务及集成门槛；[共享契约](docs/A2_CONTRACT.md)。
- [A2 实际派工记录](docs/A2_COORDINATION.zh-CN.md)：原会话发送状态、同步基线和 Codex 集成顺序。
- [A2 交付复核与下一步](docs/A2_NEXT_PHASE.zh-CN.md)：141 项复跑结果、加入便笺后的五项范围、现有接线缺口、集成顺序和下一轮分工建议。
- [H1 派工与进展](docs/H1_COORDINATION.zh-CN.md)：三位本机 Agent 的当前任务、边界和实际验证状态。
- [勘察基线](docs/BASELINE.zh-CN.md)：本次实际检查结果、版本和待核对项。
- [派工与验证记录](docs/COORDINATION.zh-CN.md)：三个本机 agent 的任务、已完成的样例验证和剩余工作。
- [交付后的下一步计划](docs/NEXT_PHASE_PLAN.zh-CN.md)：第一轮交付复核、已确认缺口、联调及发布门槛。
- [第二轮集成与验收](docs/INTEGRATION_R2.zh-CN.md)：实际可用范围、测试、发布物校验和限制。
- [人用桌面 H1 验收](docs/INTEGRATION_H1.zh-CN.md)：311 项自动测试、真实窗口/键盘/Electron/模型共存验收、安装包和已知限制。
- [插件开发指南快照](docs/references/deepseek-harness-plugin-dev-guide/README.md)：按固定 commit 保存，来源见勘察基线。

插件使用本机 Harness `0.2.2-rc.1` 的实际 SDK。默认人用 Bundle 启动原桌面服务，并与同版本 Client 包提供可见入口；旧 headless Agent 产品入口已退役，历史 alpha 归档保持冻结。新配置只启用便笺，其他模块保持原源码和默认键定义，尚不宣称全部实测。原生源码按固定基线导出到 `native/YourAllIn1Helper`；原 C 盘项目保持只读。构建中间文件、测试数据和发布包均在本工作区中生成，共享缓存和工具链复用 D 盘目录。

当前本机已安装预览可通过 `./scripts/Open-HumanPreview.ps1` 重新打开。此脚本使用 `runtime/human-preview.json` 中记录的 D 盘隔离目录，保留本次用户登录与测试数据。命令行替换/升级包前先正常退出 Harness，避免运行中的 Windows exe 被 pnpm 文件锁阻止替换。

在本工作区 PowerShell 中运行：

```powershell
. ./scripts/Use-ProjectEnvironment.ps1
./scripts/Build-Package.ps1
node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs
node ./scripts/demo.mjs
```

本机 SDK 快照在 `vendor/harness-runtime`，根 node_modules 是指向它的 D 盘 junction。初始提取使用已安装的 Electron Node 模式执行 `scripts/inspect-harness-runtime.cjs --reference --extract-sdk`，追加进程/文件系统依赖使用 `scripts/extract-process-sdk.cjs`；安装位置目前为 `E:\deepseek-harness`，仅作只读输入。提取脚本属于开发准备，不随插件包发布。

`Build-Package.ps1` 从当前工作树构建原 Vue、带 `tauri/custom-protocol` 的桌面 release 和独立 headless release，生成完整性清单、构建 ESM，并将两个 tarball 放入 `dist`。打包要求原生源码已提交；已有同版本归档会被拒绝覆盖。SDK、工作树和测试数据库不进包，不执行安装期编译。需要已准备的 Rust/MSVC、Node 与 pnpm；发布物运行无需 Rust 或原 C 盘项目。

旧 headless 发布包隔离验收（人用包按 H1 记录验证，不能套用此驱动）：

```powershell
./scripts/Test-PackagedPlugin.ps1 -Package ./dist/dsh-toolbox-0.1.0-alpha.2.tgz -Images
# 可附加 -PreviousPackage ./dist/dsh-toolbox-0.1.0-alpha.1.tgz 验证升级保留数据。
```

现有后端验收脚本启动真实 CLI/Profile，不调用模型 API；检查便笺创建/查询/更新、重启持久化、配置重载、图片实际格式和卸载配置。它不验证原生 GUI 或快捷键。Windows x64 是本轮运行目标，外部发布前仍需完整许可和额外系统兼容性审计。日常用户 Profile 不在本轮安装范围内。

三位本机 agent 沿用独立工作树：Cursor 提供原生能力、CodeBuddy 接替 Antigravity 完成前端、Zed 提供 Agent 工具。Codex 负责集成、修复、真实测试和 beta 打包；不新建分支或工作树。边界与接口见 [H1 契约](docs/H1_CONTRACT.md)、[桥协议](docs/BRIDGE_PROTOCOL.md) 及 `docs/tasks/`。
