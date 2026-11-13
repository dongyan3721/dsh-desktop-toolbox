# beta.4 实测反馈：beta.5 开发与派工计划

日期：2026-11-14。负责人：Codex。发布基线：`befe1d8`（`0.1.0-beta.4`）。本文件是开发计划，不是已修复或已验收声明。

用户已让 Cursor 修复默认 dataDir 并发布 beta.4，本轮不重复实现、不覆盖原包/tag。用户已确认其余功能及随 Harness 退出销毁正常，继续作为回归基线。当前 main 干净；三个历史工作树已由 Codex 合并同步 main，保留之前集成的便笺会话释放、画布坐标及 Markdown 修复，无新增分支/工作树。

## 范围和判断

| 项目 | 代码核对 | 修正目标与验收 |
| --- | --- | --- |
| Harness 内主控台 | Client `ToolboxPanel` 挂载时自动调用 `showMain`，只显示外部窗口打开状态 | 点侧栏后在 Harness 主内容区直接显示十模块主控台和功能开关/独立 Agent 授权、偏好设置入口；保留原视觉与操作顺序。页面挂载不弹外部主窗；具体截图/便笺/注释等功能窗口仍使用原生窗口。独立主窗可由明确按钮打开，与内嵌控制台共享同一内核和数据 |
| 快捷键冲突诊断 | native probe 仅返回注册错误；UI 将 detail 放在 title，正文提示笼统 | 展示组合键、失败动作、内部冲突模块/脚本、系统注册状态和可展开原始错误；已知系统保留/非法按键有针对性文案。外部进程只有可靠证据才显示为已确认，不能把前台进程或常见软件猜成占用者；未知时明确无法确认并给关闭相关工具后重新检测、修改组合键等排查步骤 |
| 旧便笺实现 | 生产只注册 `src/agent/notes.js` 的 `toolbox_notes`；旧 `features/notes.js` 仍由历史 fixture 和测试 import，并被构建复制进发布包 | 从生产 src/lib 移除旧实现；有价值的历史协议测试迁到明确的 `tests/fixtures`，更新引用。生产代码只留一代实现；历史归档不动。构建还需移除旧 lib 残留，防止增量复制把删掉的文件重新打包 |
| 剪贴板来源为空 | 真实监听器文本和图片均把来源传为 `None`，存储和查询已有字段 | 接通 Windows 剪贴板所有者窗口→PID→应用名，对文本与图片均生效；序列/所有者变化时避免把新来源与旧内容拼接。取不到来源保留 null，不伪造前台应用，不回填历史未知记录。保持敏感内容排除、模块启停、去重和 Agent 授权 |

Windows `RegisterHotKey` 返回成功/失败和 GetLastError，并不在结果中返回占用者 PID；窗口热键 `WM_GETHOTKEY` 也不能冒充所有全局注册。参考：[RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)。剪贴板来源参考：[Clipboard ownership](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations)、[GetClipboardOwner](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardowner)、[GetWindowThreadProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid)。不采用驱动、进程注入、强制结束其他程序或自动触发未知热键来反查。

## 分工和代码边界

| Zed thread | 既有工作树 / 分支 | 本轮所有权 |
| --- | --- | --- |
| Copilot | `.worktrees/antigravity` / `agent/antigravity-bridge` | Harness Client 内嵌主控台、原 Dashboard/ModuleManager 的有限适配、前端传输适配与对应测试；详见 `tasks/ZED_B5_COPILOT.md` |
| Grok Build | `.worktrees/cursor` / `agent/cursor-native` | 快捷键原生诊断及 PreferencesPanel 呈现、专属类型/辅助函数和测试，三份 locale 的新增文案；详见 `tasks/ZED_B5_GROK.md` |
| Claude Code | `.worktrees/zed` / `agent/zed-features` | 剪贴板来源采集和聚焦 Rust 测试；旧便笺生产实现迁出及 fixture 引用；详见 `tasks/ZED_B5_CLAUDE.md` |
| Codex | main / 集成工作区 | 共享人用传输契约、Host/desktop/native 接线、构建去残留与资源装配、跨栈集成测试、真实 GUI/受控系统测试、发布 |

三个 thread 虽同处 Zed，实际每条命令和编辑必须指向各自绝对工作树。历史目录名不代表仍由旧应用负责。各自的构建/TEMP/Cargo 输出归各自工作树；D 盘缓存和 SDK 只读，不改用户 Profile、个人数据库、全局工具。已有共享 SDK 是 rc.1；rc.3 新 API 必须另有安装物证据，不凭猜测扩展。

## 控制台接线原则与顺序

1. Copilot 先核实可复用原 Vue Dashboard 的打包/嵌入路径，再实现不自动弹窗的真实控制台。优先复用组件、目录、样式；若必须适配 Harness 的 React 容器，业务状态与操作仍来自同一原生服务，不维护第二份配置/目录。不得仅放截图、链接、假开关或未接线的成功提示。
2. 固定 `toolbox-human/console` 人用 RPC 的闭集动作，复用已验证的 Connection carrier；详情见 Copilot 任务。Codex 实现 Host 和 native 配套。不得把任意 IPC、完整 AppConfig、Agent 调用、密码或任意命令暴露给 Client；Agent registry 不注册此接口。授权变更只由人的明确操作发起，默认 OFF 不变。
3. 控制台读取返回所需的投影（模块目录、一般显示偏好、快捷键设置），不传剪贴板正文、窗口标题、应用统计或凭据。切面板/断开/卸载取消在途请求，清理监听及计时器；操作失败回读原生规范状态，不乐观显示成功。旧外部主窗与控制台的修改双向可见。
4. 先交付各自可审查提交和 handoff，Codex 按依赖集成。Grok 改 PreferencesPanel，Copilot 不写该文件；Claude 只动 tauri_app 的剪贴板监听段，Grok 不写该文件，相关注册调用接线由 Codex 处理。发现跨边界需要，写 handoff，不各自抢改。

## 里程碑和验收门槛

- M1：三个任务开工；内嵌方案和闭集 Host/native 协议核定，快捷键诊断真实边界写清，来源采集覆盖文本/图片和失败路径。
- M2：代码合入后运行受影响的 Node/Vue/Rust 测试、Client/原生构建和干净构建产物检查。扫描生产包确保旧 notes 工具及陈旧 lib 文件不再出现；未授权 Agent 不能通过控制台新增接口自我授权。
- M3：Codex 在 D 盘隔离 Profile/测试数据进行真实 Electron 验收：点侧栏不弹主窗、十模块/双开关与原窗同步、快捷键有占用/释放后重检、生成文本/图片的来源采集与来源搜索；关闭/重启/卸载不残留窗口/注册/后台子进程。使用时长、笔记/画布及默认拒绝做必要回归，不读取个人历史或凭据。
- M4：通过后才准备 beta.5 两个安装包、清单/哈希和已测/未测记录；不覆盖 beta.4，不提前打发布 tag。用户实测结果与本轮自动测试、真实 GUI 证据分别记录。

本轮规划/派工完成不代表上述功能已经修复。对于 Windows 无法可靠识别外部热键持有者的情况，以准确边界和可操作排查信息作为可交付改进，不把猜测包装成“找到进程”。
