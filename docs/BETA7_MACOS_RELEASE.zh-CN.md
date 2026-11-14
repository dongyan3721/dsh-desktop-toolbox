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

## 发布门禁（现已全部通过，见最终验收）

1. 完整 tarball 安装，默认五项授权关闭，无 toolbox Agent 工具。
2. 逐项启用及授权，实际 SDK 执行截图、系统剪贴板、原便笺同步、原生画布和真实应用时长。
3. 五项撤权后旧工具引用拒绝，关闭功能保留授权但拒绝调用；重启保留便笺和关闭授权。
4. 真实客户端显示完整包与侧栏主控台；GitHub commit / tag / Release URL 在隔离 profile 导入。
5. 公开 tag / Release 文件与 SHA-256 可取得，公开来源安装后原生进程能启动并正常退出。

尚不声称：所有十模块、物理快捷键、多屏、Intel、Windows beta.7、干净 macOS 首次系统授权、Developer ID 公证、模型自动选择工具。已验证的 SDK 调用与模型选择工具是两项不同证据。

## 2026-11-14：早期运行记录（最终安装门禁以 strict 记录为准）

- 完整包 33 个运行时文件，sourceRevision `d4bac2d19cf2b5440a613ddf3b462c37805d3854`。
- 已签名 app 的 Mach-O SHA-256：`0480e7e4b0ae9b5fed00d6e4d167ff8cbc7eedea8f96c75294006055e34f3b2c`。这是给同一构建补齐资源签名后的哈希。
- `dsh plugin --profile beta7 add <本地tgz> --store-dir <工作区隔离store>`：成功，未执行安装脚本。
- `scripts/beta7-macos-acceptance.mjs` 通过真实安装版 CLI 分三阶段运行：default / enabled / persisted，退出码均为 0。
- 新安装五项默认拒绝；五个工具经授权后都执行成功；真实 Retina 2940×1912、32×32 PNG 图片附件；系统剪贴板文本/历史；打开中的原便笺更新 `display_sync=applied`；原画布 draw/snapshot/clear/stop；真实应用时长从 0 增至 1 秒且小时统计匹配。
- 五项分别撤权后旧引用拒绝；关闭模块保留授权但拒绝调用；最后五授权关闭，重启后便笺中文/Emoji 内容保存成功。
- 原生 app `codesign --verify --deep --strict` 通过。此签名是 ad-hoc，不能当作 Developer ID 公证。

机器证据在工作区 `artifacts/beta7/acceptance.jsonl` 与 `artifacts/beta7-local-{default,enabled,persisted}.log`；这些含本地路径的诊断不作为插件内容发布。


## 最终公开来源验收：通过

发布 tag `v0.1.0-beta.7` 指向 `cf4fe5dafc6c09495e6f61907e570293e53aed10`；注解 tag 对象为 `fb7b3ae2fd7f6617f0f25f36e71a21c6bed2c2ee`。main 后续仅补充验收记录，tag 与发布包不再移动或覆盖。

| 真实安装来源 | 独立缓存安装 | 安装目录与原生执行路径断言 | 默认授权关闭 |
| --- | --- | --- | --- |
| GitHub 固定 commit `fe701f86a7c0f40cf999003cf5b6437dedd06191` | 8 秒 | 通过 | 通过 |
| GitHub tag `v0.1.0-beta.7` | 9.5 秒 | 通过 | 通过 |
| Release `.tgz` URL | 16.6 秒 | 通过 | 通过 |

三份包均由安装版 Harness CLI 的 `dsh plugin ... add` 导入、真实 Loader 激活、真实 Client 图发现和原生进程启动；没有本地源码替代、安装脚本许可或 exotic-dependency 豁免。Client 包根目录必须位于该隔离 DSH_HOME 的 `profiles/.../node_modules`；`pgrep -P <Harness PID>` 与 `ps` 验证实际子进程也从同一个已安装包的 `.app` 启动。33 项运行时文件清单全部通过完整性校验。

公开 tag 的 **strict enabled** 阶段再次通过五模块：真实 32×32 截图附件、系统剪贴板中文/Emoji 文本及历史、打开中的原便笺 `display_sync=applied`、原画布绘制/穿透/图片附件/清空/停止、真实应用时长从 0 增至 5 秒。逐项撤权的旧引用均拒绝；关闭模块保留授权并返回 MODULE_DISABLED；结束后五授权关闭。**strict persisted** 阶段重启后再次读取便笺中文/Emoji 内容成功。各阶段正常退出码为 0。

公开 Release 资产通过正常 HTTPS 下载，SHA-256 为 `e14a72bc439f59bb6b048b5f4fcb75bc3352c99b2bf5830f213d875c183a1ff7`，与本地发布物逐字节相同，公开 SHA256SUMS 校验通过。公开预发布地址：

https://github.com/dongyan3721/dsh-desktop-toolbox/releases/tag/v0.1.0-beta.7

客户端界面验收使用安装版 Electron 的隔离 profile，由其自身 Host 提供网页客户端（IAB 渲染该实例的本地界面，未在日常 profile 安装）。「添加插件」输入标准 tag URL 后显示「已安装」「版本 0.1.0-beta.7」，5.6 秒完成；点击启用后出现工具箱侧栏和原主控台，五项 Agent 授权关闭。界面安装缓存明确记录在 `runtime/beta7/desktop-public/pnpm-store/v11`。

最终机器证据：`artifacts/beta7-*-strict-*.log`、`artifacts/beta7/acceptance.jsonl`、`artifacts/beta7/public-download/`，以及 `public-tag-installed.jpg`、`public-tag-toolbox-final.jpg`。测试数据与图片不打进插件。

### 验收环境纠正

最初从仓库目录启动 Harness，会触发同名包的工作区自引用，原生进程路径指向根 `distribution/`。这些早期运行只计作相同内容的工作区验证，不能计作最终安装门禁。CLI 已改为从各自 profile 目录启动；Electron 还在 runtime/beta7/package.json 放置独立测试包作用域（name 为 dsh-beta7-isolated-acceptance），阻止祖先仓库的同名包自引用。增加实际 Client 包目录和原生子进程路径断言，并完整重跑；上表只统计重跑后的结果。

初始网络大文件每秒几 KB、发生 UND_ERR_SOCKET；用户切换网络后，以上标准 URL 全部在秒级完成，没有采用镜像包、改写文件源或放宽 pnpm 策略。测试过的非标准 Git 地址不计入通过来源。

第一次本地包界面安装的 `.npmrc` store-dir 未被 pnpm 11 采用，复用了用户默认 pnpm 缓存。已在后续隔离 profile 的 `pnpm-workspace.yaml` 使用 `storeDir`，由实际安装日志确认工作区目录；未清理或重置用户原缓存。

最终 Electron Host 原生子进程同样从 `runtime/beta7/desktop-public/harness-home/profiles/desktop/node_modules/dsh-toolbox-bundle/.../All-in-One Toolbox.app` 启动，安装后的完整 app 严格签名校验通过。独立原生主窗口由侧栏主控台按钮打开，与内嵌主控台保持相同的默认开关。

最终关闭：客户端停用插件后侧栏工具箱撤回；关闭仅由本次任务启动的隔离 Electron 实例。进程审计确认本任务的原生工具箱进程数为 0。保留隔离测试数据与证据，未卸载日常客户端插件、读取个人数据库或复制凭据。日常 Harness 继续运行。

验收时曾因 CUA 目标路径与实际根 distribution 进程路径不同，额外启动一次无插件参数的原生窗口；立即退出，未操作其内容，不计验收。之后仅在进程路径确认与安装目录一致后绑定原生窗口，最终界面默认开关与嵌入主控台一致。未清理该额外窗口可能创建的默认应用数据，避免改动用户数据。
