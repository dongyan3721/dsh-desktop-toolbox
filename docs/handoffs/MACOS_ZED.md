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

## 3. 十模块 macOS 降级/不支持路径（只读代码复核）

复核基于本工作树 `c6930f9` 及其后 handoff-only 提交；表中 `crates/...` 路径相对 `native/YourAllIn1Helper`，`src-tauri/...` 路径相对同一 native workspace。只读源代码，没有运行 GUI、读系统剪贴板或个人数据，也没有针对本节运行测试。表中“应成功”是按代码路径整理的 Codex 验收预期，不代表本轮真实桌面实测。

| 模块 | macOS 后端实际行为、明确限制 | Codex 验收预期 / 注意 |
| --- | --- | --- |
| `screenshot` | `crates/mod-screenshot/src/lib.rs::begin_session` 在用户主动开始时调用 `ScreenCapturer::request_capture_permission`；`os-hal/src/platform/screen_permission.rs::{check,request}` 使用 TCC preflight/request，拒绝时给 `screen_recording` 指引。被动 `permission_status` 只查询，不申请。生产装配 `src-tauri/src/modules.rs::mount` 注入 `hal.ocr_provider`；`os-hal/src/platform/ocr.rs::recognize_rgba` 的 macOS 分支走 Vision。自动滚动最终调用 `InputSimulator::scroll_wheel_at`，`os-hal/src/platform/input.rs::check_input_permission` 要求 Accessibility 权限；`crates/mod-screenshot/src/scroll/session.rs` 对失败关闭自动滚动并提示手动滚动。 | TCC 授权后截图/GIF 与 Vision OCR 应走真实后端；未授权时主动截图应明确请求/报告屏幕录制权限。自动滚动未获辅助功能权限时，预期降级为手动滚动，不应报告自动滚动成功。`UnavailableOcr` 仅是未注入 provider 的模块默认 stub；当前 Tauri `mount` 已注入 Native HAL provider。 |
| `clipboard` | `src-tauri/src/tauri_app.rs::start_clipboard_listener` 用 `arboard` 轮询文本/图片，受模块开关与 `config.clipboard.enabled` 控制；读取异常会丢弃当前 arboard 实例并重试。`os-hal/src/platform/clipboard_source.rs::clipboard_owner_snapshot` 的 `#[cfg(not(target_os = "windows"))]` 分支返回默认空快照；macOS 来源应用名/owner/序号因此未知，`resolve_clipboard_source` 只能给 `None`，不得期待 `source_app_name` 被填充。macOS `clipboard_content_is_concealed` 读 `NSPasteboard` 的 `org.nspasteboard.ConcealedType`；系统敏感标记仍应被过滤。粘贴动作经 `InputSimulator` 发送 Cmd+V，`os-hal/src/platform/input.rs::check_input_permission` 要求 Accessibility。监听器没有自身的剪贴板权限 preflight；读取/系统提示行为交由 `arboard` 与系统处理。 | 启用且系统剪贴板可读时，文本/图片历史应能收录、来源显示未知/null；敏感标记应继续排除。粘贴动作需当前签名 app 获辅助功能权限；缺权应失败并给权限指引。真实系统是否显示剪贴板访问提示、拒绝后具体 `arboard` 错误需 Codex 实测，不可从本次静态复核推定。 |
| `screen_ink` | 画布与 PNG 合成主要在模块/窗口层；但 `crates/mod-screen-ink/src/lib.rs::composite_and_save` 直接调用 `capturer.capture_monitor(None)`。与 screenshot 的 `begin_session` 不同，这条保存路径未调用 `request_capture_permission` 或 `check_capture_permission`，捕获错误也只映射为一般 `CoreError::Internal`。复制 PNG 在非 Windows 分支用 `arboard::Clipboard::set_image`，不是 `os_hal::write_rgba_clipboard` 的 Windows 专用路径。 | 已授权屏幕录制时，截图底图合成保存应可成功；未授权时不要把“请求权限并提供同等指引”视为已实现，本次代码没有这条显式流程，需 Codex 特别确认实际报错/UX。PNG 复制走 arboard，需按真实系统剪贴板权限/提示验收。 |
| `media_proc` | `crates/mod-media-proc/src/image.rs` 的 Rust 图像编解码未发现 macOS 禁用分支。音视频 `crates/mod-media-proc/src/av.rs::{probe_file,process_av}` 运行外部 `ffprobe`/`ffmpeg`；`check_environment` 返回二者探测结果。`app-core/src/env_probe.rs` 注明不捆绑运行时。 | Rust 支持的图像格式应可直接处理；音视频只有在当前发行/运行环境能找到兼容的 `ffmpeg` 和 `ffprobe` 时才应成功。缺少工具应显示 environment unavailable，不是平台代码 stub。 |
| `sticky_note` | `crates/mod-sticky-note/src/lib.rs` 未发现 macOS `cfg` 禁用、Unsupported 或假后端；便笺数据/事务落在通用模块，开关/打开/恢复通过 `ModuleContext.window_pool` 与 `WindowSpec`。实际窗口展示与置顶由 Host 的 WindowPool/Tauri 承担，不由该 crate 提供 macOS 原生后端。 | 代码层没有已知的 macOS unsupported 结果；创建、恢复和销毁应在真实 Host 窗口验收。单凭模块测试不能证明窗口置顶/坐标行为。 |
| `window_pin` | `crates/mod-window-pin/src/lib.rs::pin_window` 最终调用 `set_external_window_topmost`。`os-hal/src/platform/windows/mod.rs::supports_external_topmost` 在 macOS 为 false，`set_external_window_topmost` 明确返回 `Unsupported("macos_external_window_topmost")`；同文件 `native_topmost` 的非 Windows stub 固定返回 false，`native/macos.rs::native_windows_macos` 也填 `is_topmost: false`。macOS 枚举走 `CGWindowList`；`activate_macos_window` 激活所属应用，不保证激活特定窗口。 | macOS 外部窗口列表/候选选择/应用激活可按可见窗口 API 结果验收；真正的外部窗口 pin/unpin 明确不可用，调用不得被报告为成功。由于 `is_topmost` 固定 false，已有外部置顶状态不可准确识别；不要把列表中的 `false` 当作系统确认。 |
| `script_runner` | `crates/mod-script-runner/src/model.rs::ScriptType::supported_on`：Python/Node 跨平台；Shell 与 AppleScript 在非 Windows 支持；PowerShell、Batch、VBScript 仅 Windows。`lib.rs::probe_for` 对不支持类型返回 `supported=false/available=false`；支持类型再由 `EnvProbeService` 探测。macOS Shell 探测 `zsh`/`bash`，AppleScript 探测 `osascript`。 | macOS 上 Python/Node/Shell/AppleScript 只有对应解释器实际可用时可运行；PowerShell/Batch/VBScript 即使另行安装也按本产品当前契约显示 unsupported。不要把 `supported=false` 与“解释器未安装”混为一谈。 |
| `app_usage` | `os-hal/src/platform/usage/macos.rs` 实现 `usage_active_app_macos`（NSWorkspace）、`usage_idle_seconds_macos`（CGEventSource）、`usage_screen_locked_macos`（会话锁与显示器睡眠）、`usage_audio_active_macos`（CoreAudio 设备运行状态，不读音频内容）。`mod-app-usage/src/lib.rs::start_event_monitor` 在系统事件观察失败时明确继续轮询。`front_window_title` 注释说明无屏幕录制权限时 CGWindowList 可能返回空标题。 | 前台应用、idle、锁定/息屏及输出设备活动有 macOS 实现；系统通知不可用时轮询是预期降级。窗口标题在无屏幕录制权限/系统不给标题时可为空，不应伪造；这是与 screenshot TCC 不同的降级表现。 |
| `translator` | `src-tauri/src/translator_mouse.rs::macos::start` 仅监听左键 down/up，要求拖动至少 6 px 且前后 PID 相同；延迟 100 ms 后由 `os-hal/src/platform/selection/macos.rs::extract_selected_text_macos` 读 AXFocusedUIElement/AXSelectedText。需要 Accessibility 权限；AX 不支持的控件返回 `Unsupported`。`selection/mod.rs::extract_selected_text` 明确禁用了模拟复制 fallback（剪贴板租约尚未实现）。自动鼠标入口在 `translator_mouse.rs` 将选区错误仅匹配 `Ok(Some(..))`，权限/Unsupported/None 都不弹气泡；快捷键 `mod-translator/src/lib.rs::on_shortcut` 会把 PermissionDenied/Unsupported 转成显式指引状态。全局 `NSEvent::addGlobalMonitorForEventsMatchingMask_handler` 返回值为 `Option`，当前代码直接存入 thread-local，没有检查 `None` 或报告注册失败；本入口也没有显式权限 preflight。 | 只有全局鼠标监听已注册、模块与鼠标选择开关已开启、用户完成有效拖选、前台应用 AX 暴露所选文本且授权满足时，鼠标自动气泡才应出现。非 AX 应用、无选区、无权限时自动入口静默不弹是当前实现；快捷键入口应提供拒绝/unsupported 信息。注册返回 `None` 时当前无可见失败提示，Codex 需专门观察，不能把“未弹泡”一概算成无选区。 |
| `password_vault` | `crates/mod-password-vault/src/keystore.rs::production_keystore` 在 macOS 选择 `MacosBiometryKeyStore`，用登录钥匙串 + `BIOMETRY_CURRENT_SET` 保护设备密钥；`os-hal/src/platform/biometry.rs::touch_id_probe` 只探测 Touch ID/Face ID 策略能力，不弹认证框。`os-hal/src/platform/services.rs::verify_identity` 有意总是返回 `Unsupported("native_biometric_authentication")`，不能绕过钥匙串直接用普通认证结果解锁。`crates/mod-password-vault/src/native/macos.rs::NativeVaultObserver::start` 要求 AppKit 主线程；`src-tauri/src/tauri_app.rs::sync_vault_native_observer` 在失败时记录错误并通知关闭页面。 | 有 Touch ID/Face ID enrollment、钥匙串交互与当前签名授权时，密码本设备密钥流程应通过访问控制钥匙串完成；不应要求通用 `verify_identity` 成功。未 enrollment/锁定/拒绝应显示对应错误并保留主密码路径；原生锁屏观察者必须在主线程启动。 |

**本节静态复核的关键验收分组**：

- 预期可用/条件可用：截图（TCC 授权）、macOS Vision OCR、剪贴板历史（系统允许读取，来源为 null）、screen_ink 合成保存（TCC 已授权）、图像转换、可用解释器对应的脚本、app_usage 的 native 指标、便笺 Host 窗口、密码本钥匙串/生物识别访问控制。
- 预期明确不可用：macOS `window_pin` 外部窗口置顶/取消置顶；script_runner 的 PowerShell/Batch/VBScript 类型；OS HAL 的通用 `BiometricAuthenticator::verify_identity`；AX 不支持控件的模拟复制翻译 fallback。
- 预期降级/不可误报：剪贴板 `source_app_name=None`；app_usage 窗口标题可空；自动滚动缺权限时回到手动；翻译鼠标入口可能因 AX/监听注册失败而不弹泡；screen_ink 在未授权时没有与 screenshot 相同的显式 TCC 请求流程。

以上均为代码阅读结论，不是 GUI/权限/系统采集测试结果。

本轮审计命令均先 `. scripts/use-project-environment.sh`，cwd 为本工作树；只读命令：

- `grep -RInE 'cfg\(target_os|Unsupported|PermissionDenied|unavailable|not supported|不支持|权限' crates/mod-*/*/ crates/os-hal/src/ src-tauri/src/translator_mouse.rs`
- `grep -RInE 'start_clipboard_listener|clipboard_owner_snapshot|capture_text\(|capture_image_rgba\(|ClipboardOwnership' src-tauri/src crates/mod-clipboard/src crates/os-hal/src --include='*.rs'`
- `grep -RInE 'write_rgba_clipboard|write_animated_gif_clipboard|with_ocr|UnavailableOcr|NativeVaultObserver|touch_id_probe' src-tauri/src crates --include='*.rs'`

随后只读了表中引用的对应函数/行段。未执行 Cargo/Node 测试、未启动 GUI、未访问系统剪贴板或个人数据；`git diff --check` 通过。

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
6. **剩余平台审计范围**：第 3 节覆盖本轮指定的十个模块和重点能力；其余 native OS HAL/Host 能力未做全面平台降级审计。
