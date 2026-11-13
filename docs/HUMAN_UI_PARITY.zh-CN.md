# 人用优先：十模块界面与快捷键对等矩阵 (Human UI & Shortcut Parity)

## 1. 概述与验证准则

依据 `docs/HUMAN_FIRST_PLAN.zh-CN.md`、`docs/H1_CONTRACT.md` 与固定原项目 HEAD (`575075139fddc8b96d8db1a313c2fe404959c108`) 源码核对。
本清单区分三种真实状态，绝不把源码存在或单元测试通过当成真实 GUI/物理热键已验收：
1. **源码存在 (Source Present)**：原 Vue/Tauri 组件与事件生命周期存在并完整保留。
2. **自动化测试 (Automated Tested)**：已在 `src-ui/tests/unit` 通过无头/模拟单元测试与类型检查验证。
3. **真实 GUI 待验 (Real-GUI Unverified)**：涉及操作系统物理按键抢占、真实 WebView 焦点与视觉呈现，按协作规则由 Codex 独占运行验证。

---

## 2. 全局与局部快捷键对等矩阵

依据原 `USER_GUIDE`、各模块 `ShortcutSpec` 与 `src-ui/src/utils/features.ts` 核对 Windows 默认绑定：

| 动作 ID | 功能描述 | 源码默认逻辑绑定 | Windows 显示键位 | 源码实现 | 自动化测试覆盖 | 真实 GUI/全局键状态 |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| `screenshot:capture` | 区域截图 | `PrimaryMod+Alt+A` | `Ctrl + Alt + A` | 是 | 是 (`shortcut.test.mjs`, `capture-overlay.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `screenshot:long_capture` | 滚动长截图 | 未设置 | `未分配` | 是 | 是 (`screenshot.test.mjs`) | 可由用户自定义录入 |
| `screenshot:gif` | 录制 GIF | 未设置 | `未分配` | 是 | 是 (`screenshot.test.mjs`, `capture-overlay.test.mjs`) | 可由用户自定义录入 |
| `screenshot:ocr` | 屏幕 OCR | 未设置 | `未分配` | 是 | 是 (`screenshot.test.mjs`) | 可由用户自定义录入 |
| `clipboard:toggle_popup` | 剪贴板快速粘贴浮窗 | `PrimaryMod+Alt+D` | `Ctrl + Alt + D` | 是 | 是 (`clipboard-popup.test.mjs`, `launcher.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `screen_ink:toggle_session` | 屏幕画笔注释会话 | `PrimaryMod+Alt+Shift+B` | `Ctrl + Alt + Shift + B` | 是 | 是 (`ink.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `screen_ink:toggle_passthrough` | 注释鼠标穿透切换 | `PrimaryMod+Alt+Shift+S` | `Ctrl + Alt + Shift + S` | 是 | 是 (`ink.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `sticky_note:create` | 快速新建桌面便笺 | 未设置 | `未分配` | 是 | 是 (`sticky-note.test.mjs`) | 可由用户自定义录入 |
| `translator:translate_selection` | 选区划词翻译气泡 | `PrimaryMod+Alt+Shift+T` | `Ctrl + Alt + Shift + T` | 是 | 是 (`translator.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `window_pin:toggle_foreground` | 切换当前前台窗口置顶 | `PrimaryMod+Alt+Shift+C` | `Ctrl + Alt + Shift + C` | 是 | 是 (`launcher.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `window_pin:pick_cursor` | 准星十字拾取置顶窗口 | `PrimaryMod+Alt+Shift+W` | `Ctrl + Alt + Shift + W` | 是 | 是 (`launcher.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `password_vault:open_panel` | 呼出密码本面板 | `PrimaryMod+Alt+E` | `Ctrl + Alt + E` | 是 | 是 (`vault.test.mjs`) | 真实物理键待验 (Codex 独占) |
| `<module>:open_panel` | 各独立模块面板呼出 | 未设置 (各模块独立动作) | `未分配` | 是 | 是 (`launcher.test.mjs`) | 可配置，重复呼出前置旧窗 |
| `script_runner:<id>` | 单脚本专属热键 | 用户逐脚本自定义 | 动态绑定 | 是 | 是 (`launcher.test.mjs`) | 独立持久化，冲突回滚 |

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
  - `Enter`：执行当前项粘贴操作 (`clipboard_paste_candidate`)。
  - `Escape`：立即关闭弹窗并恢复原窗口焦点。
  - 输入框键入：实时关键词过滤，越界时自动复位高亮索引。
- **截图编辑 (`CaptureOverlay.vue`)**:
  - 键盘微调：方向键平移 1px，`Shift + 方向键` 调整选区宽高。

---

## 3. 十大功能模块界面与 IPC 生命周期矩阵

| 模块序号与标识 | 原 UI 视图组件 | 路由 / 窗口参数 | 核心 Tauri IPC Command | 原生 Tauri Event | 自动化测试验证 | 真实 GUI / 桌面验收 |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| **01 主控 / 偏好**<br>`mod-desktop` | `Dashboard.vue`<br>`PreferencesPanel.vue`<br>`ModuleManager.vue` | `window=dashboard`<br>`route=preferences` | `kernel_get_status`<br>`kernel_open_feature`<br>`kernel_get_shortcut_preferences`<br>`kernel_check_shortcut`<br>`kernel_update_shortcut`<br>`kernel_set_shortcut_recording`<br>`kernel_update_general_config`<br>`kernel_open_manual`<br>`kernel_shutdown` | `dashboard://navigate`<br>`kernel://updated`<br>`shortcut://recorded` | 是 (`launcher.test.mjs`<br>共 9 测) | 待 Codex 验收：点击呼出、主题明暗切换、热键录入保存 |
| **02 剪贴板历史**<br>`mod-clipboard` | `ClipboardPopup.vue`<br>`FeaturePanel.vue` (Tab) | `window=clipboard-popup` | `clipboard_get_history`<br>`clipboard_toggle_pin`<br>`clipboard_delete_entry`<br>`clipboard_clear_unpinned`<br>`clipboard_paste_candidate`<br>`clipboard_open_popup` | `clipboard://updated` | 是 (`clipboard-popup.test.mjs`<br>共 9 测) | 待 Codex 验收：全局键唤出、上下键选择、Enter 粘贴 |
| **03 屏幕注释**<br>`mod-screen-ink` | `ScreenInkCanvas.vue`<br>`ScreenInkToolbar.vue` | `window=screen-ink-canvas`<br>`window=screen-ink-toolbar` | `screen_ink_toggle_canvas`<br>`screen_ink_toggle_toolbar`<br>`screen_ink_clear_all`<br>`screen_ink_set_tool` | `ink://state_changed` | 是 (`ink.test.mjs`<br>共 2 测) | 待 Codex 验收：全屏透明画布、穿透绘制 |
| **04 桌面便笺**<br>`mod-sticky-note` | `StickyNote.vue`<br>`FeaturePanel.vue` (Tab) | `window=sticky-note`<br>`id=<uuid>` | `sticky_begin_session`<br>`sticky_get_note`<br>`sticky_save_content`<br>`sticky_save_theme`<br>`sticky_save_window`<br>`sticky_export_markdown`<br>`sticky_pick_save_path`<br>`sticky_close_note`<br>`sticky_flush_ack` | `sticky://flush_save` | 是 (`sticky-note.test.mjs`<br>共 24 测) | 待 Codex 验收：置顶窗口拖拽、防抖存盘、关停前冲刷 |
| **05 划词翻译**<br>`mod-translator` | `TranslateTrigger.vue`<br>`TranslatePopover.vue`<br>`TranslatorPanel.vue` | `window=translate-trigger`<br>`window=translate-popover` | `translator_translate`<br>`translator_get_config`<br>`translator_set_config`<br>`kernel_open_dashboard` | `translator://selection` | 是 (`translator.test.mjs`<br>共 6 测) | 待 Codex 验收：选区气泡定位、API Key 警告 |
| **06 密码本**<br>`mod-password-vault` | `VaultPanel.vue` | `window=feature-vault` | `vault_status`<br>`vault_unlock`<br>`vault_lock`<br>`vault_list_entries`<br>`vault_create_entry`<br>`vault_update_entry`<br>`vault_delete_entry`<br>`vault_reveal_password`<br>`vault_generate_password`<br>`vault_copy_password` | `vault://locked` | 是 (`vault.test.mjs`<br>共 19 测) | 待 Codex 验收：15秒自动遮蔽、关闭自动上锁 |
| **07 媒体转换**<br>`mod-media-proc` | `MediaPanel.vue` | `window=feature-media` | `media_get_env`<br>`media_submit_job`<br>`media_cancel_job`<br>`media_list_jobs`<br>`media_clear_jobs` | `media://job_progress` | 是 (`screenshot.test.mjs`) | 待 Codex 验收：拖拽选图、批量队列进度条 |
| **08 自定义脚本**<br>`mod-script-runner` | `ScriptRunnerPanel.vue` | `window=feature-scripts` | `script_list_scripts`<br>`script_get_interpreters`<br>`script_save_script`<br>`script_delete_script`<br>`script_run_script`<br>`script_cancel_run`<br>`script_get_run_logs` | `script://log`<br>`script://status` | 是 (`launcher.test.mjs`) | 待 Codex 验收：单脚本热键触发、输出流式展示 |
| **09 窗口置顶**<br>`mod-window-pin` | `WindowPinPicker.vue`<br>`PinBadge.vue`<br>`PinMirror.vue` | `window=window-pin-picker`<br>`window=pin-badge`<br>`window=pin-mirror` | `window_pin_list_windows`<br>`window_pin_toggle`<br>`window_pin_pick_cursor`<br>`window_pin_cancel_pick` | `winpin://updated` | 是 (`launcher.test.mjs`) | 待 Codex 验收：十字准星拾取、状态角标联动 |
| **10 屏幕时间**<br>`mod-app-usage` | `AppUsagePanel.vue` | `window=feature-usage` | `app_usage_get_status`<br>`app_usage_get_overview`<br>`app_usage_get_breakdown`<br>`app_usage_set_ignored` | `usage://flushed` | 是 (`app-usage.test.mjs`<br>共 3 测) | 待 Codex 验收：自然日跨夜边界、图表统计呈现 |

---

## 4. 关键生命周期与契约核验结论

1. **多语言与主题一致性 (`i18n.ts`, `theme.ts`)**：
   - `zh-CN.json`、`en-US.json`、`ja-JP.json` 经 `i18n.test.mjs` 测试，Schema 结构 100% 对齐，零缺失键，零空翻译。
   - 主题跟随后端 `kernel_get_status` 返回的 `config.general.theme` 与 `language`，并在前端通过 CSS 变量系统完全解耦。
2. **窗口路由完全复用 (`App.vue`)**：
   - 维持 `window.location.search` 中的 `?window=...&mode=native&id=...` 参数解析机制，原生 Tauri 创建的独立窗口无需重新设计或改写 URL。
3. **前端构建与类型安全**：
   - 在独立工作树内通过 `pnpm install --frozen-lockfile --ignore-workspace` 隔离安装依赖（复用 D 盘包缓存）。
   - 执行 `vue-tsc --noEmit && vite build` 生产构建通过，无任何 TypeScript 类型报错与打包警告。
   - 执行 `pnpm test`，全部 103 项前端单元测试通过。
