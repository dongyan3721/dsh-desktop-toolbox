# DSH Toolbox

DSH Toolbox 是作者自用的面向日常使用的 Windows 桌面工具箱，作为 DeepSeek Harness 插件运行。它保留原有主控台、功能窗口、托盘和全局快捷键；人的操作不依赖模型请求。当前发布版本为 **0.1.0-beta.5**。

DSH Toolbox is a Windows desktop toolbox for the owner's everyday use, packaged as a DeepSeek Harness plugin. It keeps the original console, feature windows, tray icon, and global shortcuts. Human actions do not require a model request. The current release is **0.1.0-beta.5**.

## 概述 | Overview

工具箱在 Harness 侧栏中直接打开。主控台与独立主窗口使用同一套原生内核和数据。关闭主窗口后，托盘和已注册的快捷键仍然有效；完全退出请使用应用菜单或托盘中的退出命令。

The toolbox opens from the Harness sidebar. The console and the standalone main window share one native kernel and one data store. Closing the main window leaves the tray icon and registered shortcuts running. Use the application menu or the tray command to exit completely.

本版发布两个必须成对安装的包：

This release ships two packages, and they must be installed together:

| 包 Package | 作用 Role |
| --- | --- |
| `dist/dsh-toolbox-0.1.0-beta.5.tgz` | Host。桌面服务、十个功能模块和 Agent 工具。Host. Desktop service, ten feature modules, and Agent tools. |
| `dist/dsh-toolbox-client-0.1.0-beta.5.tgz` | Client。Harness 侧栏入口和内嵌主控台。Client. Harness sidebar entry and embedded console. |

校验和见 [`dist/SHA256SUMS-0.1.0-beta.5.txt`](dist/SHA256SUMS-0.1.0-beta.5.txt)。历史版本的包和 tag 均保留，不被本版覆盖。

Checksums are listed in [`dist/SHA256SUMS-0.1.0-beta.5.txt`](dist/SHA256SUMS-0.1.0-beta.5.txt). Packages and tags from earlier releases remain in place and are not replaced.

声明的运行环境为 Windows x64、Node 24，以及 DeepSeek Harness `0.2.2-rc.1` 或 `0.2.2-rc.3`。beta.5 的界面验收使用已安装的 Harness `0.2.2-rc.3`。

The declared runtime is Windows x64, Node 24, and DeepSeek Harness `0.2.2-rc.1` or `0.2.2-rc.3`. The beta.5 interface was accepted on an installed Harness `0.2.2-rc.3`.

## 功能 | Features

新配置只启用便笺。其余功能可在主控台中单独开启。功能开关和“允许 Agent 访问”是两项独立设置；Agent 授权默认关闭。

A new configuration enables sticky notes only. Every other feature can be turned on from the console. The feature switch and “Allow Agent access” are independent, and Agent access is off by default.

| 模块 Module | 说明 Description | Agent |
| --- | --- | --- |
| 增强截图与贴图 Screenshot | 区域截图、长截图、GIF 和 OCR。Region capture, scrolling capture, GIF, and OCR. | 支持 Supported |
| 剪贴板管理 Clipboard | 文本和图片历史。Windows 上记录剪贴板所有者应用名；无法取得时保留为空，不回填旧记录。Text and image history. On Windows, the owning application's name is recorded; when it cannot be determined, the source stays empty and older rows are not backfilled. | 支持 Supported |
| 桌面屏幕注释 Screen ink | 屏幕标注与鼠标穿透。On-screen annotation and mouse passthrough. | 支持 Supported |
| 桌面置顶便笺 Sticky notes | Markdown 便笺。搜索、读取、创建和带版本检查的更新；打开中的编辑器先同步再写入。Markdown notes. Search, read, create, and version-checked updates; an open editor is synchronized before a write. | 支持 Supported |
| 应用使用时长 App usage | 应用使用统计。Application usage statistics. | 支持 Supported |
| 自定义脚本 Scripts | 由人运行或通过快捷键触发的脚本。Scripts run by a person or by a shortcut. | 不支持 Not supported |
| 全局划词翻译 Translator | 翻译所选文字。外部服务需自行配置。Translation of selected text. An external service must be configured separately. | 不支持 Not supported |
| 基础多媒体处理 Media | 基础媒体处理。Basic media processing. | 不支持 Not supported |
| 窗口置顶 Window pin | 将外部窗口保持在最前。Keep an external window above other windows. | 不支持 Not supported |
| 生物识别密码本 Password vault | 本地密码本。系统认证需由使用者另行确认。Local vault. System authentication requires separate confirmation by the user. | 不支持 Not supported |

获得授权的 Agent 与人使用同一桌面内核。撤回授权、关闭功能、断开连接或卸载之后，旧的工具调用不再继续访问数据。

An authorized Agent uses the same desktop kernel as the person. After access is revoked, a feature is disabled, the connection drops, or the plugin is removed, earlier tool calls can no longer reach the data.

## 快捷键 | Shortcuts

偏好设置中可以查看、修改和重新检测全局快捷键。诊断会区分内部冲突、非法组合、系统保留、系统拒绝、注册占用、探测失败和尚未检测。内部冲突标出模块、动作或脚本。系统错误 1409 只说明该组合键已被注册。

Shortcuts can be reviewed, changed, and checked again from Preferences. Diagnosis distinguishes an internal conflict, an invalid combination, a system reservation, a system refusal, an existing registration, a failed probe, and a check that did not run. An internal conflict names the module, action, or script. System error 1409 means only that the combination is already registered.

Windows 的 `RegisterHotKey` 不返回占用该热键的进程。界面在没有可靠证据时写明“系统未提供占用程序信息”，并给出更换组合键、退出相关程序后重检等排查步骤。它不会把前台程序或常见软件显示为已确认的占用者，也不会自动改键或关闭其他程序。

Windows `RegisterHotKey` does not return the process that holds a hotkey. Without reliable evidence, the interface states that the system did not identify a program and offers steps such as choosing another combination or quitting related programs and checking again. It does not present the foreground process or a familiar application as a confirmed owner, and it does not change the binding or close another program automatically.

## 数据 | Data

数据目录必须是绝对路径。显式的 `dataDir` 优先，其次是 `DSH_TOOLBOX_DATA_DIR`。两者都未设置时，使用 `DSH_HOME/toolbox-desktop-data`。普通客户端没有 `DSH_HOME` 时，桌面组件使用用户主目录下的 `.dsh/toolbox-desktop-data`。相对路径会被拒绝。已有个人数据不会自动导入。

The data directory must be an absolute path. An explicit `dataDir` takes priority, followed by `DSH_TOOLBOX_DATA_DIR`. When neither is set, the directory is `DSH_HOME/toolbox-desktop-data`. If a normal client has no `DSH_HOME`, the desktop component uses `.dsh/toolbox-desktop-data` under the user profile. A relative path is rejected. Existing personal data is not imported automatically.

卸载会停止本工具箱自己的进程并保留数据。无法确认数据已保存，或必须强制结束进程时，卸载报告失败。

Removal stops the toolbox's own processes and keeps the data. If a save cannot be confirmed, or a process would have to be killed, removal fails.

## 安装与升级 | Install and upgrade

在 Harness 的插件页面安装上述两个同版本包，或使用等价的 `dsh plugin --profile desktop add`。安装后从侧栏进入工具箱。

Install both packages of this version from the Harness plugin page, or with the equivalent `dsh plugin --profile desktop add`. Open the toolbox from the sidebar afterward.

在 Windows 上替换正在运行的程序前，先从“应用 → 退出”正常退出 Harness，避免可执行文件被占用而无法替换。升级不覆盖更早的发布包。

On Windows, exit Harness with Application → Exit before replacing a running build, so the executable is not locked. An upgrade does not overwrite an older release package.

## 开发 | Development

原生桌面实现位于 `native/YourAllIn1Helper`，Harness 插件位于 `packages/dsh-toolbox` 和 `packages/dsh-toolbox-client`。发布物运行时不需要 Rust，也不需要编译原生代码。

The native desktop implementation is in `native/YourAllIn1Helper`. The Harness plugin is in `packages/dsh-toolbox` and `packages/dsh-toolbox-client`. A published package does not need Rust or a native compile step at install time.

构建机需要 Node.js 24、pnpm、Rust stable（`x86_64-pc-windows-msvc`）、Visual Studio 2022 的 C++ 桌面开发工作负载，以及 WebView2 Runtime。在仓库根目录的 PowerShell 中执行：

A build machine needs Node.js 24, pnpm, Rust stable (`x86_64-pc-windows-msvc`), the Visual Studio 2022 Desktop development with C++ workload, and the WebView2 Runtime. From the repository root in PowerShell:

```powershell
. ./scripts/Use-ProjectEnvironment.ps1
./scripts/Build-Package.ps1
npm test
```

`Build-Package.ps1` 构建 Vue 界面、带 `tauri/custom-protocol` 的桌面 release，以及用于协议回归的 headless release，并生成完整性清单。已提交的同版本归档不会被覆盖。SDK、工作树和测试数据库不进入安装包。

`Build-Package.ps1` builds the Vue interface, the desktop release with `tauri/custom-protocol`, and the headless release used for protocol regression, then writes an integrity manifest. An existing archive of the same version is not overwritten. The SDK, worktrees, and test databases are not included in the package.

## 本版范围 | Scope of this release

beta.5 在 beta.4 之上完成四项修正：Harness 内嵌原主控台、快捷键冲突诊断、Windows 剪贴板来源，以及从生产包移除旧便笺实现。自动回归 519 项通过，并在受控的 Windows 环境中验收了界面、真实热键、剪贴板来源和退出清理。

Beta.5 adds four changes on top of beta.4: the original console embedded in Harness, shortcut-conflict diagnosis, Windows clipboard source attribution, and removal of the legacy notes implementation from the production package. The automated regression contains 519 passing tests. A controlled Windows session also accepted the interface, real hotkeys, clipboard sources, and exit cleanup.

以下项目不作为 beta.5 的通过项：密码本与 Windows Hello 的人工验收、外部翻译服务、多显示器和不同缩放比例、个人旧数据迁移，以及十个模块的长时间稳定性。macOS 上的剪贴板来源查询尚未实现。对外发布前仍需单独的兼容性和许可审计。

The following are not accepted items of beta.5: manual acceptance of the vault and Windows Hello, an external translation service, multiple monitors and scale factors, migration of personal data, and long-run stability of all ten modules. Clipboard source lookup is not implemented on macOS. A separate compatibility and license review is still required before distribution outside this project.

验收命令、证据和限制见 [beta.5 验收记录](docs/BETA5_ACCEPTANCE.zh-CN.md)。更早的发布记录见 [beta.4](docs/BETA4_DESKTOP_DATA_DIR.zh-CN.md)、[beta.3](docs/BETA3_DSH_RC3_DECLARATIONS.zh-CN.md)、[beta.1](docs/BETA1_ACCEPTANCE.zh-CN.md) 和 [H1 桌面验收](docs/INTEGRATION_H1.zh-CN.md)。

Commands, evidence, and limits are recorded in the [beta.5 acceptance report](docs/BETA5_ACCEPTANCE.zh-CN.md). Earlier release records are [beta.4](docs/BETA4_DESKTOP_DATA_DIR.zh-CN.md), [beta.3](docs/BETA3_DSH_RC3_DECLARATIONS.zh-CN.md), [beta.1](docs/BETA1_ACCEPTANCE.zh-CN.md), and the [H1 desktop acceptance report](docs/INTEGRATION_H1.zh-CN.md).

## 许可 | License

本项目采用 [MIT License](LICENSE)。

This project is licensed under the [MIT License](LICENSE).
