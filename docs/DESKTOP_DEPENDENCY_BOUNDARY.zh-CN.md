# 桌面程序与 Harness 插件的依赖边界

日期：2026-11-14。当前为本地探索与实现，未发布新的平台支持声明。

## 判断

两个项目应独立发版，通过版本化本机协议协作。不要将整个桌面源码持续复制进插件仓库，也不要将 app version 等同于协议兼容性。

已核实的输入：

- 独立仓库 `/Users/santa_antilles/Desktop/your_all_in_one`：`baeb3e423d222426ae9a7824b81cfb3b157bf8a6`，`0.1.4-beta`。
- 插件原生快照：基于桌面 `5750751` 的 `0.1.3-beta`，随后增加了私有控制通道、五模块 Agent 授权、原窗口协作、内嵌控制台等插件实现。
- 独立 `0.1.4-beta` 没有 `dsh-bridge`、`plugin_launch`、`plugin_host`、`agent_api` 和 `human_console`，不能直接替换现有快照。整树覆盖会丢掉授权和桥接能力。
- `0.1.4` 的主要新增项包括 macOS 签名更新/DMG、翻译浮窗边界修正、GIF 排除窗口销毁后停止。插件模式的更新职责应由安装方管理，不能直接开启独立程序的自动更新器。

## 推荐落地顺序

1. **桌面仓库拥有业务与桥接。** 将已有桥接、授权、原窗口协作作为可选集成模式上移到独立桌面仓库。普通启动仍是独立应用，不依赖 Harness 安装或 Node SDK。协议实现通过合成数据测试，默认授权 OFF。
2. **插件只拥有适配。** 保留 Harness Host/Client、Agent schema、图片 attachment 适配、安装和进程生命周期。普通 Node 运行时依赖与 Harness peers 分开，避免安装第二份 Cordis。UI 构建资源也应来自固定桌面 revision/发行产物，避免 Rust 已升级而内嵌 UI 仍是旧版。
3. **用不可变发行资产关联版本。** 桌面发布每个平台/架构的二进制及 manifest，记录独立 app version、源码 revision、协议版本、SHA-256 和 capability。插件记录已验证组合。更新通过新资产切换，握手失败明确拒绝；不覆盖历史 Release，不默默下载或自动重试副作用。
4. **撤掉双重源码所有权。** 上移完成且 Windows/macOS 回归通过后，把 `native/` 变为明确的开发 fixture/固定来源输入，停止作为第二套长期业务主线。若短期仍需源码构建，可用固定 commit 的 submodule 或归档；submodule只解决源码来源，不能代替协议和运行时兼容性检查。

## 本轮已提供的接入点

`toolbox-desktop` 的 Config 支持显式 `nativeExecutable`。本轮新增可选 `nativeManifest`，可独立固定外部桌面发行资产：

```yaml
- id: toolbox-desktop
  name: dsh-toolbox-bundle/desktop
  config:
    nativeExecutable: '/absolute/release/all-in-one-desktop'
    nativeManifest: '/absolute/release/desktop-manifest.json'
    dataDir: '/absolute/isolated/toolbox-data'
```

这是 Entry 形状示例；通过 Harness Patch 覆盖已有 Entry 时，按实际 identity 和完整 config 组合，不把此对象直接当作 Patch 顶层。

manifest 必须包含 `runtime:"desktop"`、`protocolVersion:1`、本机 `platform`/`architecture` 和二进制 `sha256`。启动前校验；之后仍要求真正的 v1 握手、桌面 status 和必要 capability。app version 可以独立变化，不要求与插件版本相同。单独使用 `nativeExecutable` 保留为本地开发覆盖；它不提供发行文件完整性校验。

默认资源保持按平台选择：Windows `win32-x64/*.exe` 使用原 manifest；macOS 使用 `darwin-arm64/` 或 `darwin-x64/` 下各自的 `All-in-One Toolbox.app/Contents/MacOS/all-in-one-desktop` 和同架构目录中的 manifest。必须保留整个 `.app` 的 Info.plist、图标与可执行权限，裸 Mach-O 不足以提供正常的 macOS 应用身份。缺少目标或资源必须失败，不回退运行 Windows 文件。本轮不把现有 Windows beta.6 根包的安装限制改成“macOS 已支持”。

## 生命周期与数据

当前接入是 **插件拥有的子进程**：显式隔离 dataDir、独占锁、随机端点、父进程校验、关闭先 flush，宿主退出后回收所属实例。桌面可独立维护并不意味着插件可以接管用户正在运行的应用；当前没有 attach 模式，不能连接/终止个人实例或共写其数据库。

未来若要复用常驻独立桌面服务，需另行实现人确认的配对、连接所有权、独立会话撤销与“卸载插件仅断开”的语义；不能继续沿用 `desktop.shutdown` 来关闭用户的独立桌面。默认授权与模块开关继续分离，五支持/五不支持范围不变。

## 验收要求

分别记录 app revision、插件 revision、Harness/Node 版本、平台/架构、来源 manifest/hash、安装来源、实际窗口/快捷键/授权/退出结果。协议夹具、构建成功、真实桌面和模型对话属于不同证据，不互相替代。macOS 具体实测记录由 `MACOS_ACCEPTANCE.zh-CN.md` 汇总；独立 `0.1.4` 的集成能力上移仍是后续工作。
