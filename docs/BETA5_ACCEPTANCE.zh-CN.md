# beta.5 集成与验收记录

日期：2026-11-14。本轮范围为 beta.4 实测反馈的四项修正，执行依据见 [开发计划](BETA5_FEEDBACK_PLAN.zh-CN.md)。历史 beta.4 及更早归档/tag 保留。

## 实现与集成

- Copilot `723b05e`：复用原 Vue Dashboard/ModuleManager/PreferencesPanel，挂入 Harness main slot 的 Shadow DOM，点击侧栏不再自动 showMain。
- Grok 工作树改动由 Codex 收录为 `8a386f1`：错误分类、可展开详情、内部动作/脚本信息、排查建议及三语言文案。外部占用者没有可靠证据时显示“系统未提供占用程序信息”。
- Claude `6a00941` / `14c13dd`：旧便笺工厂迁到 test-only fixture；真实文本/图片采集接通 Windows clipboard owner→PID→应用名，不根据前台应用猜测。
- Codex：补 Host Connection 闭集 console RPC 与同一原生内核接线，复用模块启停后的快捷键/托盘/窗口清理及回滚，保留便笺停用前冲刷。snapshot 只返回目录和显示偏好；非 owner carrier 拒绝请求；Agent gateway 不接受 desktop.console。后台读取不重启停止的进程，明确 reconnect 才启动。
- 集成修正：再次复制相同内容时按系统序列刷新来源；构建清理旧 lib 残留；语言写入失败不先显示成功；内嵌语言/主题不修改 Harness 根节点；卸载后不遗留延迟创建的刷新计时器。
- GUI 发现并修正：原 macos-window 的 100vw/100vh 导致横向溢出，改按嵌入面板尺寸和容器宽度布局。真实热键释放后单项重检已可用，但顶部统计仍显示旧冲突数，改为从当前 checks 响应式计算并新增回归。

当前人用 RPC 为 `/api/toolbox-human/console`，闭集 actions：snapshot、reconnect、setModuleEnabled、setAgentAccess、getShortcutPreferences、checkShortcut、checkAllShortcuts、updateShortcut、updateGeneral、openManual。reconnect 是 Host 生命周期操作，映射为启动现有桌面服务后取 snapshot；不传任意 IPC、身份、路径或 Agent method。人的功能不依赖 Agent 授权，五支持/五不支持和新授权默认 OFF 保持。

## 自动回归

所有命令先在 `D:\Code\dsh-toolbox` dot-source `scripts/Use-ProjectEnvironment.ps1`，输出留在本工作区。

| 检查 | 命令与结果 |
| --- | --- |
| Node / Loader / Host / Client / Agent | `node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs`：185 通过；Client 最后两次 UI 修正后另跑受影响的三个文件：22 通过（包含在 185 的覆盖范围，不重复计数） |
| Vue | `pnpm --dir native/YourAllIn1Helper/src-ui test`：175 通过，含重检汇总更新回归 |
| Rust Host / policy / OS HAL / clipboard | `cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p all-in-one-host --lib -p os-hal -p mod-clipboard -p app-core --offline --locked -j2 -- --test-threads=1`：85 + 48 + 3 + 17 = 153 通过，4 项 ignored |
| 剪贴板粘贴管线 | `cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p mod-clipboard --test paste_pipeline --offline --locked -j2`：6 通过 |
| 类型与前端构建 | `pnpm --dir native/YourAllIn1Helper/src-ui run build`（vue-tsc + Vite）及 `pnpm --dir packages/dsh-toolbox-client run build:client` 通过 |
| 原生发行构建 | `scripts/Build-Desktop.ps1` 和 `cargo build -p dsh-bridge --release --locked --offline`；逐次实际输出见 `.tmp/beta5-*build.log` |

合计覆盖 **519 项通过**；22 项聚焦重跑和 10 项早期原生聚焦重跑不重复相加。4 项需要特定真实桌面/系统敏感标记等条件的 ignored 测试没有当作通过。只运行受影响范围及现有必要回归，未重新穷举所有十模块/所有外部服务。

## 真实 Windows 验收

`node scripts/beta5-native-acceptance.mjs --allow-desktop`，只使用新建的 D 盘测试库及合成内容：

- 真实测试进程注册 Ctrl+Alt+Shift+F10 后，console checkShortcut 返回 1409 / registration_occupied，owner=null；释放后 available；保存及清除测试绑定成功。
- 测试进程经真实 Win32 clipboard owner 写入合成文本与 2×2 图像，实际入库来源均为 pwsh。重复复制刷新 updated_at；按来源搜索能找到合成文本。
- 默认 Agent 访问拒绝，desktop.console 不能从 agentCall 调用；显式授权后查询，撤回后立即拒绝。模块关闭、重启后显示偏好及默认拒绝保持，正常卸载等待真实子进程退出。
- 一个早期脚本在异步来源更新前就读取了上次测试遗留的同内容图像行，误报 null；修正为等待新复制序列的实际来源更新后通过。保留初次失败日志，不作为通过证据。

证据：`artifacts/beta5-native-acceptance/result.json`、`fixture.log`、初次异步观察失败日志；每次使用的独立 dataDir 记录在 result.json 内。

## Electron 界面验收

实际程序 **`E:\deepseek-harness\DeepSeek Harness.exe`，0.2.2-rc.3**（本机 runtime.json 与 CLI --version 核实）。使用此前用户已登录的 **D 盘隔离预览 Profile**，经官方 `dsh plugin --profile desktop add <两个候选包> --offline --store-dir D:/cache/Node/pnpm/store` 更新；没有改用户日常默认 Profile、认证资料或原 C 盘工程。全新未登录 Profile 停留欢迎页，因此实际界面验收复用已登录预览，未自动填写认证信息。

本轮 GUI 使用新的测试 dataDir：`D:\Code\dsh-toolbox\runtime\beta5-electron\70d07e0d-9987-4c34-93db-99191b84e4c8\toolbox-data`。Profile home 与 Electron userData 路径见 `.tmp/beta5-electron.json`。原登录预览的旧合成便笺数据未迁移/覆盖。

已观察：

- 侧栏工具箱直接渲染十模块主控台、五项 Agent 授权开关和五项“不支持 Agent”；挂载没有弹独立主窗。面板内两列布局及固定页脚可见。
- 人的便笺功能关闭/开启确实写入同一 config.json，Agent 授权一直关闭；其余采集模块保持关闭。
- 内嵌页检查八项已分配组合键；测试进程暂占 Ctrl+Alt+A 后，显示一项冲突，截图动作行显示组合键、1409、未知占用者、可展开原始错误和排查步骤。释放后行状态恢复 available。
- 切换深色只改变工具箱，Harness 侧栏保持原样；显式打开独立主窗时，其主题和模块状态与内嵌页一致。随后恢复跟随系统。
- 通过应用菜单正常退出后，测试原生进程已退出，测试 app.db 可用 FileShare.None 独占打开，证明数据库句柄已释放。

最终候选 `artifacts/beta5-candidate/e0bf468` 已复核：重启客户端后，内嵌按钮打开原生便笺面板（测试库为空）；真实占用 Ctrl+Alt+A 时汇总为 1 项，释放后单项重检，动作行可用且顶部汇总同步变为 0。界面证据 `artifacts/beta5-candidate/ui-summary-after-release.txt`；正常退出时连同原生功能窗关闭，剩余匹配的原生进程 0，测试 app.db 独占打开成功，见 `electron-acceptance.json`。

官方 CLI 实际移除两个插件后，Profile 的 bundle 列表中不再包含它们，测试 app.db 保留；随后从最终 `dist/` 两个归档重新安装成功。命令日志 `.tmp/beta5-remove.log` / `.tmp/beta5-final-install.log`。此前给 pnpm remove 附加 --offline 被拒绝，改用其支持的参数后完成，没有改变全局配置。

最终数据与绑定恢复：本轮新测试目录仅便笺开启，所有 Agent 授权关闭、主题跟随系统；测试持有的全局键已释放，测试进程已退出。`runtime/human-preview.json` 的版本改为 beta.5，保留原预览的登录路径和旧合成数据目录；本轮 GUI 使用的另一个新库不覆盖它。用户日常默认 Profile 未安装/移除插件。

## 最终发布物

验收通过的候选归档按字节复制到 `dist/`，没有重新生成已验收载荷或覆盖旧归档。Host 包 34 文件、Client 包 6 文件，均带 MIT LICENSE；主包不含 lib/features/notes.js、测试 fixture 或旧便笺工具文件。普通 Node 已加载构建后的 lib 并通过真实 Loader/子进程回归。归档内 manifest 与实际 exe SHA-256 一致。

| 文件 | 字节数 | SHA-256 |
| --- | --- | --- |
| `dist/dsh-toolbox-0.1.0-beta.5.tgz` | 16388122 | `aa3185208b2508633f1300bca28ca548159832f4e787dfcd587bffb650265378` |
| `dist/dsh-toolbox-client-0.1.0-beta.5.tgz` | 102916 | `ddfa78293bc08342485c3d266193c39a457cdc6ab679b4c19837f0d72e1f5821` |

桌面 exe 来源 `e0bf468d826105022d8a37d729597c1765af42b3`，SHA-256 `0f3716e752fc945346c6cf872f699949fc51a5f26bca119820e48dbdd104aa59`；headless 协议测试 exe 来源 `fb26108a5b5880bd897c80626a539ff80d686082`，SHA-256 `d4a0e22221a836925b0d09230c4cbf7a341ec0931cea96e091d4843ecb2ce0ea`。生产仍不导出旧 headless 产品工具；该 exe 供历史协议回归保留。早期未通过布局验收的候选仅留在 artifacts 下，不作为发布包。

## 范围与限制

Windows 公开 RegisterHotKey 接口不返回占用者 PID，不能保证指出外部占用程序；本版提供真实分类、原始错误与排查方向，不使用驱动或进程注入。旧剪贴板空来源不回填；系统所有者未知/不可查询时新记录也可为 null。macOS 来源查询未实现。

快捷键录入仍在原生窗口内完成，内嵌页提供明确入口并可检测冲突；主题/语言/模块由同一内核共享，强调色目前按两种 UI 的 localStorage 分别保存。未新增模型请求验收，未重测凭据/Windows Hello、外部翻译、多显示器/其他 DPI、全部十模块长时稳定性；这些不作为 beta.5 全部通过项。
