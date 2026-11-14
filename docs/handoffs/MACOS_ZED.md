# MACOS_ZED 交接：macOS 原生编译阻塞与 0.1.4 运行修复移植

- 工作树：`/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/zed`
- 分支：`codex/macos-zed`
- 任务书：`docs/tasks/MACOS_ZED.md`；派工方：Codex
- 提交：本文件所在提交（同时包含 5 个源码文件和本 handoff）。提交身份为仓库本地配置 `santa_antilles <2914566893@qq.com>`，未添加 co-author 行。
- 未修改：`Cargo.toml` / `Cargo.lock`、`dsh-bridge`、`plugin_host.rs` / `plugin_launch.rs`、IPC/transport、UI、根配置；未启动 GUI、未采集屏幕或剪贴板、未读取个人数据。

## 1. 移植的独立 0.1.4-beta 修复

来源：独立仓库 `/Users/santa_antilles/Desktop/your_all_in_one`（只读，`master`=`baeb3e4`，tag `v0.1.4-beta`）。两个提交的 `5750751` 基线文件与插件 native 当前版本逐字节一致，因此补丁无冲突地应用（`git apply --check` 先行验证）。

| 修复 | 来源提交 | 插件侧文件 |
| --- | --- | --- |
| GIF 排除窗口失效即停（macOS 显式 CGWindowID 复核，fail-closed） | `89ffe3b` | `crates/os-hal/src/traits.rs`（新增 trait 默认方法 `capture_exclusion_alive`）、`crates/os-hal/src/platform/screen.rs`（macOS 用 `CGWindowListCopyWindowInfo` 复核，Windows 用 `IsWindow`，其他平台返回 true）、`crates/mod-screenshot/src/gif/recorder.rs`（循环内复核，失效则停止并记录错误）、`crates/mod-screenshot/tests/unit/gif.rs`（+61 行测试） |
| 翻译浮窗 macOS 工作区二次夹取 | `b4e7a94` | `src-tauri/src/translator_mouse.rs`：`constrain_native_popover` 的 cfg 从 `windows` 扩到 `windows | macos` |

说明：
- 上述 `os-hal` 的 macOS 依赖（`objc2-core-graphics`、`objc2-core-foundation`）在插件侧已声明，无需改 Cargo 清单或锁文件。
- 未移植 `0e4bbb5`/`e511e38`（macOS updater、签名与 DMG 发布管线）：按派工要求，不移植 updater，也未改版本号。
- 现有 GIF 测试套件的 fake capturer 已实现新 trait 默认方法，无需改动其他测试桩。

## 2. macOS 原生编译状况

| 范围 | 结果 |
| --- | --- |
| `os-hal`、`mod-screenshot`（含 tests） | 编译通过（仅仓库既有 dead-code/unused 警告） |
| `app-core`、`mod-clipboard`、`mod-screen-ink`、`mod-media-proc`、`mod-sticky-note`、`mod-window-pin`、`mod-script-runner`、`mod-app-usage`、`mod-translator`、`mod-password-vault`（含 tests） | 编译通过 |
| `dsh-bridge`（lib） | **失败**：`crates/dsh-bridge/src/winutil.rs` 6 处错误（`std::os::windows` 缺失、`File::as_raw_handle` 不存在、`is_err` 类型推断失败）。属 Cursor 负责的 IPC/transport 范围，本轮未改 |
| `all-in-one-host`（src-tauri） | **无法在 macOS 编译**，原因是依赖 `dsh-bridge` 的上述错误。因此 `translator_mouse.rs` 的改动**未经 rustc 编译验证**，仅经 `rustfmt --check` 通过 |

`dsh-bridge` 依赖链已核实：`cargo tree -p all-in-one-host -i dsh-bridge` 显示 src-tauri 直接依赖它。

## 3. 平台降级核查（部分）

- `os-hal/src/platform/clipboard_source.rs`：非 Windows 的 `clipboard_owner_snapshot` 返回 `ClipboardOwnerSnapshot::default()`（序号 0、owner 与应用名均为 None），不读取前台应用；与 `resolve_clipboard_source` 组合后来源为未知，符合“取不到就保留 null”的要求。已通过代码阅读确认，未运行剪贴板测试。
- 其余 Windows 专属功能的 macOS 降级路径未做全面审计。这是本轮未覆盖的范围，需要另行核查。

## 4. 执行的命令与结果

环境：每次命令先执行 `export CARGO_HOME=<worktree>/.tmp/cargo-home` 与 `. scripts/use-project-environment.sh`，`CARGO_TARGET_DIR` 位于 `build/rust/target`（工作树内）。

1. `cargo metadata --locked --offline --no-deps`：成功，锁文件可解析。
2. `cargo check --workspace --locked --offline`：失败。原因是离线缓存缺少 `windows-sys 0.52.0`（`ring` 的 Windows 依赖），这是锁文件中已存在的版本。Codex 指示不做全平台 fetch，故中止该尝试，未联网下载、未改锁文件。
3. `cargo check -p os-hal -p mod-screenshot --tests --locked --offline`：`Finished`，退出码 0。
4. `cargo test -p mod-screenshot --locked --offline gif`：退出码 0。库内 GIF 相关用例 14 项通过，0 失败，包括新增的 `test_gif_recording_stops_when_explicit_overlay_disappears`；其他集成目标（`gif`、`save_paths` 等）也通过。
5. `cargo test -p os-hal --locked --offline capture_exclusion`：退出码 0，2 项通过，0 失败。
6. `cargo check --locked --offline -j2 --tests -p app-core -p os-hal -p mod-screenshot -p mod-clipboard -p mod-screen-ink -p mod-media-proc -p mod-sticky-note -p mod-window-pin -p mod-script-runner -p mod-app-usage -p mod-translator -p mod-password-vault`：`Finished`，退出码 0。
7. `cargo check -p all-in-one-host --locked --offline -j2`：退出码 101，失败点为 `dsh-bridge` 的 `winutil.rs`（见第 2 节）。
8. `rustfmt --edition 2021 --check src-tauri/src/translator_mouse.rs`：退出码 0。

## 5. 缓存与环境说明

- 为避免写入全局 `~/.cargo`（沙箱禁止），将 `~/.cargo/registry`（约 649 MB）只读复制到 `.tmp/cargo-home/registry`，后续命令均以它为 `CARGO_HOME`。
- 该副本不含 `windows-sys 0.52.0`。上面第 6 项的离线检查证明：这一缺失不影响上述 11 个成员的编译；它只阻碍对 `dsh-bridge` 的离线解析，而 `dsh-bridge` 本来就在 Cursor 的范围内。
- 所有输出位于工作树内（`.tmp/`、`build/`，均被 `.gitignore` 忽略）。

## 6. 待验证项与跨边界请求

1. **Cursor**：修复 `dsh-bridge/src/winutil.rs` 的 macOS 编译错误（或 UDS 改造）。之后需要重跑第 7 项，以确认 `all-in-one-host` 能完整编译，并借此编译验证 `translator_mouse.rs` 的改动。这是本轮最关键的阻塞点。
2. **Codex**：若需要 `cargo fetch` 完整锁文件（所有平台），需要 Codex 决定是否联网获取 `windows-sys 0.52.0` 等 crate，我未执行。
3. **未做真实 GUI/采集验证**：GIF 失效即停的 macOS 分支（`macos_capture_window_visible`）只在编译层面通过，运行时未在真实窗口上调用 `CGWindowListCopyWindowInfo` 验证；这需要 Codex 在真实桌面上做受控验收。
4. **性能注意**：`capture_exclusion_alive` 在 macOS 上每帧调用一次 `CGWindowListCopyWindowInfo`。这是上游 0.1.4 的既有设计，本次原样移植，未做优化。需要 Codex 在 GIF 录制时观察帧率影响。
5. **Windows 编译未验证**：本机是 macOS，`screen.rs` 的 Windows 分支（`IsWindow`）与 `translator_mouse.rs` 的 Windows 分支改动后未在 Windows 编译。Windows 分支的行为应与改动前一致，但需在 Windows 工作树上确认。
6. **未审计的 Windows 专属功能降级**：见第 3 节。
