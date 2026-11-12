# 第二轮集成与本机 alpha 验收

日期：2026-11-13。实现与验收工作树：`D:\Code\dsh-toolbox\.worktrees\integration`，分支 `integration/notes-mvp`。本轮是便笺与图片 MVP 的本机验收，不是十个模块的全部迁移，也没有向 npm 或日常 Harness Profile 发布。

集成已通过门槛并以 `9df82bc` 快进合并 main。最终 tgz、SHA-256 文件和运行资源已同步到主目录；主目录再次构建 ESM、复跑 92 项测试通过，并以全新 DSH_HOME 完成相同的升级/图片/卸载验收。最终主目录日志位于 `artifacts/package-acceptance/532efcd0-8120-4b48-b47d-d31e6b7404bc/`，结束后本轮原生进程检查无残留。三个原交付分支和工作树保留。

## 交付与分工

三位本机 agent 使用独立工作树，Codex 审查、修正、集成、测试与打包。原始交付分支和工作树保留，没有让他们共同修改 main。

| 负责人 | 原始交付提交 | 本轮职责 |
| --- | --- | --- |
| Cursor / Grok 4.7 High | `4476dad`；第二轮 `38fb766`、`549ea07`、`5461a40`、`f38936b` | Windows 原生桥、提交点与关停、入站背压、图片精确输出、便笺原子存储 |
| Antigravity / Gemini 3.8 Flash High | `f4f91cc`；第二轮 `9e2ac7f` | 严格帧与信封、取消宽限期、未知结果、实际 socket 关闭等待 |
| Zed / Claude Code ACP、自定义 DeepSeek Flash | `9ab4be3`；第二轮 `90334bf` | 工具工厂、参数/结果边界、错误原样传播、授权前置 |
| Codex | 集成分支 Git 历史 | 公共契约、受管理的原生进程、能力装配、宿主文件策略、真实 Loader/Profile 验收及发布包 |

原工具箱源码基线为 `575075139fddc8b96d8db1a313c2fe404959c108`，原应用版本 `0.1.3-beta`。原 C 盘项目保持只读。当前插件版本另行编号为 **0.1.0-alpha.2**。

## 实际提供的功能

- `toolbox_status`：真实连接、原生版本、capabilities 与模块可用状态。
- `toolbox_note_create/search/update`：工作区隔离 SQLite、关闭状态创建、分页搜索、版本冲突检查。不会创建桌面便笺窗口。
- `toolbox_image_convert`：PNG/JPEG/WebP/BMP/ICO 的真实转换。仅在 `enableImages:true`、显式读写根、宿主 fs 服务和原生能力均满足时注册。

便笺创建一次事务写入 `is_open=0`。标题、正文、单调安全整数版本令牌和 expected CAS 在一次事务中提交；注入提交前失败会整体回滚。原桌面 API 及其十项既有回归保留。

Host 使用实际 `ctx.subprocess` Provider 启动随包 exe，等待 Named Pipe ready 后注册业务工具。卸载停止新请求、处理在途调用、请求原生关停、等待受管理进程范围退出并关闭连接，必要时有限时终止自己拥有的进程。异常退出后撤销业务工具，通过重载恢复；不自动重试写操作。

取消请求发送后保留 pending，等待原生权威终态。已经提交的成功不会被传输层或工具工厂改成取消；宽限期耗尽或终态前断线为 `OUTCOME_UNKNOWN`。实际测试也证明：Harness 外层仍可能在原生写入已提交后报告 ABORTED，因此取消不代表回滚，重试前应查询实际状态。

## 审查中补齐的缺口

1. 对齐分页、Unicode scalar 和控制字符边界；额外统一 Rust/JS 对 NEL、BOM 的空白判断。
2. 拒绝非法 UTF-8、数组信封、未知字段、畸形 ready/response/event；保留同批粘包中的后续帧。
3. 取消与超时等待权威终态；close 等实际 close 事件并清理定时器和 signal 监听器。
4. 原生入站通道改为容量 1 的背压通道；退出 abort 并 await reader。原生排队请求 16、未匹配取消 ID 32；集成层客户端在途上限收紧为 32。
5. 测试夹具去掉 Cursor 路径硬编码，使用当前项目 `.tmp`，删除前检查范围。
6. 便笺双次提交改为原模块公开的最小 headless 事务接口。
7. 图片以同目录独占 staging 和不覆盖的硬链接发布。Codex 将发布判断改成真实硬链接成功时的标记，去掉按文件长度猜测成功的逻辑，并验证发布后清理报错仍保留已提交成功。
8. 真实 E2E 复现并修复原生 `trim()` 改掉 Unicode 文件名末尾的问题；保留合法 Unicode 后缀，拒绝 Win32 会规范化掉的末尾 ASCII 空格/点。
9. 首次隔离安装曾在 5 秒冷启动窗口下超时；默认窗口改成 15 秒。最终新包和新 Profile 验收通过。

## 验证结果

| 验证层 | 实际结果 |
| --- | --- |
| Node 完整套件 | **92 通过，0 失败/跳过**：37 桥、42 工具、13 Host/Loader/E2E |
| Rust 三个相关 crate | **43 通过，0 失败，1 ignored**：桥 19 库 + 4 IPC；媒体 7 库 + 1 lifecycle + 1 已安装 FFmpeg；便笺 11 |
| 原生最终路径修正 | 定向原生路径测试通过；重新 release、打包后完整 Node 92 项通过 |
| 实际 Loader 生命周期 | 同一数据目录连续 20 次装卸；无重复工具；等待进程退出后可重新取得锁 |
| 异常路径 | 配置错误、缺少 exe、第二实例锁冲突、所属进程异常退出及替换恢复 |
| 文件策略 | 实际 Local/Sandboxed FS、read-only 拒绝、workspace-write 允许、junction 越界拒绝、write-intent 拒绝 |
| 图片 E2E | 五种格式文件头和 2×2 尺寸；已有输出原字节不变、越界拒绝、坏输入无输出、Unicode 精确路径、无 staging 残留 |
| 真实 CLI 从 tgz 启动 | 创建/搜索/更新、退出、重启查询、alpha.1→alpha.2 升级后查询、配置重载、五种格式转换、卸载配置消失且数据库保留 |

ignored 项要求用户显式指定 `ALL_IN_ONE_QA_MEDIA_INPUT`；本轮没有选择用户视频。符号链接用例在 Windows 返回 1314（无创建符号链接特权）时允许该分支，junction 用例实际执行。没有执行桌面窗口、剪贴板、截图或硬件采集测试。

CLI 验收使用本机已安装的 **Harness 0.2.2-rc.1**、Cordis 4.1.0、Node 24；不请求 LLM。开发 Node 为 24.17.0，安装器自带 pnpm 11.28.5，使用 D 盘 v11 store。安装器仍打印 peer warning；实际加载与执行已验证，不据此宣称其他宿主版本兼容。

首次完整包验收日志在集成工作树的 `artifacts/package-acceptance/3adcf5a1-ae8a-4aa4-bf00-f032e6b65d26/`。其中 install/create/restart/upgrade/upgraded-restart/images/remove 日志分别记录包管理、运行与清理，配置 dump 不替代实际启动。

## 发布物与复现

产物：`dist/dsh-toolbox-0.1.0-alpha.2.tgz`，2,109,907 字节。

- tgz SHA-256：`f0614823d0735fec59b81dda276363e1fb92e5878a64476d4c7daaaafb08d9ed`
- 原生 exe SHA-256：`5778cf702d7fc57111cea7586d777ed6a0df1d222cd0ef9f113854ae1e0df6b0`
- 原生源码提交：`bae5c9e4c4549f4b0bd246dd053040c301dbeab6`

包内只有 ESM lib、README、package.json、Bundle Patch、原生 manifest 和 Windows x64 exe，共 15 个文件。没有开发 SDK、node_modules、工作树、数据库、测试夹具或安装期构建脚本；Patch 没有本机源码绝对入口。manifest 分别记录插件/宿主/协议版本、平台架构、原生源码 SHA 和二进制哈希。

在项目根 PowerShell：

```powershell
. ./scripts/Use-ProjectEnvironment.ps1
cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p dsh-bridge -p mod-sticky-note -p mod-media-proc --locked --offline
./scripts/Build-Package.ps1
node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs
./scripts/Test-PackagedPlugin.ps1 -Package ./dist/dsh-toolbox-0.1.0-alpha.2.tgz -Images
# 若保留上一版包，可附加 -PreviousPackage ./dist/dsh-toolbox-0.1.0-alpha.1.tgz
```

验收脚本强制使用新建的项目内 DSH_HOME、dataDir 和 workspace-write 模式，避免继承日常数据目录。生成数据保留用于检查；不修改用户日常 Profile。构建使用各工作树独立 build/.tmp/runtime，复用 D 盘工具和依赖缓存，E 盘 Harness 只读。

## 使用边界与后续

当前是 Windows x64 本机 alpha。图片输出文件系统必须支持硬链接；路径解析可识别 junction/symlink，但不对抗同用户在检查后恶意替换目录。只配置可信根目录。旧应用数据尚未导入，其余八个模块未接入；外部发布前仍需第三方许可清单、额外系统运行库与更多系统兼容性验收。

正常失败和合作取消的 staging 清理已测试；崩溃或强制终止后的 staging 自动扫描恢复尚未实现，未承诺此时没有临时文件遗留。

本轮 SDK 提取脚本曾将一份开发 SDK 副本写到 `D:\Code\vendor`。路径计算已修正，实际构建使用项目内副本。迁回并清理误放副本的操作被自动审批拒绝，返回 `blocked by policy`，没有执行；该额外副本目前保留，不参与构建或发布包。
