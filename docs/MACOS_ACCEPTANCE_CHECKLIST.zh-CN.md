# macOS 移植与验收清单

日期：2026-11-14。基线：`v0.1.0-beta.6`，后续 Windows 发布后验收记录在 main。**本文件是待执行清单，尚未在 macOS 上运行任何测试。**

目标顺序：先使真实 Harness 插件在 Mac 上启动，再验收人的主控台、原生窗口、菜单栏和快捷键，最后验收五项可选 Agent 能力。原工具箱独立 `.app` 能运行，不代表 Harness 插件安装、IPC、退出和授权已经通过。

每项记录 `PASS / FAIL / BLOCKED / NOT RUN / NOT SUPPORTED`，附环境、步骤、预期、实际结果和证据路径。没有设备或没有权限记为未测/阻塞；明确不支持的能力通过“如实提示且无副作用”测试，不记为功能已实现。

## 1. 出发前与 Mac 首次接手

- [ ] 拉取最新 main，记录 `git rev-parse HEAD` 与 `git status --short`；不携带 Windows 的 `node_modules` junction、target、缓存或个人数据。
- [ ] 保留 beta.6 及更早 tag / 安装包；Mac 版本使用新版本号，不能用修改旧包的方式添加 darwin 支持。
- [ ] 记录 Mac 型号、`sw_vers`、`uname -m`、实际 Harness 版本/安装路径、其 Node/pnpm 版本，以及 Xcode/SDK、Rust、前端工具版本。
- [ ] Apple Silicon 原生作为首个目标；若声明 Intel 或 Universal 支持，分别检查二进制架构并在相应环境实测。交叉编译成功或 Rosetta 运行不代替全部原生架构验收。
- [ ] 最低 macOS 版本根据目标 SDK、依赖和实际使用的 API 确认，不先猜一个版本写入兼容声明。无法测试的 OS/架构明确列为未测。
- [ ] 获取 Mac 安装的 Harness 包/README/实际导出，重新核对 SDK；不直接复用 Windows 的 rc.1 快照来证明目标客户端兼容。
- [ ] 所有构建、缓存、Profile、日志、临时文件和合成数据位于 Mac 工作区。正常 Harness 用户数据、个人便笺、剪贴板历史和凭据不作为测试输入。
- [ ] 保留仓库本地提交邮箱 `2914566893@qq.com`；Codex 提交附 `Co-authored-by: Codex <codex@openai.com>`，其他 agent 只用已核实的官方邮箱。

Mac 环境脚本尚需编写，不能照搬 D 盘路径或直接执行 PowerShell 构建脚本。已有工具到位后，可先在**仓库根目录**准备以下隔离目录；这不是完整构建命令：

```sh
mkdir -p .tmp/cache .tmp/npm-cache .tmp/pnpm-store build/rust runtime/macos-acceptance artifacts/macos
export TMPDIR="$PWD/.tmp"
export XDG_CACHE_HOME="$PWD/.tmp/cache"
export npm_config_cache="$PWD/.tmp/npm-cache"
export npm_config_store_dir="$PWD/.tmp/pnpm-store"
export CARGO_TARGET_DIR="$PWD/build/rust/target"
export CARGO_BUILD_BUILD_DIR="$PWD/build/rust/intermediates"
export DSH_HOME="$PWD/runtime/macos-acceptance/harness-home"
export DSH_TOOLBOX_DATA_DIR="$PWD/runtime/macos-acceptance/toolbox-data"
```

工具缺失和依赖准备另行记录，不在此清单中隐含升级全局工具或改系统设置。

## 2. P0：必须先完成的移植工作

以下是代码审阅已确认的阻塞，不是 macOS 实测失败：

| 编号 | 当前证据 | 开发/验收要求 |
| --- | --- | --- |
| PORT-01 | 根包和 Host 的 `os/cpu` 只声明 win32/x64 | 确定 Mac 分发结构和架构选择；只增加 `darwin` 声明不算完成，必须装入匹配的 Mac 产物 |
| PORT-02 | `src/host/native-owner.js` 拒绝非 win32，生成 Windows Named Pipe 路径 | 实现 Mac 启动/连接策略，保留握手、超时、取消、唯一实例和所有权约束 |
| PORT-03 | `dsh-bridge/src/winutil.rs` 直接依赖 Windows API 与 Tokio Windows pipe，GUI 复用此 transport | 拆出平台实现；Mac IPC、父进程监视、数据锁均须有真实实现，不能启动第二套 headless 内核凑接口 |
| PORT-04 | `DESKTOP_RUNTIME` 与打包脚本固定 `.exe` / `win32-x64` | 确认签名 `.app`、实际可执行文件、资源、manifest、架构和工作目录；原生进程仍受 Harness 子进程服务管理 |
| PORT-05 | `bundle-github.mjs` 的校验固定 Windows 两个 exe | 增加平台清单/校验与发布测试，保留 `.app` 必要资源、可执行位及合法 bundle 内部链接 |
| PORT-06 | 现有 `package_macos_app.sh` 属于独立应用，固定原生项目 `target` 路径并注册 LaunchServices | 先审阅再适配；不能直接当作插件构建脚本。隔离 Cargo target 后产物路径须同步，不能误取旧 `.app` |
| PORT-07 | 已有 `macos_signing.py` 的 `setup-local` 会创建/导入签名身份并改变用户钥匙串信任 | 不作为自动准备步骤运行。使用用户确定的签名方案，区分本机开发与公开分发；不读取/导出私钥或凭据 |

通过门槛：从真正的 Mac 插件安装包启动一个受 Harness 管理的原生内核，完成握手和正常卸载。当前 beta.6 Windows 包在 Mac 上应明确拒绝/显示不支持，不应靠 `--force` 安装通过。

## 3. P0：构建、安装与运行边界

- [ ] **BUILD-01**：从源码干净构建 Host、原 Vue 内嵌 Client、原生 GUI；没有 Windows API 未隔离、错误链接架构、缺少 framework 或资源路径错误。
- [ ] **BUILD-02**：Mac 依赖重建到本工作区；从实际依赖恢复，不复制 Windows 的二进制依赖。首次准备缺少缓存时不机械使用 `--offline`，但保持已有锁文件。
- [ ] **BUILD-03**：Node、Vue、相关 Rust 的非交互回归在 Mac 执行；Windows 专用测试按平台显式隔离。记录跳过项，不把 Windows 的 190/519 通过数写成 Mac 成绩。
- [ ] **BUILD-04**：先适配 `github-bundle.test.mjs` / `beta6-install-acceptance.mjs` 等 Windows 假设；新增 Mac 路径、架构、资源布局、权限/可执行位和损坏产物测试。
- [ ] **PKG-01**：本地完整包安装，无 Rust 编译、临时下载原生程序或放宽 pnpm 策略；全部 exports、Patch、Client 与原生资源可解析。
- [ ] **PKG-02**：空白 Profile/缓存从固定 GitHub commit URL、正式 tag URL、公开 `.tgz` URL 分别安装并运行；锁文件对应正确来源/commit。
- [ ] **PKG-03**：Mac/Windows、arm64/x64 的错误组合能明确拒绝，不启动错误二进制，不退回未声明架构。
- [ ] **PKG-04**：解包前后 SHA256、可执行位、`.app` 完整性和签名均正确；签名完成后再生成哈希，不随后修改 bundle 内文件。
- [ ] **PKG-05**：含空格、中文和较长工作区/安装路径可用；对区分大小写的文件系统做补充检查，避免目录大小写和资源名依赖。
- [ ] **PKG-06**：在普通 Finder/桌面启动的 Harness 中运行，验证不依赖终端 PATH、shell 初始化或开发机专用环境变量。
- [ ] **PKG-07**：离线重新启动已安装包不要求在线构建；网络安装失败/取消、损坏包或哈希错误有真实错误，保留旧包和数据。

## 4. P0：IPC、实例与生命周期

- [ ] **IPC-01**：若采用 Unix socket，核对路径长度上限、短路径策略、父目录/端点权限、端点归属和对端身份校验；不退化为任意本机进程可写的公共控制通道。
- [ ] **IPC-02**：错误 instance ID、错误对端、超大帧、截断/分包帧、断连、取消和超时均按契约处理；人用控制通道不能由 Agent 参数伪造身份访问。
- [ ] **IPC-03**：同一数据目录第二次启动被拒绝；失败启动不先重写配置。不同隔离 Profile 不串库、不共用授权。
- [ ] **LIFE-01**：Harness 插件开启只启动一个 GUI 内核；不开第二个 headless 进程或第二个数据库写者。
- [ ] **LIFE-02**：关闭聊天、切工作区、收起工具箱和关闭主窗口，不意外撤销原本应常驻的快捷键/菜单栏功能。
- [ ] **LIFE-03**：关闭普通原生面板仅销毁该面板；便笺关闭保存状态并释放窗口。
- [ ] **LIFE-04**：插件关闭/移除、Harness 正常退出时，便笺保存、密码本锁定、窗口状态恢复，快捷键/监听器/菜单栏项/子进程和 IPC 端点释放。
- [ ] **LIFE-05**：受控终止测试 Harness/异常断连后原生程序不成为孤儿；重启可回收自己遗留的端点/锁。不得删除其他实例仍在使用的端点。
- [ ] **LIFE-06**：原生程序自行退出后，主控台后台轮询不自动拉起它；显式重连才恢复服务，不自动重放不确定是否提交的写操作。
- [ ] **LIFE-07**：卸载→重装、同布局升级、旧双包→完整包，三行各一份、一个内核，合成数据及授权保留；未声明支持的数据库降级明确拒绝。

## 5. P0/P1：系统权限和签名身份

每项能力按“未授权 → 首次请求 → 用户拒绝 → 用户允许 → 重启 → 撤回”分别记录，权限由人操作。只有相关功能实际需要时才请求，不要求一开始授予所有权限。macOS 的辅助功能、输入监控、屏幕录制是不同权限类别，应按实际后端确认依赖。[Apple 权限说明](https://support.apple.com/en-au/guide/mac-help/mchl211c911f/mac)

- [ ] **PERM-01**：屏幕录制未授权时，截图/录制准确返回权限错误及指引；不是黑图、空列表或成功提示。便笺等不相关功能仍可使用。
- [ ] **PERM-02**：AX 选区读取/外部窗口操作在辅助功能未授权时准确拒绝；不偷偷改走模拟复制，或读取无关前台内容。
- [ ] **PERM-03**：仅当事件监听/输入模拟确实需要输入监控等权限时测试该项；不是所有快捷键、截图或使用时长查询都一律需要它。
- [ ] **PERM-04**：记录权限面板中真正出现的进程名称/Bundle ID；分别检查终端开发启动、独立 `.app` 和 Harness 拉起的插件，不能假设三者共享权限。
- [ ] **PERM-05**：相同 Bundle ID、确定的签名身份、原位升级后权限表现可解释；移动路径或改变签名身份的变化单独记录，不修改 TCC 数据库来“修好”测试。
- [ ] **PERM-06**：无麦克风/系统音频采集需求时不请求相关录制权限；“检测默认输出设备是否活跃”不能当作采集音频验收。
- [ ] **PERM-07**：目标系统若出现剪贴板或文件访问提示，分别记录允许、拒绝与取消；不得把访问被拒绝显示成“历史为空/保存成功”，也不把完全磁盘访问作为默认前置条件。
- [ ] **SIGN-01**：区分本机开发签名通过与公网分发验收通过。对公开下载的最终产物检查 Gatekeeper、签名、公证与离线启动；不把本机编译能启动视为公开下载也能启动。[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、[Tauri macOS 签名](https://tauri.app/distribute/sign/macos/)

## 6. P1：人的主控台、窗口和快捷键

- [ ] **UI-01**：真实 Electron Harness 侧栏点击直接打开完整原主控台，不意外弹独立主窗；单独记录浏览器 Web 运行结果，不能替代 Electron 结果。
- [ ] **UI-02**：十模块可见；功能开关和 Agent 授权分别持久化。五个支持授权，五个明确不支持；初始授权全 OFF。
- [ ] **UI-03**：内嵌与独立主窗共用模块状态、配置和数据；功能面板不是截图或假页面，操作失败不显示成功。
- [ ] **UI-04**：浅/深主题、强调色、语言、中文输入法、窄侧栏、Retina 缩放和屏幕边缘布局；工具箱样式不污染 Harness。Enter 选择输入法候选词时不误提交。
- [ ] **UI-05**：菜单栏图标、菜单项、Dock、应用菜单、窗口关闭与 Cmd+Q 的语义一致；工具箱普通关闭不误退出 Harness。
- [ ] **UI-06**：独立主窗、便笺、截图遮罩、贴图、屏幕注释和翻译气泡在多显示器、负坐标、不同缩放、全屏及多个 Spaces 中位置/层级/焦点正确。
- [ ] **KEY-01**：先列出旧 Mac 应用实际默认组合键与自定义覆盖，逐项对照当前逻辑值、显示值和系统注册值；未经明确决策不批量把 Ctrl 改成 Cmd。
- [ ] **KEY-02**：测试 Control/Option/Command/Shift、Fn/功能键、录入、取消、清空、重启恢复；输入法和 Option 字符不污染录入值。
- [ ] **KEY-03**：外部测试程序占用/释放热键，内部重复、系统保留、非法输入、权限拒绝和检查失败分别展示；单项重检后汇总立即更新。
- [ ] **KEY-04**：Mac 错误展示使用实际后端信息，不照搬 Windows 1409。没有可靠占用者证据时明确未知，不猜 PID，不自动改键或关闭别的应用。
- [ ] **KEY-05**：功能关闭/卸载后释放注册；失败修改能回滚旧键。长按、多次按、睡眠唤醒后不重复触发或丢注册。

## 7. P1：十模块逐项验收

| 模块 | Mac 人用测试 | 当前基线/重点 |
| --- | --- | --- |
| 截图与贴图 `screenshot` | 权限、显示器/区域坐标、Retina、框选取消、编辑保存/复制、贴图移动/缩放/关闭；若宣称支持，另验 OCR、长截图、GIF/录制 | 已有 Mac 捕获/OCR 代码，全部待实测；先进模式逐项记结果，不以普通截图通过代替 |
| 剪贴板 `clipboard` | 合成文本/图片、中文/Emoji、去重、同内容重复复制、容量/搜索、历史选择与粘贴、关闭停止采集、敏感标记排除、重启保留 | 来源查询当前只实现 Windows，Mac 返回未知/空值是已知边界；不能用前台 App 冒充复制来源 |
| 屏幕注释 `screen_ink` | 原画布绘制/清空/撤销、颜色宽度、鼠标穿透、快照、显示器切换和退出 | 着重检查透明窗、全屏/Spaces 层级、穿透后仍能退出、关闭后不截获输入 |
| 便笺 `sticky_note` | 创建、编辑、Markdown/公式、配色/透明度、拖动/置顶、关闭重开、重启、导出、退出前写入 | 独立窗口和库共用一份数据；打开/关闭不破坏持久化状态 |
| 使用时长 `app_usage` | 两个指定测试 App 定时切换、最小化/退出、锁屏、息屏、空闲、睡眠唤醒、跨日/时区、查询与保留策略 | 已有 NSWorkspace/空闲/锁屏/事件监听实现，待 Mac 受控实测；避免睡眠/锁屏重复计时，窗口标题仅按配置保存 |
| 多媒体 `media_proc` | 合成图片格式转换、音视频处理、文件选择/保存、取消、损坏文件、中文/空格路径 | FFmpeg 等外部依赖与架构需核对；缺少时如实提示，不能因开发终端 PATH 恰好可用而误判 |
| 窗口置顶 `window_pin` | 外部窗口操作能力检测、界面提示、关闭恢复 | 当前 Mac HAL 明确不支持任意外部窗口置顶；不能假报成功。自己的便笺/贴图置顶是另一项能力 |
| 脚本 `script_runner` | 指定 shell 的合成脚本、参数/路径转义、输出、非零退出、取消、进程回收、快捷键触发 | 不照搬 PowerShell/.exe；只跑无副作用样本，不给 Agent 开放 |
| 翻译 `translator` | 指定测试文本的 AX 选区、无选区/不支持控件/无权限、气泡位置和焦点、服务未配置/断网/失败 | 原焦点和剪贴板不被破坏；不读取密码输入框或任意个人选区，外部服务使用明确的测试文字 |
| 密码本 `password_vault` | 合成密码库、真实 Keychain/Touch ID 可用/不可用/取消/失败/重启、锁定、复制超时清除 | 模拟认证不算 Touch ID 通过；硬件不具备时写未测/不支持。Windows 受保护密钥不能默认为可在 Mac 解密，迁移另行设计 |

上述后五项始终不支持 Agent；便笺和剪贴板中合成 Markdown/HTML 样本还要检查不可信内容的渲染边界。

## 8. P1：五项 Agent 授权与数据一致性

对 `screenshot / clipboard / screen_ink / app_usage / sticky_note` **逐项**执行，而不是抽测一个后给另外四个打勾：

- [ ] **AGENT-01**：新配置、旧配置缺授权字段、升级后未知字段，授权默认拒绝；功能开启不隐式授予 Agent。
- [ ] **AGENT-02**：人的界面明确授权后工具才出现/可调用，实际内容来自同一 GUI 内核与合成数据，没有另一份 headless 数据库。
- [ ] **AGENT-03**：Agent 修改便笺/剪贴板/画布能从 GUI 看见；人的修改能从获授权工具读到。截图产物由真实 SDK 附件传递，受授权 App 使用时长查询与 GUI 一致。
- [ ] **AGENT-04**：撤权、关闭模块、原生退出、断线和卸载时，缓存工具/旧调用无法继续读写；在途读取/图片发布也重新检查授权，不泄露撤权后的结果。
- [ ] **AGENT-05**：系统权限缺失和 Agent 未授权分别返回正确原因；Agent 不能替人授予 TCC 或模块权限，也不能借人用 console 入口扩大授权。
- [ ] **AGENT-06**：无效参数、额外身份/路径字段、超量请求、取消、超时和重复写风险受限；历史便笺/图片导出不绕过新授权。
- [ ] **AGENT-07**：另外五模块在 GUI、状态与工具清单中一致“不支持 Agent”，没有遗留注册入口。
- [ ] **AGENT-08**：目标 Harness 模型可用时做一轮合成数据模型烟测；模型不可用时分别报告服务层已测和模型层未测。不要为追求工具数而授权个人数据。

## 9. P2：稳定性、升级和数据交付

- [ ] 主控台开关/原生面板反复开关 20 次，内存、监听器、菜单栏项和热键数量不持续增长。
- [ ] 受控运行至少 2 小时，另行选择过夜观察；包含睡眠/唤醒、外接屏接拔、锁屏/解锁和全屏切换，不对个人全天桌面隐式采集。
- [ ] 大量合成便笺/剪贴板记录下搜索、分页、清理、导出和取消仍响应；备份/恢复不把缓存、日志或授权意外混入数据。
- [ ] 在明确的测试库上模拟磁盘不可写/空间不足、数据锁被占用、原生启动失败，错误可恢复，旧数据保持完整。
- [ ] 若支持跨平台数据导入，逐项核对文本、图片、路径、快捷键、时间/时区和密码库的可迁移范围；不直接把整个 Windows 数据目录当作 Mac 的默认初始数据。
- [ ] 从公开发布物在另一空白环境完成安装与重装；开发机现成权限、钥匙串或第三方依赖不是隐含前提。

## 10. Mac 首轮建议执行次序与放行条件

1. **第一轮：环境与启动**——确认硬件/SDK，修复 PORT-01～07；拿到真实插件 GUI 内核、IPC 和退出证据。
2. **第二轮：人用纵向流程**——内嵌主控台 → 便笺保存/重启 → 全局快捷键 → 菜单栏退出；再做 TCC 拒绝/允许/撤回和截图/剪贴板。
3. **第三轮：模块对等**——完成十模块表，清楚区分已支持、错误和不支持；保留原 Mac 操作习惯。
4. **第四轮：Agent 与分发**——五模块独立授权、模型烟测、GitHub URL/升级卸载、签名/公证与干净环境复验。

首个 Mac beta 放行至少要求：全部 P0 通过；主控台/便笺/快捷键/菜单栏与生命周期通过；对外声明支持的功能有真机证据；五模块授权边界通过；三种安装来源通过；平台/架构与未测范围写清。缺少 Intel 设备时不声明 Intel 已验收；窗口置顶和剪贴板来源等已知缺口必须在 UI 与发布说明如实呈现。

每个问题的最小记录模板：

```text
ID / 状态：
macOS / 芯片 / Harness / 插件版本 / commit：
启动方式 / 签名类型 / 测试 Profile / 系统权限状态：
合成输入 / 操作步骤：
预期 / 实际：
复现次数 / 原始错误码 / 相关日志和截图路径：
是否阻塞发布 / 修复 commit / 复测结果：
```

## 代码与历史参考

- `package.json`、`packages/dsh-toolbox/package.json`：当前平台声明。
- `packages/dsh-toolbox/src/host/native-owner.js`、`src/desktop/index.js`、`src/bridge/client.js`：启动器、资源与 IPC。
- `native/YourAllIn1Helper/crates/dsh-bridge/src/lib.rs`、`src/winutil.rs`、`src-tauri/src/plugin_host.rs`、`src/plugin_launch.rs`：共享 transport、父进程与隔离。
- `native/YourAllIn1Helper/crates/os-hal/tests/capabilities.rs`：平台能力边界；其中 `#[ignore]` 的桌面/AX 测试逐条审阅、仅在指定测试 App 上显式运行，不批量执行所有 ignored 测试。
- `native/YourAllIn1Helper/crates/os-hal/src/platform/clipboard_source.rs`：来源元数据的 Windows 实现和非 Windows 空值边界。
- `native/YourAllIn1Helper/scripts/package_macos_app.sh`、`scripts/macos_signing.py`、`src-tauri/Info.plist`、`tauri.conf.json`：独立应用的 Mac 构建/签名基线，尚非插件验收结果。
- [人用优先计划](HUMAN_FIRST_PLAN.zh-CN.md)、[授权契约](A2_CONTRACT.md)、[桥协议](BRIDGE_PROTOCOL.md)、[beta.6 安装验收](BETA6_URL_INSTALL_ACCEPTANCE.zh-CN.md)：产品边界及 Windows 历史证据。
