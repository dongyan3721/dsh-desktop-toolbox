# Grok Build 交接 — beta.5 快捷键冲突诊断

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`

分支：`agent/cursor-native`（开工时已在 beta.4 同步点 `360b05c` 之后，HEAD 当时是 `4b5512e`）

提交：还没有。代码和测试已在工作树里。用户要求停止 PowerShell 审批弹窗后再继续，所以本轮没有执行 `git add` / `git commit`。Codex 可以在始终允许打开后，只提交下面列出的任务路径。

没有运行真实 `RegisterHotKey`、真实 GUI、全局按键，也没有安装用户 Profile。

## 改了什么

Windows 公开 API 不能指出是哪个进程占用了 `RegisterHotKey`。诊断因此只报告能证明的事实：内部冲突给出模块、动作和脚本；系统失败给出组合键、动作、分类、错误码和原始详情；外部占用程序保持未知，除非响应里已经有一份通过校验的确认对象。实现不会枚举进程、不会读前台窗口、不会调用 `WM_GETHOTKEY`，也不会按常见软件猜占用者。

`kernel_check_shortcut` / `kernel_check_shortcuts` 仍返回原来的 `status`、`conflicts`、`detail`。每个检查多一个可选 `diagnosis`。偏好行在已有 `native_error` 时也带同一个对象；没有注册失败时 `native_error` 和 `diagnosis` 都是 `null`。

检查结果已经由 `shortcut_conflicts.rs` 放进现有 JSON。`tauri_app.rs` 原样返回该 JSON，`lib.rs` 不用新增 `mod`。新模块用 `shortcut_conflicts.rs` 里的 `#[path = "shortcut_diagnostics.rs"]` 接上。不需要 Codex 改 `tauri_app.rs`、`lib.rs` 或 `ipc.ts`。前端类型在 `src-ui/src/utils/shortcutDiagnostics.ts`。Copilot 以后可以把同名字段补进 `ipc.ts`，不补也不影响偏好页。

## diagnosis

```json
{
  "category": "registration_occupied",
  "os_error_code": 1409,
  "owner": null,
  "guidance": ["owner_unknown", "recheck", "change_combo"],
  "suggestions": ["app_settings", "common_tools"],
  "subjects": []
}
```

| 字段 | 含义 |
| --- | --- |
| `category` | 见下表。未知字符串不会被改写成“已被其他程序占用”。 |
| `os_error_code` | 有显式 `(os error N)` 时用该数字。没有数字、但文本是下面写明的 1409 短语时为 `1409`。否则 `null`。 |
| `owner` | 本轮 Rust 永远是 `null`。没有确认来源时不填 PID 或程序名。 |
| `guidance` | 可执行步骤的稳定代码，界面按三种语言显示。 |
| `suggestions` | 只作为排查建议的代码。界面注明这些不是已确认的占用程序。 |
| `subjects` | 仅内部冲突。每项是 `module_id`、`action_id`、`description`、`enabled`、`kind`。`kind` 为 `script` 的条件是 `module_id == "script_runner"` 或 `action_id` 以 `script:` 开头。不复制 `native_error`、路径或窗口标题。 |

`category` 与原来的 `status`：

| category | 何时使用 | status |
| --- | --- | --- |
| `internal_conflict` | 规范化后与本工具箱另一个动作或脚本相同 | `internal_conflict` |
| `invalid_combo` | 规范化失败，或系统错误 87 | `invalid`，或 `os_unavailable` 且码为 87 |
| `system_reserved` | 注册失败，且物理加速键恰好是 `F12`（没有别的修饰键） | `os_unavailable` |
| `system_denied` | 显式系统错误 5。短语里即使出现 “already registered” 也以显式错误码为准 | `os_unavailable` |
| `registration_occupied` | 显式 1409，或下面的 1409 短语且没有别的显式错误码。`Ctrl+F12` 属于这一类，不是调试器保留 | `os_unavailable` |
| `probe_failed` | `status` 为 `probe_error`，包括临时注册后清理失败。清理失败不会改判成占用 | `probe_error` |
| `not_checked` | 调用方传入 `NativeCheck::NotChecked`。无界面的 `ipc/kernel.rs` 仍是这条路径 | `not_checked` |
| `unknown_system_failure` | 其他注册失败。单词 “reserved”、前台程序名、PID 都不会变成占用或系统保留 | `os_unavailable` |
| `available` / `unassigned` | 与原状态一致 | 同名 status |

`guidance` 代码：`owner_unknown`、`recheck`、`change_combo`、`probe_failed`、`cleanup_failed`、`not_checked`、`system_denied`、`invalid`、`reserved_f12`、`unknown_failure`、`internal`。

`suggestions` 代码：`app_settings`、`common_tools`、`windows_key`。`common_tools` 只出现在 `registration_occupied`。加速键含 `Super`、`Win` 或 `Meta` 时可以多一个 `windows_key`，文案说明这是微软文档中的保留说明，不能确定程序。`system_denied` 和 `unknown_system_failure` 不附带常见软件名单，避免把拒绝或未知错误说成另一个应用。

界面只接受这种 `owner`：`pid` 是 `1..=0xFFFFFFFF` 的整数，`program` 是不超过 128 字符的程序名，且不含路径分隔符、盘符冒号、`..` 或 Windows 非法文件名字符。路径、命令行和只有名字没有 PID 的对象都显示为未知。Rust 当前不会发出非空 `owner`。

偏好页把组合键、动作、分类和原始详情放在页面上。`<details>` 可展开，另有按钮「重新检测」。错误不再只放在 `title` 里。重新检测会检查当前草稿，没有草稿时检查已保存的逻辑热键。全部检测结果里，每个已分配项都是 `not_checked` 时，摘要改为“这次检测没有向系统注册热键”，而不是“0 项需要调整”。非 Tauri 渲染仍走原来的 `invokeIpc` 回退；探测没有执行时就这样说明。没有自动改键，也没有关闭其他程序的操作。

## API 证据和限制

微软文档 [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)（页面标注 2026-08-05）写明：函数只返回 BOOL，失败时用 `GetLastError`。它不返回占用者 PID 或程序名。同一页写明 F12 始终保留给调试器，不应注册为热键；带 Windows 键的快捷键保留给操作系统。PrintScreen 被写成系统已有热键，前台窗口有时仍能覆盖，所以本实现不把 PrintScreen 判成系统保留。`WM_GETHOTKEY` 只对 `WM_SETHOTKEY` 的窗口热键有意义，不能代表全部 `RegisterHotKey`，因此没有调用。

本仓库锁定的 `global-hotkey` 0.8.0 在 `src/platform_impl/windows/mod.rs` 里只把 `ERROR_HOTKEY_ALREADY_REGISTERED`（1409）变成 `HotKey already registered: ...`。其他 Win32 错误变成 `std::io::Error`，显示文本带 `(os error N)`，1409 这条路径反而没有数字。`tauri-plugin-global-shortcut` 2.4.1 只转发这段显示文本。所以没有 `(os error N)` 时，只有上述短语才记成 1409。这是这一版依赖的映射，不是从进程表反查出来的。

没有公开、稳定、且不模拟按键、不注入、不加载驱动的接口可以列出 `RegisterHotKey` 的持有进程。占用程序因此保持“系统未提供”。

## 测试

Rust，工作树根目录先 dot-source `scripts/Use-ProjectEnvironment.ps1`。命令退出码 0，8 通过，0 失败，过滤掉 75。没有调用真实热键注册：

```text
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 shortcut_conflicts:: preferences::tests::native_registration_text
```

通过的测试：

- `preferences::tests::native_registration_text_is_classified_without_copying_a_guessed_program`
- `shortcut_conflicts::shortcut_diagnostics::tests::explicit_os_error_wins_and_does_not_treat_every_failure_as_occupation`
- `shortcut_conflicts::shortcut_diagnostics::tests::internal_subjects_copy_only_module_action_and_script_description`
- `shortcut_conflicts::shortcut_diagnostics::tests::maps_global_hotkey_1409_phrase_without_naming_a_process`
- `shortcut_conflicts::shortcut_diagnostics::tests::reserves_only_bare_f12_and_keeps_cleanup_failures_separate`
- `shortcut_conflicts::tests::checks_find_normalized_disabled_and_script_conflicts_without_mutating_configuration`
- `shortcut_conflicts::tests::native_probe_preserves_owned_callbacks_and_never_unregisters_external_bindings`
- `shortcut_conflicts::tests::scans_report_os_unavailability_and_headless_unknown_without_probing_unassigned_keys`

前端，在 `native/YourAllIn1Helper/src-ui` 运行。该工作树没有自己的 `node_modules`，测试前临时把目录联接到集成树已有的 `native/YourAllIn1Helper/src-ui/node_modules`，只读使用。18 通过，0 失败：

```text
node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/unit/shortcut-diagnostics.test.mjs tests/unit/launcher.test.mjs tests/unit/i18n.test.mjs
```

覆盖分类、内部动作和脚本名、未知占用者、路径形式的伪造 owner、清理失败、重新检测，以及详情控件存在且错误不在 `title` 上。语言键三份一致。

这 18 项跑完之后，`PreferencesPanel.vue` 的分组计数又加了一行：还没有新检查、但已有 `native_error` 且诊断为阻塞时，分组徽章也计数。这一行没有再跑测试。

临时 junction 已用 `cmd /c rmdir` 去掉，该命令退出码 0。没有再做一次存在性复查。没有对集成树的 `node_modules` 执行安装。

编译宿主库时，既有 `os-hal` 不可达表达式警告和 `mod-password-vault` 未使用项警告仍在，本次没有改那些文件。

## 给 Codex 的接线

不需要补丁。桌面 IPC 里的 `kernel_check_shortcut` 和 `kernel_check_shortcuts` 已经调用 `DesktopHost::check_shortcut`，诊断在返回值里。`kernel_get_shortcut_preferences` 的失败行带 `diagnosis`。

无界面分发器仍把系统探测固定为 `NotChecked`。嵌入控制台如果走 Tauri 窗口 IPC，会执行现有的非破坏性 probe；如果走无界面分发器，诊断类别是 `not_checked`，界面会说明没有做系统注册探测。不要把这条结果改写成其他程序占用。

真实热键占用、释放后重检和 GUI 仍留给 Codex。本轮没有做。

## 任务路径

- `native/YourAllIn1Helper/src-tauri/src/shortcut_diagnostics.rs`
- `native/YourAllIn1Helper/src-tauri/src/shortcut_conflicts.rs`
- `native/YourAllIn1Helper/src-tauri/src/preferences.rs`
- `native/YourAllIn1Helper/src-ui/src/utils/shortcutDiagnostics.ts`
- `native/YourAllIn1Helper/src-ui/src/components/PreferencesPanel.vue`
- `native/YourAllIn1Helper/src-ui/src/locales/zh-CN.json`
- `native/YourAllIn1Helper/src-ui/src/locales/en-US.json`
- `native/YourAllIn1Helper/src-ui/src/locales/ja-JP.json`
- `native/YourAllIn1Helper/src-ui/tests/unit/shortcut-diagnostics.test.mjs`
- `native/YourAllIn1Helper/src-ui/tests/unit/launcher.test.mjs`
- `docs/handoffs/ZED_B5_GROK.md`
