# 人用优先：主控台与十模块界面与快捷键对等矩阵 (Human UI & Shortcut Parity)

Codex H1 实测更新：原主窗/偏好、便笺面板与独立便笺、保存/关闭/唤醒/重启、便笺临时全局键、冲突/清除/默认、Esc/Tab 已通过真实 UI/OS 输入验收，见 [INTEGRATION_H1](INTEGRATION_H1.zh-CN.md)。下表原“待验”列是 Agent 交付时的状态；除上述 H1 范围外，其余默认键与模块操作仍待 H2 逐项验收，不能据总体测试数宣称都已通过。

## 1. 概述与验证准则

依据 `docs/HUMAN_FIRST_PLAN.zh-CN.md`、`docs/H1_CONTRACT.md` 与固定原项目 HEAD (`575075139fddc8b96d8db1a313c2fe404959c108`) 源码逐项核对。
本清单区分四种真实状态，绝不把源码存在或单元测试通过当成真实 GUI/物理热键已验收：
1. **源码存在 (Source Present)**：原 Vue/Tauri 组件与事件生命周期存在并完整保留。
2. **自动化测试范围 (Automated Test Scope)**：
   - **格式/工具函数单测 (Unit: format/helper)**：验证纯函数算法、时间边界、坐标变换、二进制头格式等。
   - **组件逻辑与 Fake 单测 (Unit: component fake)**：验证 Vue 组件内的状态机、防抖存盘、关停冲刷应答、冲突拦截等无头逻辑。
   - **无直接前端单测 (No direct unit test)**：前端无对应 `*.test.mjs` 文件，依赖后端集成测试或需 GUI/手工验证。
3. **真实 GUI / 全局键待验 (Real OS / GUI Unverified)**：涉及操作系统物理按键抢占、真实 WebView 焦点与视觉呈现，按协作规则由 Codex 独占运行验证。
4. **敏感凭据安全边界 (Human Manual Acceptance Only)**：密码本主密码设置与解锁、Windows Hello / 生体认证、明文密码查看与敏感凭据操作严格限定为**用户本人手工操作验收**，严禁由任何 AI Agent 自动化执行。

---

## 2. 全局与局部快捷键对等矩阵

依据原 `USER_GUIDE`、各模块 `ShortcutSpec`、`crates/mod-*/src/lib.rs` 与 `src-ui/src/utils/features.ts` 核对 Windows 默认绑定：

| 动作 ID | 功能描述 | 源码默认逻辑绑定 | Windows 显示键位 | 源码实现 | 自动化测试覆盖 | 真实 GUI / 全局键状态 |
| :--- | :--- | :--- | :--- | :---: | :--- | :---: |
| `screenshot:capture` | 区域截图 | `PrimaryMod+Alt+A` | `Ctrl + Alt + A` | 是 | 单元测试覆盖选区交互与遮罩 Fake (`capture-overlay.test.mjs`, `screenshot.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `screenshot:scroll` | 滚动长截图 | 未设置 | `未分配` | 是 | 无直接前端单测 (仅工具函数格式测试 `screenshot.test.mjs`) | 可由用户在偏好设置中录入自定义键 |
| `screenshot:gif` | 录制 GIF | 未设置 | `未分配` | 是 | 选区交互 Fake 与格式工具函数 (`capture-overlay.test.mjs`, `screenshot.test.mjs`) | 可由用户在偏好设置中录入自定义键 |
| `screenshot:ocr` | 屏幕 OCR | 未设置 | `未分配` | 是 | 无直接前端 OCR 单测；截图选区/格式测试不等于 OCR 测试 | 可由用户在偏好设置中录入自定义键 |
| `clipboard:toggle_popup` | 剪贴板快速粘贴浮窗 | `PrimaryMod+Alt+D` | `Ctrl + Alt + D` | 是 | 覆盖候选窗按键过滤/导航/粘贴 Fake (`clipboard-popup.test.mjs`, `launcher.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `screen_ink:toggle_session` | 屏幕画笔注释会话 | `PrimaryMod+Alt+Shift+B` | `Ctrl + Alt + Shift + B` | 是 | 仅覆盖工具栏撤销栈与激光笔 Fake (`ink.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `screen_ink:toggle_passthrough` | 注释鼠标穿透切换 | `PrimaryMod+Alt+Shift+S` | `Ctrl + Alt + Shift + S` | 是 | 无独立单测 (组件内通过 BroadcastChannel / IPC 调用) | 真实物理键待验 (Codex 独占) |
| `sticky_note:create` | 快速新建桌面便笺 | 未设置 | `未分配` | 是 | 覆盖便笺防抖保存/生命周期/冲刷 Fake (`sticky-note.test.mjs`) | 可由用户在偏好设置中录入自定义键 |
| `translator:translate_selection` | 选区划词翻译气泡 | `PrimaryMod+Alt+Shift+T` | `Ctrl + Alt + Shift + T` | 是 | 覆盖气泡组件缓冲/流式分块/无选区保护 Fake (`translator.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `window_pin:toggle_foreground` | 切换当前前台窗口置顶 | `PrimaryMod+Alt+Shift+C` | `Ctrl + Alt + Shift + C` | 是 | 无直接动作单测 (`launcher.test.mjs` 仅测窗口置顶候选列表属性合并 Fake) | 真实物理键待验 (Codex 独占) |
| `window_pin:pick_cursor` | 准星十字拾取置顶窗口 | `PrimaryMod+Alt+Shift+W` | `Ctrl + Alt + Shift + W` | 是 | 无直接动作单测 (`launcher.test.mjs` 仅测窗口置顶候选列表属性合并 Fake) | 真实物理键待验 (Codex 独占) |
| `password_vault:open_panel` | 呼出密码本面板 | `PrimaryMod+Alt+E` | `Ctrl + Alt + E` | 是 | 单元测试仅覆盖表单校验/自动锁定 Fake (`vault.test.mjs`) | **必须由用户本人手工操作验收** (严禁 Agent 自动操作密码本) |
| `<module>:open_panel` | 各独立模块面板呼出 | 未设置 (各模块独立动作) | `未分配` | 是 | 覆盖偏好设置录入/冲突/更新 Fake (`launcher.test.mjs`) | 可由用户在偏好设置中录入自定义键 |
| `script_runner:<id>` | 单脚本专属热键 | 用户逐脚本自定义 | 动态绑定 | 是 | **无直接前端单测覆盖** (动态绑定与冲突回滚由 Rust 内核管理) | 待后续集成测试或由用户在脚本面板自定义 |

### 窗口内局部键盘操作 (Local Keybindings)
- **快捷键录入框 (`PreferencesPanel.vue`)**:
  - `Tab`：保留原生焦点导航，不录制为快捷键。
  - `Escape`：取消录入并放弃草稿（blur）。
  - 修饰键与实体按键 (`Ctrl/Alt/Shift/Win + Key/F-key`)：通过 `shortcutFromEvent` 精确转换为物理键符。
  - 拦截并忽略：输入法合成中 (`isComposing`)、自动按键重复 (`repeat`)、单独修饰键。
  - 预检与冲突提示：调用 `kernel_check_shortcut`，冲突时高亮拦截保存。
  - 重置与清除：支持恢复默认 (`spec.default_logical_hotkey`) 或清除 (`null`)。
- **便笺窗口 (`StickyNote.vue`)**:
  - 标题与正文输入：400ms 防抖自动保存 (`sticky_save_content`)。
  - 窗口关闭：`closeNoteWindow` 等待未完成保存冲刷后再触发原生窗口销毁。
- **剪贴板候选窗 (`ClipboardPopup.vue`)**:
  - `ArrowUp` / `ArrowDown`：切换候选项高亮，无焦点时也能由窗口级监听捕获。
  - `Enter`：执行当前项粘贴操作 (`clipboard_paste_item`)。
  - `Escape`：立即关闭弹窗并恢复原窗口焦点。
  - 输入框键入：实时关键词过滤，越界时自动复位高亮索引。
- **截图编辑 (`CaptureOverlay.vue`)**:
  - 键盘微调：方向键平移 1px，`Shift + 方向键` 调整选区宽高。

---

## 3. 主控台与十大功能模块界面与 IPC 生命周期矩阵

结构明确为主控台 (Host Launcher & Preferences) + 十大功能模块 (01 到 10)：

| 模块序号与标识 | 原 UI 视图组件 | 路由 / 窗口参数 (`App.vue` & `FeaturePanel.vue`) | 核心 Tauri IPC Command | 原生 Tauri Event | 自动化测试验证 | 真实 GUI / 桌面验收 |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **主控台 / 偏好设置**<br>`mod-desktop` (宿主内核与主窗口) | `Dashboard.vue`<br>`PreferencesPanel.vue`<br>`ModuleManager.vue` | `window=dashboard` (默认空或 `dashboard`)<br>`route=/overview`<br>`route=/preferences` | `kernel_get_status`<br>`kernel_open_feature`<br>`kernel_open_dashboard`<br>`kernel_open_manual`<br>`kernel_shutdown`<br>`kernel_check_shortcut`<br>`kernel_check_shortcuts`<br>`kernel_update_shortcut`<br>`kernel_set_shortcut_recording`<br>`kernel_update_general_config`<br>`kernel_set_module_enabled`<br>`kernel_trigger_shortcut`<br>`kernel_destroy_window` | `dashboard://navigate`<br>`kernel://updated`<br>`shortcut://recorded` | 组件逻辑与录入/冲突 Fake (`launcher.test.mjs` 共 9 测) | 待 Codex 验收：点击呼出、主题明暗切换、热键录入保存防抖与冲突拦截 |
| **01 增强截图与贴图**<br>`mod-screenshot` | `CaptureOverlay.vue`<br>`PinImage.vue`<br>`ScreenshotControl.vue`<br>`ScreenshotPreview.vue`<br>`ScreenshotPanel.vue` | `window=capture-overlay`<br>`window=pin-img-<id>` (映射为 `pin-image`)<br>`window=screenshot-control`<br>`window=screenshot-preview`<br>`window=feature-screenshot` | `screenshot_get_status`<br>`screenshot_start_capture`<br>`screenshot_get_session`<br>`screenshot_overlay_ready`<br>`screenshot_resolve_region`<br>`screenshot_cancel`<br>`screenshot_export`<br>`screenshot_ocr`<br>`screenshot_list_monitors`<br>`screenshot_pin_info`<br>`screenshot_close_pin`<br>`screenshot_close_all_pins`<br>`screenshot_pin_copy`<br>`screenshot_pin_save`<br>`screenshot_get_config`<br>`screenshot_update_settings`<br>`screenshot_scroll_start`<br>`screenshot_scroll_stop`<br>`screenshot_scroll_cancel`<br>`screenshot_scroll_status`<br>`screenshot_scroll_export`<br>`screenshot_gif_start`<br>`screenshot_gif_stop`<br>`screenshot_gif_confirm`<br>`screenshot_gif_save_as`<br>`screenshot_gif_copy`<br>`screenshot_gif_cancel`<br>`screenshot_gif_status` | `screenshot://scroll-frame-stitched`<br>`screenshot://gif-recording-stats`<br>`kernel://updated` | 选区计算/贴图/OCR 格式与事件 (`screenshot.test.mjs` 19 测, `capture-overlay.test.mjs` 3 测) | 待 Codex 验收：全屏冻结帧呈现、选区微调平移、贴图置顶与长截图/GIF 控制条 |
| **02 剪贴板历史**<br>`mod-clipboard` | `ClipboardPopup.vue`<br>`FeaturePanel.vue` (Tab: `clipboard`) | `window=clipboard-popup`<br>`window=feature-clipboard` | `clipboard_list_items`<br>`clipboard_toggle_pin`<br>`clipboard_paste_item`<br>`clipboard_delete_item`<br>`clipboard_clear_unpinned`<br>`kernel_destroy_window` | 窗口内由 DOM `keydown`/`focus` 驱动，内核更新监听 `kernel://updated` | 候选窗按键过滤/高亮移动/Enter 粘贴 Fake (`clipboard-popup.test.mjs` 共 9 测) | 待 Codex 验收：全局键快速呼出、物理上下键导航、失焦自动关闭与前台目标焦点恢复 |
| **03 屏幕画笔注释**<br>`mod-screen-ink` | `ScreenInkCanvas.vue`<br>`ScreenInkToolbar.vue`<br>`FeaturePanel.vue` (Tab: `screen_ink`) | `window=screen-ink-canvas`<br>`window=screen-ink-toolbar`<br>`window=feature-screen_ink` | `ink_get_status`<br>`ink_get_config`<br>`ink_start_session`<br>`ink_exit_session`<br>`ink_set_passthrough`<br>`ink_clear_canvas`<br>`ink_apply_cursor`<br>`ink_save_snapshot` | `screen-ink://clear-canvas`<br>`screen-ink://mode-changed` (连字符) | 仅覆盖工具栏撤销栈与激光笔 Fake (`ink.test.mjs` 共 2 测) | 待 Codex 验收：全屏透明画布、鼠标穿透下层窗口绘制、会话退出清理 |
| **04 桌面便笺**<br>`mod-sticky-note` | `StickyNote.vue`<br>`FeaturePanel.vue` (Tab: `sticky`) | `window=sticky-note&id=<uuid>`<br>`window=feature-sticky_note` | `sticky_list_notes`<br>`sticky_create_note`<br>`sticky_open_note`<br>`sticky_close_note`<br>`sticky_delete_note`<br>`sticky_begin_session`<br>`sticky_get_note`<br>`sticky_save_content`<br>`sticky_update_theme`<br>`sticky_update_window_state`<br>`sticky_pick_save_path`<br>`sticky_save_markdown`<br>`sticky_flush_result` | `sticky://flush-close`<br>`sticky://flush-save`<br>`sticky://flush-cancel`<br>`sticky://shutdown-blocked` (连字符) | 便笺防抖存盘、关停前冲刷应答、Markdown 导出 Fake (`sticky-note.test.mjs` 共 24 测) | 待 Codex 验收：独立置顶多便笺、透明度滑动调节、进程关停前双向同步冲刷 |
| **05 选区划词翻译**<br>`mod-translator` | `TranslateTrigger.vue`<br>`TranslatePopover.vue`<br>`TranslatorPanel.vue`<br>`FeaturePanel.vue` (Tab: `translator`) | `window=translate-trigger`<br>`window=translate-popover`<br>`window=feature-translator` | `translator_get_config`<br>`translator_update_config`<br>`translator_list_providers`<br>`translator_get_api_key_storage`<br>`translator_set_api_key`<br>`translator_translate`<br>`translator_take_selection`<br>`translator_open_mouse_selection`<br>`translator_close_popover`<br>`kernel_open_dashboard` | `translator://stream-chunk`<br>`translator://selection-ready` (连字符) | 选区解析/流式翻译增量呈现/气泡 Fake (`translator.test.mjs` 共 6 测) | 待 Codex 验收：鼠标选区坐标气泡吸附、快捷键划词流式响应、配置保存 |
| **06 密码本**<br>`mod-password-vault` | `VaultPanel.vue`<br>`FeaturePanel.vue` (Tab: `vault`) | `window=feature-password_vault` | `vault_get_status`<br>`vault_initialize`<br>`vault_unlock_biometric`<br>`vault_set_biometric_enabled`<br>`vault_unlock_master_password`<br>`vault_lock`<br>`vault_list_entries`<br>`vault_get_entry`<br>`vault_upsert_entry`<br>`vault_delete_entry`<br>`vault_copy_password`<br>`vault_reveal_password`<br>`vault_generate_password`<br>`vault_change_master_password`<br>`vault_totp_code`<br>`vault_hotp_advance`<br>`vault_copy_totp` | `vault://locked` | 表单校验/TOTP计算/密码生成/自动锁 Fake (`vault.test.mjs` 共 25 测) | **必须由用户本人手工操作验收** (严禁 AI 自动操作密码本)：主密码设置与解锁、生体认证、密码复制与遮蔽 |
| **07 媒体转换**<br>`mod-media-proc` | `MediaPanel.vue`<br>`FeaturePanel.vue` (Tab: `media`) | `window=feature-media_proc` | `media_pick_files`<br>`media_pick_directory`<br>`media_check_ffmpeg_env`<br>`media_get_config`<br>`media_update_config`<br>`media_list_jobs`<br>`media_convert_images`<br>`media_submit_av_job`<br>`media_inspect_file`<br>`media_cancel_job` | `media://job-progress` (连字符)<br>`tauri://drag-drop` | **无直接前端单测** (批量音视频/图片转换底层由 Rust 后端单测覆盖) | 待 Codex 验收：文件拖拽进面板、FFmpeg 探测提示、队列转换进度条实时刷新 |
| **08 自定义脚本**<br>`mod-script-runner` | `ScriptRunnerPanel.vue`<br>`FeaturePanel.vue` (Tab: `scripts`) | `window=feature-script_runner` | `script_probe_interpreters`<br>`script_list`<br>`script_list_runs`<br>`script_save`<br>`script_delete`<br>`script_execute`<br>`script_kill`<br>`script_get_logs` | 实时日志由前端轮询 `script_get_logs`；宿主广播 `script://execution-started`<br>`script://execution-finished`<br>`kernel://updated` | **无直接前端单测** (脚本进程超时/环境变量注入/强杀由 Rust 后端覆盖) | 待 Codex 验收：解释器探测高亮、脚本新增保存、执行日志实时输出与中断 |
| **09 窗口置顶**<br>`mod-window-pin` | `WindowPinPicker.vue`<br>`PinBadge.vue`<br>`PinMirror.vue`<br>`FeaturePanel.vue` (Tab: `winpin`) | `window=window-pin-picker`<br>`window=pin-badge-<handle>`<br>`window=pin-mirror-<handle>`<br>`window=feature-window_pin` | `winpin_list_candidates`<br>`winpin_toggle_handle`<br>`winpin_activate`<br>`winpin_restore_all`<br>`winpin_toggle_foreground`<br>`winpin_pick_at_cursor`<br>`winpin_unpin`<br>`kernel_destroy_window` | 外部窗口状态更新由内核广播 `kernel://updated` | 仅覆盖 `FeaturePanel` 外部窗口列表与托管状态合并 Fake (`launcher.test.mjs` 1 测)；拾取与底层置顶无直接单测 | 待 Codex 验收：十字准星全屏拾取窗口、外部第三方窗口 Topmost 状态保持与还原 |
| **10 应用使用时长**<br>`mod-app-usage` | `AppUsagePanel.vue`<br>`FeaturePanel.vue` (Tab: `usage`) | `window=feature-app_usage` | `usage_get_status`<br>`usage_get_overview`<br>`usage_get_hourly`<br>`usage_get_apps`<br>`usage_get_sessions`<br>`usage_set_app_category`<br>`usage_update_config` | 数据采样更新由内核广播 `kernel://updated` | 日期聚合/分类统计/跨夜边界格式化 Fake (`app-usage.test.mjs` 共 3 测) | 待 Codex 验收：前后日翻页统计图表、按小时分布柱状图、应用分类配置 |

---

## 4. 关键生命周期与契约核验结论

1. **多语言与主题一致性 (`i18n.ts`, `theme.ts`)**：
   - `zh-CN.json`、`en-US.json`、`ja-JP.json` 经 `i18n.test.mjs` 测试（共 2 测），Schema 结构 100% 对齐，零缺失键，零空翻译。
   - 主题跟随后端 `kernel_get_status` 返回的 `config.general.theme` 与 `language`，并在前端通过 CSS 变量系统完全解耦。
2. **窗口路由与参数映射 (`App.vue` & `FeaturePanel.vue`)**：
   - 维持 `window.location.search` 中的 `?window=...&mode=native&id=...` 参数解析机制，原生 Tauri 创建的独立窗口无需重新设计或改写 URL。
   - `feature-<module>` 路由严格按 `src/utils/features.ts` 映射至对应的 Tab 页（例如 `feature-screenshot` 映射至 `screenshot`，`feature-media_proc` 映射至 `media`，`feature-password_vault` 映射至 `vault`）。
3. **前端构建与测试覆盖实况**：
   - 依赖隔离安装：在工作树内通过 `pnpm install --frozen-lockfile --ignore-workspace` 独立安装于 `src-ui/node_modules`（复用 D 盘只读全局缓存）。
   - 类型检查与打包：`vue-tsc --noEmit && vite build` 生产构建 100% 通过（122 modules transformed），0 错误，0 警告。
   - 前端无头单测：执行 `pnpm test`，全部 11 个测试套件、共 103 项前端单元测试全部通过（耗时约 4.4s）。
4. **安全与协同约束**：
   - 密码本认证与敏感凭据（Master Password、Touch ID / Windows Hello）严格标记为**用户本人手工操作验收**，绝不委托给任何自动化 Agent。
   - 桌面全屏与物理热键（Windows 全局按键抢占、真实 WebView 焦点与视觉呈现）严格遵循协作规则由 Codex 独占运行验证，不擅自启动桌面 GUI。
