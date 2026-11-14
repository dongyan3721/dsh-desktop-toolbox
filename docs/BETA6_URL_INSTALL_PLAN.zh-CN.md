# beta.6：单地址安装交付

日期：2026-11-14。Codex 负责实现、装配和验收；不新建分支或工作树。

本轮已完成构建、真实界面、卸载重装、旧双包切换、远端 GitHub commit / tag 与公开 Release URL 安装验收，并发布 beta.6。结果与边界见 [验收记录](BETA6_URL_INSTALL_ACCEPTANCE.zh-CN.md)。下文保留执行计划与结构说明。

## 结构

- 根包 `dsh-toolbox-bundle@0.1.0-beta.6` 是完整 Windows x64 Bundle。既可从 GitHub 仓库根 URL 安装，也可从单个 `.tgz` URL 安装。
- `distribution/lib` 与 `distribution/resources` 保留 Host 的相对目录布局，原生资源定位不变。`distribution/client.js` 只变更模块加载器注册 ID 为根包名，内部 Vue 主控台仍来自原 Client 构建。
- 根 Patch 的三行保留稳定 ID，模块指向完整包；人用入口使用裸包名，使宿主能发现该包的 Client half。
- 三个包同版本，保留原 Host / Client 两包安装方式。完整包和旧双包是两种选择，不应同时启用。
- 完整包没有运行时依赖下载或安装生命周期脚本；不要求 Rust、pnpm `allowBuilds` 或关闭 `blockExoticSubdeps`。
- `distribution/` 的预构建文件随 Git 版本提交；`.gitattributes` 禁止换行转换改变清单哈希。清单记录输入源码 commit、原生来源与每个文件的 SHA256。

## 构建与发布顺序

1. 先提交版本、入口、装配脚本和测试，提交附 `Co-authored-by: Codex <codex@openai.com>`。
2. 使用既有 D 盘环境构建 Client、桌面和协议回归程序，装配三个包。已存在的同版本安装包拒绝覆盖。
3. 验证完整包内容与清单、Client 模块身份、真实宿主组合/加载、隔离数据和退出清理。
4. 提交预构建文件；完成本地验收后再推送，使远端仓库根目录始终具备可用的发布内容。
5. 在独立 D 盘 Profile 从实际 GitHub commit URL 安装，记录锁文件来源与 commit，再验收单个远端 `.tgz` URL。
6. 记录结果和限制；不得提前将未通过的安装路径称作已支持。保留所有 beta.5 及更早文件和 tag。

## 升级与测试边界

旧双包切换为完整包时，先正常退出工具箱，关闭/移除旧两个 Bundle，再安装完整包；移除只删除插件包，不删除工具箱数据目录。Profile 正在运行且没有 HMR 时需正常退出并重启 Harness。验证过程中只用新建的合成配置/数据，不读取个人数据库或凭据。

验收包含：默认五模块 Agent 授权 OFF、三个配置行各一份、一个原生内核、内嵌主控台、旧双包切换、安装/卸载/重装与数据保留。原生业务代码本轮不改动，已有 beta.5 原生功能证据可复用；重新构建不等于对十模块完成新的全面人工验收。
