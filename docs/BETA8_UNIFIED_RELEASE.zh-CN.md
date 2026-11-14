# beta.8：Windows / macOS 统一交付

用户要求同一个插件版本同时支持双方平台。本版取代 beta.7 的平台分版方式：Windows x64 与 macOS arm64 共用一个 GitHub tag、一个完整包和一个版本号。

## 发布要求与实现

- 根包、Host、Client 统一 `0.1.0-beta.8`；JavaScript 包不再设置 `os` / `cpu` 安装过滤。
- 原生平台与 JavaScript 安装资格分开。`dshToolbox.nativeTargets` 明确列出 `win32-x64`、`darwin-arm64`，避免 os/cpu 数组的笛卡尔积意外要求尚未构建的架构。
- 同一完整包携带 Windows `.exe` 与 macOS `.app`，Host 按实际平台选择唯一程序；每项各有来源 revision、协议版本和 SHA-256。
- Windows 必须从当前原生源码构建，不直接复用 beta.6 的旧 exe。Mac 沿用同一原生源码 revision 的已验收 app，再生成插件 beta.8 清单。
- 装配前验证声明目标齐全，验证 Windows x64 PE / macOS arm64 Mach-O；拒绝缺失、混版本和错误架构。正式完整包不带旧 headless 测试程序。
- 保留五模块默认 OFF 授权、原 GUI 内核、存储及卸载行为。没有新增安装脚本或 pnpm 策略豁免。
- beta.7 与更早 tag/资产不变。今后维护统一版本，不按两套系统推荐不同的当前版本。

## 验收流程

1. GitHub Windows runner 编译当前 native 源码、原 Vue UI、历史协议测试 fixture，运行原生回归。
2. 校验官方 Harness Windows 0.2.2-rc.3 安装包 SHA-512，只解压应用文件，从 Electron 的 ASAR 提取实际 SDK；不运行安装器，不读用户数据。
3. 在 Windows SDK 上运行 Node 回归，测试统一发布包的导入、实际原生路径与生命周期。
4. Mac 装配同一完整包，进行实际 Harness 的隔离 profile、五模块、授权边界与持久化验收。
5. 发布后在双方平台复验同一 tag / tgz；核对公开资产摘要与本地包完全相同。

验收中使用 workspace 下的 profile、缓存与测试数据；profile 目录中准备 package.json 作用域，阻止祖先仓库同名包自引用。安装路径和实际原生子进程路径必须来自被验收的安装目录。

## 当前进度

- 本地 Node：193 通过，9 项 Windows 专用真实 exe 用例在 Mac 明确跳过。
- 新增共同交付、缺失 Windows 资源、伪装架构和无安装平台过滤的回归测试。
- Windows 原生构建 / SDK 验收及最终公开安装结果待本轮实际运行后补充；不提前标为通过。
