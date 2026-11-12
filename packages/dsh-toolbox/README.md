# DSH Toolbox prototype

当前可用：`toolbox_status`，通过真实 Harness 工具注册表报告接入阶段。
原生桥、便笺和图片处理正在独立任务中实现；本样例不会采集剪贴板、窗口标题或截图，也不会读取旧数据库。

兼容基线：Harness `0.2.2-rc.1`、Cordis `4.1.0`、Node 24。
发布入口是 `lib/index.js`，Bundle 为 `cordis.patch.yml`。
本包没有安装期脚本。构建、安装与运行验收记录位于工作区 `docs/`。
