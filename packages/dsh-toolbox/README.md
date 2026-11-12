# DSH Toolbox alpha

Windows x64 本地工具箱：真实状态、便笺创建/搜索/更新。图片转换只在显式启用、配置允许的读写根且原生 ready capabilities 支持时注册。本阶段不创建桌面便笺窗口，不采集剪贴板、窗口标题或截图，不读取旧数据库。

兼容基线：Harness `0.2.2-rc.1`、Cordis `4.1.0`、Node 24。
发布入口是 `lib/index.js`，Bundle 为 `cordis.patch.yml`。
本包没有安装期脚本。构建、安装与运行验收记录位于工作区 `docs/`。

配置必须指定绝对 dataDir，Bundle 默认使用 DSH_TOOLBOX_DATA_DIR 或 DSH_HOME 下的 toolbox-data。开发/验收时请将 DSH_HOME 指向 D 盘隔离目录。原生程序默认从本包 resources 中加载并校验 SHA-256；nativeExecutable 仅供可信部署显式覆盖，不是模型工具参数。

启动依赖宿主的 tools/subprocess 服务。图片额外需要同一执行世界的 fs 服务、enableImages:true、readRoots 和 writeRoots；输出必须同时满足宿主当前文件策略与原生路径检查。不会覆盖已有文件。跨进程写操作出现 OUTCOME_UNKNOWN 时应先查询实际数据，不自动重试。宿主外层也可能在原生写入已提交后报告调用被取消，取消不等于回滚；重试前应先查询结果。

卸载会停止新调用、处理在途任务、请求原生关停并等待受管理进程范围退出；保留数据目录供重新安装使用。未提供密码本、截图遮罩或其他桌面模块。外部发布前需要完成完整的第三方许可清单审计；当前产物供本机隔离验收。
