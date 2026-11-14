# beta.7 macOS 发布验收

本轮目标：暂不解耦，在 macOS arm64 的真实 Harness 0.2.2-rc.3 中验收五个 Agent 模块，发布支持 GitHub URL 导入的完整插件。beta.6 及更早 tag/资产不变；Windows 用户继续 beta.6。

## 构建与安装设计

- 根包、Host、Client 版本统一为 0.1.0-beta.7。只发布根完整包；开发用双包不另发资产。
- 根包声明 darwin/arm64，distribution 包含 `.app`、Info.plist、图标、预构建 Client 和原生清单。
- npm 的 Git 打包可能去掉非 CLI 文件的执行位。Host 仅对内置、普通文件且 SHA-256 与清单一致的 macOS 程序恢复执行位；外部指定程序、符号链接和哈希不符文件不修改。
- Release tarball 同时保留执行位。没有 prepare/postinstall、外来依赖策略豁免或构建批准。
- 原生二进制沿用已验收的 f20782502eedafd5871cdb78b2e535c30970df7b 构建，并对完整 app 添加 ad-hoc 资源签名（`codesign --verify --deep --strict` 通过），原生版本 0.1.3-beta；插件版本与原生版本分开记录。

## 本地验证

`npm test`：190 通过，9 项历史 Windows x64 headless 可执行程序用例在 macOS 明确跳过。macOS 原生生命周期由实际安装的 Harness 验收覆盖，不能把跳过项计为通过。

前一轮原生 GUI、UDS 生命周期、Retina 坐标、便笺双向同步、撤权和进程清理详见 MACOS_ACCEPTANCE.zh-CN.md。新增真实应用时长测试：Agent 首次读到 55 秒，GUI 同步显示 55 秒；前台切换后 GUI 显示 74 秒（ChatGPT 59 + 工具箱 15），下一次 Agent 刷新为 79 秒（59 + 20），小时统计也是 79 秒。没有写入虚构统计。

应用时长验收只在隔离配置使用 `idle_threshold_secs=86400`、`flush_interval_secs=5`、`keep_window_titles=false`，便于长时间自动化期间持续观察真实采样。产品默认闲置阈值没有修改。

## 发布门禁（逐项补充实测结果）

1. 完整 tarball 安装，默认五项授权关闭，无 toolbox Agent 工具。
2. 逐项启用及授权，实际 SDK 执行截图、系统剪贴板、原便笺同步、原生画布和真实应用时长。
3. 五项撤权后旧工具引用拒绝，关闭功能保留授权但拒绝调用；重启保留便笺和关闭授权。
4. 真实客户端显示完整包与侧栏主控台；GitHub commit / tag / Release URL 在隔离 profile 导入。
5. 公开 tag / Release 文件与 SHA-256 可取得，公开来源安装后原生进程能启动并正常退出。

尚不声称：所有十模块、物理快捷键、多屏、Intel、Windows beta.7、干净 macOS 首次系统授权、Developer ID 公证、模型自动选择工具。已验证的 SDK 调用与模型选择工具是两项不同证据。

## 2026-11-14：本地完整包结果

- 完整包 33 个运行时文件，sourceRevision `d4bac2d19cf2b5440a613ddf3b462c37805d3854`。
- 已签名 app 的 Mach-O SHA-256：`0480e7e4b0ae9b5fed00d6e4d167ff8cbc7eedea8f96c75294006055e34f3b2c`。这是给同一构建补齐资源签名后的哈希。
- `dsh plugin --profile beta7 add <本地tgz> --store-dir <工作区隔离store>`：成功，未执行安装脚本。
- `scripts/beta7-macos-acceptance.mjs` 通过真实安装版 CLI 分三阶段运行：default / enabled / persisted，退出码均为 0。
- 新安装五项默认拒绝；五个工具经授权后都执行成功；真实 Retina 2940×1912、32×32 PNG 图片附件；系统剪贴板文本/历史；打开中的原便笺更新 `display_sync=applied`；原画布 draw/snapshot/clear/stop；真实应用时长从 0 增至 1 秒且小时统计匹配。
- 五项分别撤权后旧引用拒绝；关闭模块保留授权但拒绝调用；最后五授权关闭，重启后便笺中文/Emoji 内容保存成功。
- 原生 app `codesign --verify --deep --strict` 通过。此签名是 ad-hoc，不能当作 Developer ID 公证。

机器证据在工作区 `artifacts/beta7/acceptance.jsonl` 与 `artifacts/beta7-local-{default,enabled,persisted}.log`；这些含本地路径的诊断不作为插件内容发布。
