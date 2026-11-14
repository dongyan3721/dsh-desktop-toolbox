# ANTIGRAVITY 交接报告：macOS 前端与原界面对等核查与平台缺陷修复

- 日期：2026-11-14
- 分支：`codex/macos-antigravity`
- 工作树：`/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/antigravity`
- 协作者：Antigravity (Zed ACP)
- 提交者邮箱：`2914566893@qq.com`

---

## 1. 独立程序 0.1.4 与插件原界面差异核查

对比基线：`/Users/santa_antilles/Desktop/your_all_in_one/src-ui/src` vs `native/YourAllIn1Helper/src-ui/src`

### 1.1 完全一致项（Byte-for-byte 对等）
以下 20 个核心 UI 视图组件与通用样式在两棵树之间完全一致：
- `App.vue`、`CaptureOverlay.vue`、`ClipboardPopup.vue`、`Icons.vue`、`MediaPanel.vue`
- `PinBadge.vue`、`PinImage.vue`、`PinMirror.vue`、`ProductLogo.vue`、`SaveToast.vue`
- `ScreenInkToolbar.vue`、`ScreenshotControl.vue`、`ScreenshotPanel.vue`、`ScreenshotPreview.vue`
- `ScriptRunnerPanel.vue`、`TranslatePopover.vue`、`TranslateTrigger.vue`、`TranslatorPanel.vue`
- `VaultPanel.vue`、`WindowPinPicker.vue`
- `styles/macos-base.css`、`utils/screenshot/*`、`utils/windowDrag.ts`、`utils/theme.ts` 等

### 1.2 预期且受控的插件特有差异（保留插件架构，不回退）
- `api/ipc.ts`：保留 `setIpcTransport`、`activeTransport` 与 `agent_supported` / `agent_allowed` 字段，支持 Harness 内嵌 Human 控制台与 Agent 闭集授权。
- `components/ModuleManager.vue`：保留人/Agent 双开关架构（功能开启 + Agent 授权），macOS 下正确联动 `window_pin` 的 `statusUnsupportedWinPin`（“当前系统不支持外部窗口真正置顶”）。
- `components/Dashboard.vue`：保留 `embedded` 属性兼容逻辑（重试连接、引导打开独立主窗口、主题同步），独立窗口模式仍保留退出微内核按钮。
- `components/PreferencesPanel.vue` 与 `utils/shortcutDiagnostics.ts`：保留分类细致的快捷键排查诊断详情（避免虚构占用程序，支持单项重新检测）。
- `components/ScreenInkCanvas.vue` 与 `components/StickyNote.vue`：保留协同命令接口（画笔/便笺受控写入与快照能力）。
- `styles/panel-cards.css`：从 `FeaturePanel.vue` 解耦抽取的通用指标卡片样式，已通过 `main.ts` 正确全局引入。

---

## 2. 确定平台缺陷修复

在 macOS 运行环境下发现并修复以下前端平台适配缺陷：

1. **快捷键展示平台符号回退缺陷**（`src/utils/features.ts`）：
   - **问题**：`displayRecordedShortcut(hotkey, os)` 原先依赖 `os === 'macos'`。当微内核状态尚未完成首轮拉取或 `target_os` 暂时为空时，`os` 传空导致快捷键录入框回退到 Windows 键名（如 `Super` 显示为 `Win`）。
   - **修复**：当 `os` 未传或为空时，回退检测 `navigator.platform` 与 `navigator.userAgent` 中的 macOS 特征，在 Mac 上默认渲染 Apple 原生符号（`⌃`, `⌥`, `⇧`, `⌘`）。
2. **跨平台修饰键宏解析缺陷**（`src/utils/actionShortcuts.ts`）：
   - **问题**：`localShortcut` 原先仅正则检查 `navigator.platform`。在现代无头环境或部分特定浏览器配置中 `navigator.platform` 可能缺失或返回通用值。
   - **修复**：增加 `navigator.userAgent`（`/Macintosh|Mac OS X/i`）补充判断，确保 `PrimaryMod` 可靠映射为 `⌘`。
3. **密码本设备验证提供商名称探测**（`src/utils/vault/text.ts`）：
   - **问题**：`deviceVerificationName` 原先仅使用 `navigator.platform`。
   - **修复**：增加 `navigator.userAgent` 双重检测，确保 macOS 下准确返回 `Touch ID`。
4. **前端自动化回归测试补充**（`tests/unit/launcher.test.mjs`）：
   - 增加 `displayRecordedShortcut` 在省略 `os` 参数且运行在 macOS 下时输出 `⇧ + ⌘ + V` 的断言。
   - 增加 `localShortcut` 在 `navigator.platform` 为空但 `userAgent` 包含 `Macintosh` 时正确映射为 `⌘` 的断言。

---

## 3. 验证命令与实际结果

严格按照工作树环境规范执行非 GUI 自动化验证：

```bash
cd /Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/antigravity
source scripts/use-project-environment.sh
export PATH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin:$PATH"
cd native/YourAllIn1Helper/src-ui
npm test
npm run build
```

- **测试结果**：14 个测试套件，共 175 项单元测试全部通过（0 失败，0 忽略，用时约 1.08 秒）。
- **构建结果**：`vue-tsc --noEmit && vite build` 生产构建成功，无类型报错，产物正常生成（用时约 1.03 秒）。

---

## 4. 边界合规说明与待验证项

- **边界合规**：
  - 未修改任何 Rust 源码、Cargo 清单或锁文件。
  - 未修改根清单、embedded adapter、shared contracts。
  - 未对桌面独立仓库 `/Users/santa_antilles/Desktop/your_all_in_one` 作任何写入（只读核对）。
  - 未执行任何 GUI/桌面启动操作。
- **待 Codex 验证项**：
  - 由 Codex 在 macOS 环境下进行真实 Tauri 桌面启动与快捷键录制真实交互验收。
