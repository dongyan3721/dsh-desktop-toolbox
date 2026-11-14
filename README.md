# DSH Toolbox

DeepSeek Harness 桌面工具箱插件，保留原生主控台、便笺、屏幕标注等功能窗口。当前 **0.1.0-beta.7** 面向 **macOS Apple Silicon（arm64）**，配合 DeepSeek Harness **0.2.2-rc.3 / Node 24**。本轮暂不拆分独立桌面服务。

A desktop toolbox plugin for DeepSeek Harness. **0.1.0-beta.7** targets **macOS Apple Silicon (arm64)** and Harness **0.2.2-rc.3 / Node 24**. It includes the native desktop app and browser Client in one bundle.

Windows x64 请继续使用 [beta.6](https://github.com/dongyan3721/dsh-desktop-toolbox/releases/tag/v0.1.0-beta.6)。beta.7 不声明 Windows 或 Intel Mac 已验收；历史 tag 和发布文件保持不变。

## 安装

在 Harness 客户端的「插件 → 添加插件」输入以下 GitHub URL，安装后启用：

```text
https://github.com/dongyan3721/dsh-desktop-toolbox#v0.1.0-beta.7
```

也支持单个预构建 Release 包的 URL 或下载后导入：

```text
https://github.com/dongyan3721/dsh-desktop-toolbox/releases/download/v0.1.0-beta.7/dsh-toolbox-bundle-0.1.0-beta.7.tgz
```

完整包包含 Host、Client、原生 `.app`、图标和完整性清单。不需要本机 Rust、不执行安装脚本、不要求放宽 pnpm 策略。GitHub 自动生成的 Source code 归档不是安装包。校验和见 [Release](https://github.com/dongyan3721/dsh-desktop-toolbox/releases/tag/v0.1.0-beta.7)。

In Harness → Plugins → Add plugin, paste the GitHub URL above. The complete bundle needs no Rust compiler or install hooks. You may also import the single release `.tgz` URL. Do not install the development Host and Client packages alongside this bundle.

从旧双包升级：正常退出工具箱，移除 `dsh-toolbox` 和 `dsh-toolbox-client`，再安装完整包。保持原数据路径；卸载保留数据和授权设置。无法热加载的实例需重启 Harness。

这是开发者 beta：原生程序有本机构建签名，尚无 Developer ID 公证。截图仍受 macOS「屏幕与系统音频录制」权限约束，授权必须由使用者决定；插件不会自动申请或绕过系统权限。验收机已有录屏许可，不能据此声称干净系统上的首次授权流程已通过。

## 五个 Agent 模块

新配置只启用便笺。功能启用和「允许 Agent 访问」是两项独立、持久化设置，**所有 Agent 授权默认关闭**。在侧栏「工具箱」的主控台中按需开启功能，再单独授权。

| 模块 | Agent 工具 | 功能 |
| --- | --- | --- |
| 截图 | `toolbox_screenshot` | 枚举真实显示器、区域截图和图片附件；Retina 使用物理像素坐标 |
| 屏幕注释 | `toolbox_screen_ink` | 原生画布启停、绘制、穿透、截图与清空 |
| 便笺 | `toolbox_notes` | 创建、搜索、读取、打开及带版本检查的更新，同步原便笺编辑器 |
| 剪贴板 | `toolbox_clipboard` | 系统文本写入、历史搜索和读取，与原界面共享记录 |
| 应用使用时长 | `toolbox_usage` | 系统前台应用采样、概览和小时统计，与原界面共享数据 |

The five tools share the original native kernel and data after explicit access grants. Revoking access withdraws the tool and rejects old references. Disabling a module preserves its grant but blocks its operations. Other modules (media processing, window pinning, scripts, translation and password vault) do not support Agent access.

本次五模块验收不等于已验收全部人用功能。全局快捷键的物理键盘触发、多显示器、Intel、Windows beta.7、干净系统首次授权、其他五模块均不作为本版已通过项目。模型能否选择工具仍取决于用户的模型及对话配置；发布包无需内置 API Key。

## 数据与生命周期

显式绝对 `dataDir` 优先，其次是 `DSH_TOOLBOX_DATA_DIR`；否则使用 `DSH_HOME/toolbox-desktop-data`，没有 `DSH_HOME` 时使用用户主目录 `.dsh/toolbox-desktop-data`。不自动导入独立工具箱或其他个人数据库。关闭主窗口不等于退出插件；Harness 卸载插件会保存数据并结束自己拥有的原生进程。

## 开发与验收

仓库的 `native/YourAllIn1Helper` 是本版原生实现，`packages/` 保留 Host / Client 开发包，根 `distribution/` 是随 Git tag 提交的完整预构建插件。发布包运行时不依赖独立桌面仓库。

macOS 构建或测试前执行：

```sh
source scripts/use-project-environment.sh
node scripts/build.mjs
npm test
```

构建原生程序见 `scripts/build-desktop-macos.sh`。装配发布包使用 `scripts/bundle-desktop-macos.mjs`、`scripts/bundle-github.mjs` 和 `scripts/pack-release.mjs`；先提交构建输入，才能生成带 Git 来源的清单。资源按声明的平台打包，Windows 的历史程序不会混入 macOS 包。

验收使用安装版 Harness 和工作区内的隔离 profile，不读取个人数据库或复制凭据。详细证据见 [macOS 验收记录](docs/MACOS_ACCEPTANCE.zh-CN.md) 和 [beta.7 发布验收](docs/BETA7_MACOS_RELEASE.zh-CN.md)。
