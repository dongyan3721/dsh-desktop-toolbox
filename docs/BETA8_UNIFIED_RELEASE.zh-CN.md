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

- 本地 Node：194 通过，9 项 Windows 专用真实 exe 用例在 Mac 明确跳过。
- 新增共同交付、缺失 Windows 资源、伪装架构和无安装平台过滤的回归测试。
- Windows 构建、原生 / SDK 回归与同一公开 commit 安装已通过；公开 tag / Release URL 在发布后继续复验。

## 构建中发现并修复的问题

Windows 首次从当前源码构建发现 `IsWindow(HWND)` 与 windows 0.62.2 的签名 `IsWindow(Option<HWND>)` 不符，位置是截图排除窗口的存活检查。已改为 `IsWindow(Some(hwnd))`，随后双方均从原生源码提交 `4f30a6a6296e5a38c03adf38912501428861bbce` 重建。

Mac 重建成功，签名严格校验通过，二进制 SHA-256 仍是 `0480e7e4b0ae9b5fed00d6e4d167ff8cbc7eedea8f96c75294006055e34f3b2c`；该修复位于 Windows cfg 分支。Mac 原生测试：Host 84 通过；OS HAL 21 通过、1 项硬件测试忽略。Node 最新完整回归：194 通过、9 项 Windows 专属 exe 测试跳过。

Windows 当前源码编译已在 CI run `43613256520` 通过，随后进入原生回归和 SDK 阶段。首次 run `43612390958` 的类型错误不计通过；最终结果以完整成功运行及实际安装验收为准。


## 双方共同安装包验收：通过

同一包 `dsh-toolbox-bundle@0.1.0-beta.8` 共 35 项运行时文件，原生源提交均为 `4f30a6a6296e5a38c03adf38912501428861bbce`：

| 目标 | 程序 SHA-256 |
| --- | --- |
| Windows x64 | `a84fc6c11419d5d5d50f38bd1356c58911f421e5286f33a0c2dd7864b679caec` |
| macOS arm64 | `0480e7e4b0ae9b5fed00d6e4d167ff8cbc7eedea8f96c75294006055e34f3b2c` |

统一 tgz SHA-256：`6dbc8a92bc6712c1b4ed04136b0bfdfaf7875e7c1cfeb3ab77ea7607dcb25764`。双方使用同一个安装 URL，无运行时下载另一平台资源、Rust 编译或安装脚本。

### Windows 实测

[完整构建与回归 run 43615895675](https://github.com/dongyan3721/dsh-desktop-toolbox/actions/runs/43615895675) 成功：当前源码编译、235 项原生测试通过 / 4 项忽略；203 项 Node/SDK 测试中 201 通过、2 项 NTFS 不支持的 POSIX 执行位检查跳过。官方 Windows Harness 0.2.2-rc.3 安装包已按发布 feed 的 SHA-512 校验，仅解压和提取 SDK，没有运行安装器。

[实际完整包安装 run 43674358382](https://github.com/dongyan3721/dsh-desktop-toolbox/actions/runs/43674358382) 成功：使用未修改的官方 `dsh` CLI，导入公开 commit `30c868c5eadcdcf9e763c67629a125a66e3835ee`。Client 和拥有的原生子进程均断言来自隔离 profile 的已安装包。

- 默认五授权关闭、没有 toolbox Agent 工具。
- 在 OS 提供的 Hyper-V 虚拟显示器 1024×768 上返回 32×32 截图附件；这不是物理多屏或各 DPI 的硬件验收。
- 系统剪贴板中文 / Emoji 写入、搜索、读取通过。
- 原便笺窗口更新 `display_sync=applied`，重启后内容保持。
- 原生屏幕标注画布绘制、穿透、PNG 附件、清空和停止通过。
- 真实应用时长由 6 秒增至 11 秒，小时统计匹配；未保存窗口标题。
- 五项分别撤权后旧引用拒绝；关闭模块保留授权但拒绝调用。最终五授权关闭，退出后原生进程数为 0。

先前 SDK 回归 run 43613256520 的 6 项失败来自参考模块未复制与 NTFS 执行位假设，已修正并由完整成功 run 覆盖；没有移除架构、完整性或真实进程检查。

### macOS 实测

本机已安装的 Harness 0.2.2-rc.3 分别导入同一 tgz 与同一公开 commit。35 文件校验、唯一 Client、默认五授权关闭、真实安装目录及原生执行路径均通过。完整五模块、全部撤权边界、便笺重启持久化通过，原生 app 严格签名校验通过。

最初测试时没有活动显示器，脚本在空列表读取 monitor.id 失败，不计通过。已补充明确的活动显示器断言，桌面恢复活动后在新的隔离数据 `mac-local-2` 完整重跑成功，没有伪造监视器或截图。

机器证据在本工作区 `artifacts/beta8/`。Windows 是 GitHub 托管虚拟桌面，Mac 是本机 Retina；不宣称 Intel、其他原生架构、全部物理快捷键、多屏、首次系统授权或所有十模块已重新验收。五模块用实际工具链执行，未声明模型自动选择工具已验收。
