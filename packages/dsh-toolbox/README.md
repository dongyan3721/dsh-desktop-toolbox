# DSH Toolbox human preview

Windows x64 原桌面工具箱的人用迁移预览。兼容 Harness `0.2.2-rc.1`、Cordis `4.1.0`、Node 24。

`0.1.0-alpha.6` 默认 Bundle `human.patch.yml` 启动原 Tauri 桌面，提供 `toolboxDesktop` 服务；另安装同版本 `dsh-toolbox-client`，在 Harness 侧栏显示“工具箱”。点击入口打开原主窗，便笺、偏好与原快捷键控件复用原程序。默认人用装配不注册模型工具，不需要模型请求。

新配置仅启用便笺，其默认快捷键仍为未分配；其他模块保留原界面与默认键定义，需用户按计划启用和验收。脚本、密码本和使用时间无需开放给 Agent。旧项目数据不自动导入；没有读取旧数据库、开启自启动、运行更新器或填充演示数据。

配置必须指定绝对 `dataDir`。人用 Bundle 默认读取 `DSH_TOOLBOX_DATA_DIR`，否则使用 `DSH_HOME/toolbox-desktop-data`。开发验收把 `DSH_HOME` 和 Electron 用户目录放在 D 盘隔离目录。桌面程序、WebView、日志和临时文件归该目录；当前实现拒绝 AppData 内的数据目录。原生文件使用独立 SHA-256 清单校验；`nativeExecutable` 仅供可信部署显式覆盖。

`dsh-toolbox/desktop` 为独立桌面服务；`dsh-toolbox/human-entry` 为可见入口的窄 RPC 适配。卸载会等待便笺保存、停止自己拥有的进程并保留数据目录。无法确认保存或必须强制终止时返回明确失败。关闭主窗保留托盘与快捷键；再次打开复用窗口。

旧 headless 入口仍在包根 `lib/index.js` 和显式 `cordis.patch.yml`，供已验证的便笺/图片 Agent 能力单独选择。不要让两种内核运行在同一数据目录。图片能力仍需显式启用、读写根、宿主文件策略与原生 capability；`OUTCOME_UNKNOWN` 后先核查实际结果，不自动重试。

没有安装期脚本。工作区 `scripts/Build-Package.ps1` 构建两个本地包并拒绝覆盖同版本归档。冻结 alpha.2 包不含新桌面功能。该版本是本机集成预览；完整十模块、凭据人工验收、旧数据导入及第三方许可审计仍按迁移计划推进。实际已测范围见工作区 `docs/`，源码保留不等于 GUI 已验收。
