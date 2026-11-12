# 迁移勘察基线

勘察日期：2026-11-12（Asia/Shanghai）。本文记录实际读取和命令结果，不代表插件运行验收。

## 原项目

| 项目 | 实际结果 |
| --- | --- |
| 源码目录 | `C:\Users\xcxix\PyCharmProjects\YourAllIn1Helper`，本轮只读 |
| Git HEAD | `575075139fddc8b96d8db1a313c2fe404959c108` |
| 工作树 | `git status --short` 无输出 |
| 应用版本 | 根 Cargo、package.json 和 Tauri 配置为 `0.1.3-beta` |
| 技术栈 | Rust workspace、Tauri 2、Vue 3、TypeScript、Vite、SQLite |
| 实际装配 | `src-tauri/src/modules.rs` 注册全部十个功能模块 |
| 原生产传输 | Tauri IPC；`src-ui/src/api/ipc.ts` 另保留 `/api/ipc` 回退 |
| 旧 HTTP 桥 | `src-tauri/src/legacy_http.rs` 存在，文件明确写明原生主程序不启动该服务 |
| 内核 | `AppKernelBuilder` 可传入数据目录、WindowBackend；`AppModule` 有启停钩子，注册表有 `with_enabled` 检查 |
| 原构建重定向 | `.cargo/config.toml` 的 `target-dir` 和 `build-dir` 都指向原项目在 `D:\Dev\Rust` 的目录 |
| 旧构建目录 | 根 `target`、`dist` 是 D 盘目录链接；Rust 迁移说明还记录了 `src-ui/dist` 联接 |

重要证据入口，以下均相对于原源码目录：

- `Cargo.toml`、`src-tauri/Cargo.toml`、`src-ui/package.json`。
- `crates/app-core/src/{lib,module,catalog}.rs`。
- `src-tauri/src/{lib,modules,tauri_app,legacy_http}.rs`。
- `src-tauri/src/ipc/{mod,kernel,media,sticky_note,screenshot,clipboard,usage,script,translator,window_pin,screen_ink,vault}.rs`。
- `src-ui/src/api/ipc.ts`、`src-ui/src/api/vault.ts` 和功能组件。
- `README.md`、`docs/releases/0.1.3-beta.md`、`docs/testing/WINDOWS_VAULT_2026-11-07.md`。

发现文档漂移：`docs/MODULE_ARCHITECTURE.md` 仍称仅九个模块、密码本处于 M0；当前装配源码及 0.1.3-beta 发布记录已经包含密码本与 OTP。该文档可帮助理解设计，但不能作为功能完成度清单。源码注释也有旧模块数量，不据此缩减迁移范围。

## 本机工具与缓存

| 项目 | 实际结果 |
| --- | --- |
| Node | `v24.17.0`；当前命令来自 `C:\Program Files\nodejs\node.exe` |
| pnpm | `10.34.9`；`.cmd` shim 在 `D:\cache\Node\npm-global` |
| pnpm store | `pnpm.cmd store path` → `D:\cache\Node\pnpm\store\v10` |
| npm cache | 当前环境变量为 `D:\cache\Node\npm-cache` |
| PNPM_HOME | `D:\cache\Node\pnpm` |
| rustc / cargo | `1.99.1` / `1.99.1` |
| CARGO_HOME | `D:\Dev\Rust\cargo` |
| RUSTUP_HOME | `D:\Dev\Rust\rustup` |
| Cargo 全局配置 | `build-dir = 'D:/Dev/Rust/build-cache/{workspace-path-hash}'` |
| TEMP / TMP | 当前仍是 `C:\Users\xcxix\AppData\Local\Temp`，后续构建需在子进程环境中覆盖 |
| D 盘可用空间 | 约 631 GiB，勘察时瞬时值 |

已读 `D:\cache\README.md`、`D:\cache\Use-Caches.ps1`、`D:\Dev\Rust\README.md` 和 `D:\Dev\Rust\Use-Rust.ps1`。`D:\cache` 同时包含实际用户数据及迁移备份，不能整体清理。现有 D 盘工具链无需为本项目再次迁移。

## Harness 与指南

- 用户指定指南：[moneka123/deepseek-harness-plugin-dev-guide](https://github.com/moneka123/deepseek-harness-plugin-dev-guide)。
- 指南仓库 HEAD：`f224099dce05f47c931d5e70d09ace9627607401`，由 `git ls-remote` 获取。
- 已按该 commit 下载 `README.md`、`AGENTS.md`、`REFERENCE.md`、`INSTALLATION.md`、`DYNAMIC-PLUGINS.md` 和 `LICENSE`，保存在 `docs/references/deepseek-harness-plugin-dev-guide/`。原文快照不作本地修订。
- 同目录 `SOURCE.json` 记录每个文件的固定来源与 SHA-256，可用于核对快照。
- [固定版本来源](https://github.com/moneka123/deepseek-harness-plugin-dev-guide/tree/f224099dce05f47c931d5e70d09ace9627607401)。
- 指南对应的 **Harness 源码基线**是 `3bbc502cd2b122fe7d1c4a4562ae8cd51ca1c1a7`；它与上面的指南 commit 是不同仓库的版本号。
- 指南记载 Node 范围为 `^22.19.0 || >=24.0.0`、pnpm 为 `11.7.0`。当前 Node 满足该记载，当前 pnpm 与其不同，实施时必须核对实际目标宿主。
- 当前会话 PATH 未找到 `dsh`。指南示例的 `D:\tools\deepseek-harness-master\deepseek-harness-master` 不存在，不能照抄启动命令。
- 发现 `C:\Users\xcxix\.dsh`，只查看了 Profile 目录和两个 `package.json`：`desktop`、`web` 均引用 base 与 web-app；`web` 另有 `dsh-overleaf`。没有读取 `.credentials.yaml`、会话或存储内容，没有修改现有 Profile。
- 尚未定位并核对实际 Harness 安装/源码和 revision。因此工具注册签名、Client 装配、CLI 参数、peer 版本、子进程策略都列为实施前置核对项。

## 本轮做过与未做过的工作

已做：源码与配置只读勘察、Git 状态检查、工具版本/缓存路径检查、指南联网读取和固定版本快照保存、迁移文档编写。

文档验证：三份自编文档的本地 Markdown 链接均存在，代码块围栏成对，未发现 Unicode 替代字符；四份执行指南的 Harness 基线标识一致。这些检查不构成软件构建或运行测试。

未做：复制原项目、安装或升级工具、构建与打包、运行原应用或插件、读写私人数据库、读取密钥、安装/移除 Bundle、修改环境变量或现有 Harness Profile。计划中的测试、性能目标及发布步骤均未执行。
