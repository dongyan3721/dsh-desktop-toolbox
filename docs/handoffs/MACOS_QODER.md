# MACOS_QODER：独立桌面 0.1.4-beta 与插件 native 0.1.3-beta 只读比对及解耦方案

日期：2026-11-14。分支：`codex/macos-qoder`。工作树：`/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/qoder`。任务：`docs/tasks/MACOS_QODER.md`。

本轮唯一新增文件即本文。两项目业务代码均未改动；独立仓库 `/Users/santa_antilles/Desktop/your_all_in_one` 全程只读（git archive/log/diff、grep、curl、shasum；未 fetch、未切换分支、未读 `.runtime_data` 等个人数据）。临时输出仅在本工作树 `.tmp/`。

## 1. 版本与 revision 核实

| 项 | 插件 native（本工作树） | 独立桌面（只读） |
| --- | --- | --- |
| 路径 | `native/YourAllIn1Helper` | `/Users/santa_antilles/Desktop/your_all_in_one` |
| workspace / package.json / tauri.conf.json | `0.1.3-beta` | `0.1.4-beta` |
| Git 锚点 | 插件 bundle `nativeSourceRevision=e0bf468d826105022d8a37d729597c1765af42b3`（插件仓库 commit "fix: refresh the shortcut scan summary after individual rechecks"） | `master=baeb3e4`，工作树干净（仅未跟踪 `skills/`）；annotated tag `v0.1.4-beta`  peel 到 `baeb3e423d222426ae9a7824b81cfb3b157bf8a6` |
| 发行资产 | `dsh-toolbox-bundle 0.1.0-beta.6`，仅 `win32-x64` 原生资源 | GitHub Release `v0.1.4-beta`：darwin-aarch64 DMG、updater tar.gz、.sig、SHA256SUMS、feed、公钥、构建记录 |

远端实测（curl HEAD，本轮执行）：raw feed `updates/macos-beta.json` → HTTP 200；Release 的 tar.gz 与 dmg → 302 跳转后 200。本地 `dist/v0.1.4-beta/` 资产 SHA256 与 `SHA256SUMS.txt` 完全一致：

- tar.gz：`723b56736e0a39e60568fec90f1d217ec75bd7bb6dd3336216e8e589bed2763c`
- dmg：`4adb6d3cbd89bc3a15e3f06d4d7024fb372af779492e670fb7b5fc52ba826bd7`

构建溯源注意：`macos-build.json` 记录 `source_head=e511e38`、`source_dirty=true`；发布 tag 指向其后的 `baeb3e4`（QA/feed 提交，独立仓库文档已说明该流程）。**固定 revision 应以 Release 资产 + SHA256 为锚，不能只看 tag 或构建时 HEAD。**

## 2. 独立程序是否已有 plugin/IPC/grants：没有

- crates 无 `dsh-bridge`；src-tauri 无 `plugin_host.rs`/`plugin_launch.rs`/`agent_api.rs` 等插件文件。
- 对独立仓库 crates + src-tauri 全部 `.rs` grep `plugin_host`/`agent_access`/`AgentAccess`/`grants`：零命中。
- `src-tauri/src/ipc/` 是 Tauri UI 命令路由（`dispatch_inner` 按命令前缀分发并检查模块开关），进程内调用，不是外部协议。
- `legacy_http.rs` 自述"保留旧版开发 HTTP 通道；原生主程序不启动此服务"。
- `updates.rs` 是 Tauri 自更新，与插件协议无关。

结论：独立版是纯人用程序。companion 解耦必须新增协议端点；不能把现有 `ipc/` 当作插件接口，也不能把 updater feed 当作能力发现。

## 3. 逐项差异（0.1.3 基线双向 diff）

方法：`git archive 5750751`（独立 0.1.3-beta 发布 commit）解到本工作树 `.tmp/base013`，分别与插件 native、独立 0.1.4 做 `diff -rq`（排除 target/dist/node_modules/.git/gen/skills 等）。树级差异共 91 行。插件 native 与 0.1.3 基线的差异全部是插件侧新增/修改，证明插件 native 源自 `5750751`；独立 0.1.4 相对基线为 6 commits、25 文件、+591/-73。

### 3.1 插件侧独有（0.1.3 基线之上）

- `crates/dsh-bridge`：headless named-pipe bridge，bin `dsh-toolbox-native`。
- app-core：`agent_access.rs`（screenshot/clipboard/screen_ink/app_usage/sticky_note 五模块静态允许列表，grants 独立持久开关默认 OFF，`AGENT_ACCESS_DENIED` 等稳定错误码）；config schema v4→v6（`agent_access` map、`agent_support_generation`、4→5→6 迁移）；error.rs/lib.rs 配套。
- 模块 headless API：clipboard `record_explicit_text`（source="agent" 入历史）；sticky-note `StickyNoteSummary`/`ClosedNoteSave`（带版本检查的保存）；app-usage `ensure_bounded_range`；media-proc `exact.rs`（`convert_image_exact`，无覆盖发布）。
- os-hal：`clipboard_source.rs`（剪贴板所有者，仅 Windows；非 Windows 留空）。
- src-tauri：`plugin_host`/`plugin_launch`（`--toolbox-plugin --pipe-name --instance-id --data-dir --parent-pid`，pipe 名强制 `\\.\pipe\dsh-toolbox-<id>`）、`agent_api`/`agent_artifacts`/`agent_ui`、`desktop_control`、`human_console`、`shortcut_diagnostics`、`capabilities/feature-panel-events.json`。
- src-ui：`embedded.ts`/`embedded-theme.ts`、`safeHtml.ts`、`shortcutDiagnostics.ts`、`panel-cards.css`、ModuleManager/PreferencesPanel 等组件改造、三语言文案、3 个新测试。

### 3.2 独立 0.1.4 独有（`5750751..baeb3e4`）

- GIF 排除窗口失效 fail-closed：`recorder.rs` +9（句柄失效即停录）、os-hal `traits.rs` 新增 `capture_exclusion_alive`、`screen.rs` +66（macOS 用 CGWindowList 复核 CGWindowID 存活）、测试 +61。
- 翻译浮窗 macOS 工作区夹取：`translator_mouse.rs` 把 `constrain_native_popover` 的 cfg 从 Windows 扩到 macOS（物理像素二次夹取）。
- macOS 签名 updater：`updates.rs` 重做（仅 `/Applications` 或当前用户 `~/Applications` 内同名正式安装参与；验签后暂存、正常退出并完成模块收尾后安装；红按钮后台运行不触发）；`lib.rs`/`tauri_app.rs` 三处 cfg 扩展；新增 `tauri.macos.conf.json`（独立公钥 + feed，与 Windows 密钥隔离）；`tests/unit/updates.rs` +48、`updater_artifact.rs` 扩展。
- 发布管线：`scripts/build_macos_release.sh`（148 行：前端严格检查→构建→固定钥匙串身份签名→DMG+updater tar.gz+sig+SHA256SUMS，按宿主架构出真实平台条目）；`updates/macos-beta.json`；`docs/MACOS_RELEASE.md`、`docs/releases/0.1.4-beta.md`、`docs/testing/MACOS_BETA_2026-11-14.md`。
- 版本号：Cargo.toml、package.json、src-ui/package.json、tauri.conf.json、tauri.windows.conf.json（wix 0.1.4）。

### 3.3 双侧同改文件（仅 6 个，hunk 均不重叠）

| 文件 | 插件侧 | 独立 0.1.4 侧 |
| --- | --- | --- |
| `Cargo.toml` / `Cargo.lock` | dsh-bridge member + 版本 | 版本 + updater 依赖 |
| `src-tauri/Cargo.toml` | tokio features + dsh-bridge + uuid | macOS 段 +`tauri-plugin-updater = "2"` |
| `src-tauri/src/lib.rs` | agent/plugin mod 声明 + DesktopHost 字段 | `mod updates` cfg 扩 macOS |
| `src-tauri/src/tauri_app.rs` | webview data dir、agent_ui 路由、模块开关回滚重构 | 3 处 updater cfg 扩 macOS |
| `src-ui/package.json` | test 脚本加 3 个测试 | 版本号 |

另有 3 个文件仅版本号差异（根 `package.json`、`tauri.conf.json`、`tauri.windows.conf.json`）。**结论：0.1.4 修复可低冲突并入插件 native；其余差异全部单侧。**

## 4. 重要 macOS 功能差异

插件 native 缺、0.1.4 已修：GIF 排除失效保护、翻译浮窗边界、macOS updater 全链路。

共享基线（两侧一致）的 macOS 状态：app-usage 有 `macos.rs`/`macos_events.rs` 实现；剪贴板所有者仅 Windows 记录；window_pin macOS 不可用（独立版 GUI 验收明确标记禁用）；password_vault 代码两侧完全一致，macOS GUI 本轮未重跑；录屏 TCC 授权已在独立版 GUI 验证。

插件 bridge 当前 Windows-only：`dsh-bridge` 无条件依赖 `windows-sys 0.52`，`winutil.rs` 用 `std::os::windows` + tokio named pipe；`plugin_launch` 强制 pipe 名前缀。macOS 编译与运行均阻塞（本轮 Zed/Cursor 范围）。Host 侧 `native-owner.js` 硬编码 `resources/win32-x64/dsh-toolbox-native.exe`，无外部程序发现逻辑。

## 5. 复制升级风险

1. **双向漂移**：两树已各自演化（插件 +Agent/bridge，独立 +macOS/updater）。建议插件仓库显式记录 upstream base revision（当前 `5750751`，合并 0.1.4 后推进到 `baeb3e4`），否则下次合并无法区分单侧/双侧改动。
2. **配置 v6↔v4（代码路径推断，未实测）**：迁移循环为 `while current_version < CURRENT_CONFIG_VERSION`，0.1.4（CURRENT=4）读 v6 不执行迁移；`agent_access`/`agent_support_generation` 经 `unknown_fields` flatten 保留；`save_atomic` 序列化 struct 的 `config_version`，写回仍为 v6，不降级。反向插件 4→5→6 迁移会清除 sticky_note 旧 true 并重置 generation。两程序无共享实例锁：**禁止同一数据目录并发运行或互相指向**。
3. **macOS 身份冲突**：同 bundle id `com.allinone.desktop`、同 productName、同 bin 名 `all-in-one-desktop`。插件未来 macOS 桌面包若进 `/Applications` 会与独立版互相覆盖，TCC 按 bundle id + 签名身份继承会混乱；自签名 designated requirement 绑定证书 leaf hash（见 macos-build.json）。插件 macOS 包必须用独立 identifier 或显式共享签名策略（Codex 决策）。
4. **updater 串扰**：插件 macOS 包不得消费独立 `macos-beta.json` feed，否则人用独立版会覆盖插件版、丢失 Agent 能力；独立版白名单已排除 dist/调试/DMG 内运行。Copilot 的 macOS 打包应禁用或重定向 updater。
5. **编译阻塞**：dsh-bridge 的 windows-sys 无条件依赖使插件 native 无法直接在 macOS 编译（Cursor 的 UDS 改造 + Zed 的编译修复覆盖）。
6. **数据安全**：独立版无 grants 强制面，Agent 永远不得直连独立版数据目录；插件 `--data-dir` 保持隔离，不指向个人数据。
7. **发布溯源**：`source_dirty=true` 且 tag 晚于构建源 commit，固定版本以 Release 资产 SHA256 为准。
8. **分发限制**：本机固定自签名证书，无 Apple Developer ID/公证；Intel 未构建未验证；跨版本 TCC 继承未实测（独立测试文档自述）。

## 6. 解耦路径（固定 revision / 发行资产 / 协议 / capabilities）

**阶段 0（本轮，内置模式不变）**：把 0.1.4 单侧修复（3.2 清单）并入插件 native，基线推进到 `baeb3e4`；6 个双改文件按 3.3 机械合并。分工不变：Zed 编译修复、Cursor UDS、Antigravity UI 对等、Copilot macOS 打包。

**阶段 1（协议外置）**：以 dsh-bridge v1 为既有契约（4 字节 LE 长度帧、4MiB 上限、hello/ready 携带 instanceId+capabilities、request/response/cancel/event、稳定错误码，见 `docs/BRIDGE_PROTOCOL.md`）。独立版新增 companion 端点：macOS Unix domain socket（同用户 0700 目录/0600 socket、peer pid/uid 校验）、Windows 复用 named pipe；ready 显式携带 `protocolVersion`、`appVersion`、`capabilities` 闭集。插件 Host 增加外部 companion 模式：仅固定安装路径（`/Applications/All-in-One Toolbox.app`、当前用户 `~/Applications`）加用户显式配置；不做源码路径自动发现、不猜全局 PATH、不接管正在运行的个人实例；独立版缺协议时明确报 INCOMPATIBLE；**appVersion 更高不等于协议兼容**。

**阶段 2（数据与授权单写者）**：companion 拥有数据目录与内核，grants 强制必须落在数据所在侧。选项 A：协议区分 human/agent 连接身份，独立版上游化 `agent_access` 强制（改动大，需保持独立版人用优先）；选项 B：插件保留自有内核供 Agent 路径、companion 仅供人用 UI（双数据 store 分裂，不推荐）。建议 A 的协议层变体：Agent 闭集方法在 companion 侧前置 grant 校验，具体契约由 Codex 决定。短期保留内置模式兼容，不强制迁移。

**固定点**：插件 manifest 增加 companion 兼容区间（`protocolVersion==1` + capabilities 子集 + appVersion min/max）；companion 资产锚定 GitHub Release + SHA256SUMS + 签名 feed；两侧升级互不覆盖，历史 tag/资产冻结。

## 7. 更新与兼容性矩阵

| 组合 | 平台 | 协议 | grants | config | 更新通道 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 插件 beta.6 内置 native | win32-x64 | v1 named pipe | 插件强制，默认 OFF | v6 | bundle 冻结；native 走 windows-beta.json | 已验收（beta.6） |
| 插件 beta.6 × 独立 0.1.3/0.1.4 | 任意 | 独立无协议 | — | v6 vs v4 | 各自独立 | 不可 companion；仅可并存，数据目录必须隔离 |
| 独立 0.1.4 | darwin-aarch64 | 无 | 无 Agent 面 | v4 | macos-beta.json 签名 feed，白名单安装 | 已发布；自签名限制 |
| 未来插件 macOS 内置 | darwin-arm64/x64 | v1 UDS（Cursor 开发中） | 插件强制 | v6 | 不得消费独立 feed | 本轮开发中 |
| 未来 companion | 双平台 | v1 + appVersion 握手 | 契约待定（Codex） | 单写者 | 独立 feed 升级 companion；插件 manifest 钉兼容区间 | 阶段 1/2 |

版本偏斜规则：只按 `protocolVersion` + capabilities 判定兼容；appVersion 仅作信息与区间约束；缺协议或缺 capability 一律 fail-closed。

## 8. 已执行命令与真实结果

均先 `source scripts/use-project-environment.sh`；cwd 为本工作树；全部只读（除 `.tmp/base013` 解包）：

- `git -C <独立仓库> archive 5750751 | tar -x -C .tmp/base013`：成功。
- `diff -rq` 插件 native vs 独立 0.1.4：91 行差异；vs 0.1.3 基线：差异全部为插件侧。
- `git log/diff 5750751..baeb3e4`：6 commits、25 文件、+591/-73。
- 独立仓库 grep `plugin_host|agent_access|AgentAccess|grants`（*.rs）：0 命中。
- `curl -sI` feed / tar.gz / dmg：200 / 302→200 / 302→200。
- `shasum -a 256` 本地 tar.gz、dmg：与 SHA256SUMS.txt 逐字一致（哈希见 §1）。
- `git rev-parse 'v0.1.4-beta^{commit}'`：`baeb3e423d222426ae9a7824b81cfb3b157bf8a6`；`git config user.email`：`2914566893@qq.com`。

## 9. 未验证项

- 未运行 cargo 编译/测试（Zed 范围），未启动任何 GUI，未做 Windows 实测；Intel 未构建。
- 配置跨版本读写行为（§5.2）为代码路径推断，未做运行时实验。
- 独立版 GUI/测试证据引自其 `docs/testing/MACOS_BETA_2026-11-14.md`（352 Rust 通过、103 UI 通过、更新包验签门禁、GUI 回归），非本轮重跑；该文档自述未覆盖项（vault 完整 GUI、锁屏/睡眠、长截图、多屏边界、跨版本 TCC 继承等）本轮同样未覆盖。

## 10. 跨边界请求

- **Codex**：companion 握手契约（appVersion/capabilities/grant 身份）、插件 macOS bundle identifier 与 updater 策略、upstream base revision 的记录位置。
- **Zed**：合并 0.1.4 修复时注意 §3.3 的 6 个双改文件；dsh-bridge 编译阻塞归 Cursor。
- **Cursor**：UDS ready 建议显式携带 appVersion/protocolVersion（契约归 Codex）。
- **Copilot**：macOS 桌面包禁用/重定向独立 updater feed；identifier 决策前不要产 `/Applications` 安装布局。
- 无根 manifest/锁文件改动请求。

Agent: Qoder（Zed ACP thread）。未使用 co-author trailer（无已核实官方邮箱）；提交保持仓库本地用户邮箱。