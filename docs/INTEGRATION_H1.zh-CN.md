# H1 人用桌面集成与验收

2026-11-13，Codex 集成三位本机 Agent 的交付并完成实际验收。结果：人用纵向流程已贯通，交付本机预览 `0.1.0-alpha.6`，不是十模块全部完成迁移的正式版。

## 可直接试用

当前已登录的隔离 Electron Harness 已安装两个同版本包，侧栏“工具箱”可打开原 Tauri 主窗。关闭主窗保留托盘和快捷键。预览默认仅启用便笺，其他模块保留原界面和快捷键定义，待 H2 逐项验收。未自动导入旧项目数据。

在主工作区重新打开同一预览：

```powershell
./scripts/Open-HumanPreview.ps1
```

脚本读取本机生成、Git 忽略的 `runtime/human-preview.json`。本次的登录状态、Harness Profile、WebView、便笺和临时数据都保留在 `D:/Code/dsh-toolbox/.worktrees/integration/runtime/human-acceptance/ca906b17-4ac6-49cf-809d-aa6ec97bd443/`。此目录现包含用户登录后的状态，不应当作可随意清理的临时目录。启动脚本不读取凭据，也不操作日常 Profile。

安装包位于主工作区 `dist`，需同时安装 Host 与 Client：

- `dsh-toolbox-0.1.0-alpha.6.tgz`，16,162,327 字节，SHA-256 `20825c18c1015b1cefaa454aac2cb60bcfb1ed5e7d3f41999d8f755a896628f5`。
- `dsh-toolbox-client-0.1.0-alpha.6.tgz`，4,317 字节，SHA-256 `ba103c097f14b16ce224e65147219a6b7e197499473d315a78489bdcf34823ad`。
- `dsh-toolbox-0.1.0-alpha.6.manifest.json` 记录版本、源码、二进制哈希和归档校验。

**命令行升级/替换前，先从“应用 → 退出”正常退出 Harness。** 本次在原生 exe 运行时直接执行 pnpm 热升级遇到 Windows EPERM；正常退出后重试成功，登录、会话与便笺保留。实时移除另已单独验证通过。没有验证内置 Plugins UI 自己的升级流程，不能把 CLI 的行为推断为该界面的行为。

## 集成交付与修复

- Cursor：`be5d8b7`、`af3a890`，原 Tauri 正式插件模式、一个 DesktopHost/AppKernel、私有控制管道、原快捷键与保存退出。
- Antigravity：`a4f1637`、`dad6b70`，原 Vue/IPC/快捷键对等证据；核对后无需改写前端。Codex 又纠正了 OCR 单测覆盖描述。
- Zed：`b3a6592`、`54af057`，实际外部 Client 装载、侧栏/main slots、入口适配、中文错误及 SDK 验证。
- Codex：独立无 tools 依赖的桌面服务、所有权/生命周期、公开导出、构建装配、真实 Profile/窗口/键盘/模型共存验收。

集成时修复了三项实际缺口：

1. 先取得数据目录实例锁，再准备新配置；失败的重复启动不创建/覆盖配置。新增回归通过。
2. 直接 Cargo Release 构建必须传 `--features tauri/custom-protocol`。最初真实窗口出现 localhost 连接错误；修正后加载内置 `tauri.localhost` 页面，不需要 Vite 服务。
3. 已安装 SDK 的 `connection.rpc.handle` 在独立 provider 的 shadow context 中读 `webServer`，仅增加消费者注入仍不能激活。改用公开的 Connection exact Fetch 路由 `/api/toolbox-human/{status,showMain,openPanel}`；浏览器继续用实际 Connection RPC 生成/校验相关 ID 和信封。宿主统一负责认证、Host/Origin、owner 身份和断线取消。请求流有 4096 字节上限；没有修改 Harness 核心或增加未认证监听器。

alpha.3/.4 是实际 Profile 激活失败时的内部候选，不作为交付。alpha.5 完成 Web/Electron 验收；alpha.6 更新发布说明和版本元数据。已逐文件比对 15 项 Host JS/原生/人用 patch 载荷及两个 Client JS 文件，alpha.6 与已测试 alpha.5 完全相同，并实际安装、正常退出升级、重开和点击验证了 alpha.6。

归档源码提交 `535484b`，运行代码提交 `fe9bc1f`；原生源码 `785f999c9c87f58d90453d4558090354fcf878bf`。桌面 exe 35,893,248 字节，SHA-256 `dbcbb01ddffec58ea8a58fa622050acb493cd3e05c590251762148a6815eef1c`；headless exe SHA-256 `5fa112fb4249380068c3133d523863a8e555fb29bd10bffede384676c4af5d81`。冻结 alpha.2 tgz 的原哈希 `f0614823d0735fec59b81dda276363e1fb92e5878a64476d4c7daaaafb08d9ed` 未变。

## 自动测试与构建

共 **311 项通过，0 失败**：

| 范围 | 结果 | 实际覆盖 |
| --- | --- | --- |
| JS / 集成 | 124 通过 | 实际 Loader/原生桥、20 次装卸、桌面控制夹具、真实 SDK Client 信封、独立 provider Host 精确路由及移除、畸形/超大请求、非 owner 拒绝和取消 |
| 原 Vue | 103 通过 | 原组件 fake/工具函数、便笺保存/冲刷、录入/冲突/清除；不是全部 OS 功能的实测 |
| Rust 桌面宿主库 | 65 通过 | 原 IPC、偏好/冲突/回滚、插件参数、实例锁、控制会话、保存和窗口路由 |
| Rust 原生桥库 | 19 通过 | 原协议、事务、背压、取消、路径/图片和所有权回归 |

Vue `vue-tsc --noEmit` 与 Vite 生产构建通过；独立 `all-in-one-desktop` Release 构建通过。原有 os-hal / vault 编译 warning 保留。此次没有声称跑过整个 Rust workspace 的所有测试。

```powershell
. ./scripts/Use-ProjectEnvironment.ps1
node scripts/build.mjs
node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs
pnpm --dir native/YourAllIn1Helper/src-ui test
cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p all-in-one-host -p dsh-bridge --lib --release --locked --offline -j2 -- --test-threads=1
```

完整重新构建使用 `scripts/Build-Package.ps1`；同版本归档已存在时会拒绝覆盖。`Test-PackagedPlugin.ps1` 专用于旧 headless Bundle，对人用包会在安装前明确拒绝。显式桌面验收驱动为 `scripts/human-desktop-session.mjs`；它启动真实 GUI，不能混入日常自动测试。

## 真实交互验收

| 项目 | 观察结果 |
| --- | --- |
| 官方 Web 外部包装载 | 真实侧栏出现工具箱，点击显示已打开，同时原 Tauri 主窗出现；重复打开只有一个主窗 |
| 已登录 Electron | 相同包在真实 `dsh-app://app` 侧栏出现，点击打开原主窗，完整退出升级后登录与聊天保留 |
| 原主窗和便笺面板 | 原功能/偏好页、十模块卡片、独立便笺列表和窗口可见 |
| 保存/关闭/重开/重启 | 从原 UI 创建虚构便笺，编辑中文及 Markdown，关闭后归档，唤醒及新原生进程重启后正文完整；只读 SQLite 精确比对通过 |
| OS 全局键 | 在原偏好录入并保存 Ctrl+Alt+Shift+F9，关闭主窗、切到 Zed 前台后实际按键，新便笺出现；未调用 kernel_trigger_shortcut |
| 冲突、默认、局部键 | 给打开面板录入同一组合键，红色冲突且保存禁用；清除后两项恢复未设置；Esc 放弃、Tab 焦点导航通过 |
| 卸载/父退出 | 真实 Loader 关停、已连接父进程终止均释放自有窗口/进程；Web 移除重启与 Electron 实时移除后入口消失，数据保留，重装恢复 |
| 认证边界 | 实际 Electron Host 控制请求：无认证 401，错误 Origin 403；非 owner/超大/畸形请求另有实际 SDK 回归 |
| 普通模型共存 | 用户授权后，在已登录 Electron 的 DeepSeek-V4.1-Flash High 发出一条无工具测试，正常回复“模型连接正常。”，界面无工具调用 |

最终已恢复并打开 alpha.6 预览供用户试用。临时全局键已经清除，没有修改原 C 盘项目或读取其个人数据库。

验收日志和截图见主工作区 `artifacts/human-acceptance/ca906b17-4ac6-49cf-809d-aa6ec97bd443/`。原始宿主日志可能含临时启动 token，仅留在隔离工作树，未提交 Git。

## 仍待完成

H2 要逐个验证其余九模块的真实窗口、默认全局键、启停后观察器/快捷键生命周期，以及脚本/媒体等依赖配置；源码存在不等于这些流程已验收。H3 处理旧数据和用户配置导入。密码本凭据操作由用户本人手工验收。跨 Windows/缩放/多显示器兼容、强制终止后的恢复及完整第三方许可审计仍待后续。当前预览不宣称可完整替代旧工具箱；Agent 能力保持独立显式白名单。
