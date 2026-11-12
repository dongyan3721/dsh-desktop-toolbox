# 实施基线：第一轮并行开发

日期：2026-11-12。当前工作区所有目录均在 `D:\Code\dsh-toolbox` 内。

实际 Harness 安装：`E:\deepseek-harness`，注册版本 `0.2.2-rc.1`。CLI 为 `E:\deepseek-harness\resources\runtime\cli\bin\dsh.cmd`。实际检查 `--help` 成功；安装自带 Node `24.21.0`、pnpm `11.28.5`。系统 Node `24.17.0`、pnpm `10.34.9` 仍保留，不升级全局工具。

只读提取安装包 SDK 及其依赖到 `vendor/harness-runtime/node_modules`，根 `node_modules` 是指向该 D 盘目录的 junction；参考文档在 `vendor/harness-reference`。这是本机开发依赖快照，不纳入插件 tarball。包版本：Cordis `4.1.0`、Schemastery `3.19.0`、DSH 服务包 `0.2.2-rc.1`。SDK 没有 `.d.ts`，先使用 ESM JavaScript 与 JSDoc，不为类型检查创建伪造 API 声明。

原工具箱已用 `git archive` 从固定 commit `575075139fddc8b96d8db1a313c2fe404959c108` 导出到 `native/YourAllIn1Helper`。没有复制原项目 `.cargo` 配置、node_modules、用户数据或目录联接。

已验证样例：`node scripts/build.mjs`、`node --test tests/prototype.test.mjs`、`node scripts/demo.mjs`。测试经过实际 Cordis Loader 和工具流水线，验证结构化状态、预取消和卸载移除注册。`toolbox_status` 如实返回 `nativeConnected:false`。包 `dist/dsh-toolbox-0.0.1-prototype.1.tgz` 由 pnpm 生成，包含发布 JS、manifest、Patch 和 README。

注意实际版本差异：`ctx` 根生命周期通过 `ctx.fiber.dispose()` 释放；Loader 的 `await()` 自身不把所有插件加载失败作为 throw，需要再检查/等待目标 Fiber；工具对象 Schema 明确要求 `additionalProperties`。样例以实际运行验证这些差异。样例 Entry 使用 `toolbox-prototype`，避免把带冒号的 Entry id 与 Loader 嵌套路径解析混淆。

源码与环境脚本、真实 Loader 样例、构建/打包和集成由 Codex 拥有。其他 agent 的第一轮任务见 `tasks/`。这些任务只覆盖首轮实现，不代表整个迁移计划已完成。
