# Zed / Claude Code B5 交接：剪贴板来源与旧便笺清理

日期：2026-11-14
工作树：`D:\Code\dsh-toolbox\.worktrees\zed`
分支：`agent/zed-features`
基线：`45d1d1c`（beta.4 同步后的 B5 派工文档）
模型：保持当前 Claude Code ACP / 自定义 DeepSeek Flash，未切换。

## 提交

| 提交 | 内容 |
| --- | --- |
| `6a00941` | 旧 headless notes 工厂迁到 test-only fixture，生产 src 删除，更新历史 fixture/test |
| `14c13dd` | Windows 剪贴板 owner→PID→应用 stem 来源，序列稳定性与未知降级，文本/图片来源接线 |
| 本文所在提交 | B5 handoff |

未合并 main、未发布/tag/安装，未新建分支/工作树，未改 root manifest/build/Cargo 清单。

## A. 剪贴板来源

### 新增 OS HAL 窄 helper

`native/YourAllIn1Helper/crates/os-hal/src/platform/clipboard_source.rs`：

```rust
pub struct ClipboardOwnerSnapshot {
    pub sequence: u32,
    pub owner_pid: Option<u32>,
    pub app_name: Option<String>, // executable stem only, never full path
}

pub enum ClipboardSourceDecision { Use(Option<String>), Changed }

pub fn clipboard_owner_snapshot() -> ClipboardOwnerSnapshot
pub fn resolve_clipboard_source(before, after) -> ClipboardSourceDecision
```

Windows 实现：

- `GetClipboardOwner`，不使用 `GetOpenClipboardWindow`，也不读取前台应用。
- `GetWindowThreadProcessId` 得到 owner PID。
- `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW` 得到进程镜像；只保留 executable stem（如 `Code`），不存储/返回/记录完整路径、窗口标题或命令行。
- `GetClipboardSequenceNumber` 在 owner 读取前后比对；不稳定时返回 unknown，不尝试猜测。
- `owner` 为 null、PID 为 0、进程已退出、OpenProcess/Query 失败/拒绝访问：`app_name = None`。
- owner PID 等于本进程：显式返回 `app_name = None`，避免系统监听覆盖已有 `agent` 明确来源。
- 非 Windows：返回 unknown，CFG 隔离；不读取前台应用。
- helper 从 `platform/mod.rs` 和 `os-hal/src/lib.rs` 重导出；没有改 src-tauri/lib.rs，也没有 Cargo feature 变更。

### 监听器接线

只修改 `src-tauri/src/tauri_app.rs` 的 `start_clipboard_listener`：

- 文本：`get_text` 前取 owner snapshot，读取后取第二个 snapshot；`resolve_clipboard_source` 为 `Changed` 时本轮不记录，下一轮重新读取；`Use(Some)`/`Use(None)` 传给 `capture_text`。
- 图片：`get_image` 前后同样处理，来源传给 `capture_image_rgba`。
- 保留原有：文本/图片去重、`clipboard.enabled`、`capture_images`、`os_hal::clipboard_content_is_concealed()` 敏感标记、事件总线屏蔽租约、模块启停与同一条监听线程。
- 序列变化/owner 未知时不把新内容与旧 owner 拼接；未知来源写入 `None`，不回填历史。
- 没有日志新增；没有把捕获内容放入诊断。

### A 测试结果

```powershell
. 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'
Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed\native\YourAllIn1Helper'
cargo test -p os-hal
```

结果：**48 passed / 0 failed / 4 ignored**。其中新增 6 项 `clipboard_source` 纯逻辑测试：稳定来源、序列变化、缺失序列/名称、PID 不一致、owner exit/access denied、null owner。

```powershell
cargo test -p mod-clipboard
```

结果：**3 unit + 6 paste_pipeline = 9 passed / 0 failed**。新增 `test_text_and_image_source_storage_search_and_duplicate_semantics` 覆盖：

- 文本/图片来源入库与按来源/内容搜索；
- 同内容重复捕获：已知新来源更新，未知来源 `None` 保留已有来源；
- 停用模块继续拒绝文本/图片采集；
- 敏感屏蔽租约继续拒绝文本/图片采集；
- 已有来源不被未知值清空。

```powershell
cargo check -p all-in-one-host
```

结果：成功。只有仓库既有警告（`platform/selection/mod.rs` unreachable、mod-password-vault、agent_api 未使用函数等），没有本次改动新增错误。

未运行真实系统剪贴板/GUI；敏感标记的真实 OS 行为仍由既有的 ignored 原生测试（需显式运行）覆盖，本轮未执行。

## B. 旧便笺生产实现清理

- `packages/dsh-toolbox/src/features/notes.js` **已从生产 src 删除**。
- 原实现迁至 `tests/fixtures/legacy-notes-tools.mjs`（历史协议回归，明确 test-only）。
- `packages/dsh-toolbox/tests/features.notes.test.mjs` 改为 import fixture，并新增“生产 src 不再存在旧文件”的回归断言。
- `tests/fixtures/legacy-headless-plugin.mjs` 的 notes import 改为 `./legacy-notes-tools.mjs`。
- 当前生产便笺入口只有 `packages/dsh-toolbox/src/agent/notes.js` 的 `toolbox_notes`；未改其默认拒绝/CAS/脏草稿/取消行为。
- 未改历史 release tarball、docs、Cargo 清单、根 build 脚本。

### B 测试结果

```powershell
node --test packages/dsh-toolbox/tests/features.notes.test.mjs
```

结果：**24 passed / 0 failed**。

```powershell
node --test packages/dsh-toolbox/tests/*.test.mjs
```

结果：**148 passed / 0 failed**。

## 已知构建/回归缺口（Codex 处理）

本工作树的 `packages/dsh-toolbox/lib` 是旧增量构建（仅含旧 `index.js`、`features/notes.js`、`features/images.js`，缺少 `lib/host/native-owner.js` 等），且 `resources/win32-x64/dsh-toolbox-native.exe` 不存在。因此根目录：

```powershell
node --test tests/*.test.mjs
```

为 **18 pass / 11 fail**，失败集中在 `lifecycle`、`native-owner`、`prototype`、`desktop-service` 等真实 Loader/native fixture 测试，原因包括：

- `The actual Loader failed to import the toolbox module`（旧 lib 缺少 host/native-owner 等构建产物）；
- `SubprocessExecutableNotFoundError`（未构建/未放置 native exe）。

这些不属于本次 A/B 代码范围，也未通过修改根 build 或伪造 fixture 掩盖。请 Codex：

1. 清理 `packages/dsh-toolbox/lib` 后重新构建，确保删除源后不再留下 `lib/features/notes.js`；验证发布 tarball 不含旧文件。
2. 在集成工作树构建/放置真实 native exe，重跑根 lifecycle/prototype/native-owner 回归；不要用本工作树旧 lib 结果作为 beta.5 通过证据。
3. `scripts/profile-smoke.mjs` 等旧脚本由 Codex 决定停用/更新，不让其冒充新生产入口。

## 跨边界接线请求

- 无需修改 `src-tauri/lib.rs`：来源 helper 位于 os-hal 并通过 `os_hal::{clipboard_owner_snapshot, resolve_clipboard_source, ClipboardSourceDecision, ClipboardOwnerSnapshot}` 导出。
- 无需新增 Cargo feature；使用 os-hal 现有 windows 0.62 features。
- 真实桌面验收由 Codex 完成：合成文本/图片复制后验证来源字段与来源搜索；owner 未知/进程退出/访问拒绝保持 null；快速切换序列不误归因；敏感标记/停用/去重仍生效。
- 旧便笺 fixture 仍依赖构建后的 `lib/host/native-owner.js`、`lib/features/images.js`、`lib/host/image-policy.js`；完整根回归需先有这些构建产物。

## 未测/未完成

- 未操作真实系统剪贴板、未启动 GUI、未安装用户 Profile、未读取个人数据库。
- 未验证真实 Windows owner→PID→应用名在真实外部应用复制中的结果；只验证了纯决策逻辑和合成存储测试。
- macOS 来源未实现，按 cfg 返回 unknown。
- 未验证真实敏感 OS 标记（既有 ignored 测试未运行）。
- 未执行发布打包/版本变更；由 Codex 负责。
