# 首个 beta 本机验收与发布记录

`0.1.0-beta.2`，2026-11-13。beta.1 是保留的内部候选，追加翻译实机验收发现事件权限缺口后停止交付；beta.2 修正此问题，已完成本机受控功能/界面复验和真实包安装，作为第一个可用本机 beta；不是十模块全部场景、个人数据迁移或外部分发认证。沿用现有分支/工作树，原 C 盘项目只读，构建、测试、包与数据均在 D 盘。

## 发布范围

人用主窗、十模块目录、偏好、原窗口与快捷键继续复用原程序。功能启停和 Agent 授权独立；默认只有便笺启用，Agent 授权全关。截图、剪贴板、屏幕注释、使用时长、便笺五项在授权后共享同一 GUI 内核/数据；脚本、多媒体、窗口置顶、翻译和密码本不支持 Agent。新包根入口已退役旧 headless Agent，历史归档不覆盖。

## 自动验证

| 范围 | 实际结果 |
| --- | --- |
| Node、真实 SDK 与既有集成 | 173 通过 |
| Vue 组件/逻辑 | 168 通过 |
| Rust 桌面宿主库 | 78 通过 |
| Rust app-core 库 | 17 通过 |
| 九个非凭据功能模块的 Rust 测试 | 193 通过，2 个显式集成测试忽略 |
| 上述忽略项之一：真实 FFmpeg 合成视频队列 | 单独启用，1 通过 |
| **本次合计** | **630 通过，0 失败；外部翻译实网测试未运行** |

Vue 类型检查、Vite 生产构建、桌面 custom-protocol Release、原生桥 Release 与两个 npm 包构建通过。并未宣称整个 Rust workspace 全测。现存 os-hal/vault 等编译警告未影响本次构建。

先点源 `scripts/Use-ProjectEnvironment.ps1`。复现命令：

```powershell
node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs
pnpm.cmd --dir native/YourAllIn1Helper/src-ui test
pnpm.cmd --dir native/YourAllIn1Helper/src-ui build
cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p all-in-one-host -p app-core --lib --locked --offline -j2 -- --test-threads=1
cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p mod-media-proc -p mod-window-pin -p mod-script-runner -p mod-translator -p mod-screen-ink -p mod-screenshot -p mod-clipboard -p mod-app-usage -p mod-sticky-note --locked --offline -j2
./scripts/Build-Package.ps1
```

同版本包已存在时构建脚本拒绝覆盖。FFmpeg 专项使用工作区生成的 6 秒 testsrc+sine 视频，指定 `ALL_IN_ONE_QA_MEDIA_INPUT/OUTPUT` 后执行 `mod-media-proc --test real_ffmpeg authorized_real_video -- --ignored`；真实完成裁剪、转码、音频提取、音量调整并检查源文件不变。普通脚本模块测试执行受控子进程，不通过 Windows UI 输入终端命令。

## 真实功能和界面

显式驱动 `scripts/beta-desktop-session.mjs --allow-desktop` 使用真实 Cordis Loader、工具执行器、附件存储和打包的原生程序；不模拟 GUI/原生 IPC，不纳入日常测试。全新验收数据与旧预览隔离。

| 项目 | 实际观察 |
| --- | --- |
| 内置页面 | 加载内置 tauri.localhost 资源，不依赖 Vite；主窗小尺寸单列和最大化四列均可读，十模块和五项“不支持 Agent”标记正确 |
| 四种开关组合 | 五模块全部以停机隔离配置夹具逐组合重启验证：未授权调用拒绝，已授权但功能关返回 MODULE_DISABLED，双方开启仅注册五类工具；授权不影响人的入口 |
| 旧引用/退出 | 卸载后工具撤回为零，自有进程退出；缓存旧工具不能再访问。实时撤权、在途取消与产物代次另由 Rust/Node/Vue 回归覆盖，未通过 UI 自动点击隐私开关 |
| 便笺共享 | Agent 创建关闭便笺后原列表可见；人用“唤醒窗口”打开原编辑器。人工输入后 Agent 读取立即取得正文；Agent CAS 更新返回 display_sync: applied，原窗口显示新正文；旧版本更新被拒绝 |
| 便笺显示/持久化 | 中文、Markdown、KaTeX 公式实际渲染；保存关闭后原生进程重启，正文保持。读写准备握手及解冻、迟到保存与会话替换另有回归 |
| 系统剪贴板 | 实际 OS 写入中文/emoji，返回 backend: os；Agent 查询和原剪贴板列表显示同一条记录。开始监听前先置入合成文本，不读取个人剪贴板历史 |
| 共享画布 | Agent 绘制出现在原透明画布；人工拖画后 Agent 快照同时包含双方墨迹。像素检查：2919 → 4316 个非透明像素，Agent 清屏后为 0；不是桌面截图 |
| 截图附件 | 枚举真实 1920×1080 显示器，在工具箱最大化界面内截取 900×330 区域；77940 字节 PNG 跨 64 KiB 分块进入真实 Harness attachment-local，并产生图像内容块 |
| 使用时长 | 真实采样状态与原面板日/应用/小时统计均可用；窗口标题保留关闭，面板显示“标题已隐藏” |
| 原快捷键 | Agent 全关时 Ctrl+Alt+D 呼出原历史弹窗、Esc 关闭；Ctrl+Alt+A 进入截图选区、Esc 取消。已安装 Electron 中 Ctrl+Alt+Shift+B 启停原画布，Ctrl+Alt+Shift+S 穿透后可编辑底层会话 |
| 多媒体 | 原面板检测本机 FFmpeg/FFprobe；用文件选择器添加 D 盘合成 PNG，提交真实任务，显示 100%/已完成并生成 `_media.png`；音视频另有真实专项 |
| 人用模块面板 | 原脚本面板显示 Python/Node/PowerShell/Batch/VBScript 探测结果与无脚本空态；窗口置顶原窗口表可见；实际将受控 Harness 窗口置顶，再用 Ctrl+Alt+Shift+C 恢复普通层级；Ctrl+Alt+Shift+W 打开准星、Esc 取消。翻译面板显示 API 未配置 |
| 可见入口与托盘 | beta 升级后 Electron 侧栏“工具箱”打开原主窗；关闭主窗后进程保留，再次打开复用相同窗口 ID，无第二内核。原偏好/快捷键分组页面可见 |

追加修复 `2ef1400`：独立 `feature-*` 窗口缺少 core:event 的 listen/unlisten 权限，导致翻译已发送的错误事件无法到达前端，界面持续“翻译中”。新增明确列举十个功能窗、仅包含事件监听/移除两项权限的 capability；新增回归从实际 FEATURES 目录检查所有功能窗口的事件权限。这也补齐媒体进度与内核状态通知。beta.2 真实程序再次提交同一无密钥请求，立即显示 Google API Key 未配置错误，翻译按钮恢复可用；不再永久加载。Google 适配器本身会发送错误事件，初查时“后端丢弃早期错误”的判断不适用于此次复现，实际根因是独立窗口接线。

本轮界面修复 `de0c53b`：将原 FeaturePanel 的共用卡片样式提为全局共享，解决嵌套使用时长/脚本组件卡片无样式、摘要挤在一起；重新构建后的原生使用时长面板已复验。同步纠正翻译界面只写 macOS 钥匙串的说明，明确 Windows 系统凭据库。

## 安装、模型、升级与移除

- 新的隔离 Harness CLI Profile 实际安装最终两个 beta.2 tarball。默认无 Agent 工具且原生直调拒绝；显式夹具授权后只有五类工具。通过实际安装包完成便笺、原画布、真实 SDK 图像附件和进程重启持久化。
- 冷启动画布尚未注册时，draw 可返回 BUSY，snapshot 可返回 UNAVAILABLE。第一次安装验收因立即绘制而未通过；修正验收驱动，先在明确启动后以 15 秒上限轮询只读快照（仅 BUSY/UNAVAILABLE），等待原画布就绪，再单次绘制，不重试可能已提交的写操作。beta.1 的 `shared-ready.log` 与 beta.2 的 `shared-final.log` 均通过；早期失败日志保留，不冒充成功。
- CLI 环境没有 Connection 服务，可见 Client Entry 等待 connection 属于预期；实际可见入口在 Electron 内另验。
- 隔离 CLI Profile 移除 Client/Host 后，组合配置无 toolbox Entry，自有进程已退出，`app.db` 仍保留。
- 已登录隔离 Electron 从 alpha.6 正常退出后经官方 CLI 先升级 beta.1、再升级最终两个 beta.2 包；登录与旧测试会话保留。没有修改日常默认 Profile。
- DeepSeek-V4.1-Flash High 在 Electron 真实调用 toolbox_notes 创建/回读 `DSH-BETA1-MODEL`；按精确 ID `c6fa9ded-6a25-46b3-bd28-c640997e48ed` 查询数据库，中文及 Markdown 完全一致。
- 人工通过原画布画入两条红色交叉线，提示词不透露颜色/形状；模型调用 snapshot 后正确描述红色 X，图中没有桌面、图标或文字。附件经真实模型链路读取，不以自称成功作唯一依据。
- 最终 beta.2 再经已登录 Electron 真模型复验：精确 read 旧合成便笺，同时读取一次全新画布快照。此次人工只画一条红色竖线，模型正确识别单竖线并明确区别于旧 X，确认新包图片确实抵达模型；没有复用上一轮视觉结论。证据 `beta2-model-image-ui.txt`。
- 验收结束恢复预览测试前的模块启停与授权状态；保留原登录、测试数据与新合成便笺。用 `scripts/Open-HumanPreview.ps1` 可重新打开。

beta.1 候选归档保留作为问题复现，不能用于最终交付。最终 beta.2 的 Agent JS 和 Client JS 与 beta.1 26 个文件逐字节比对一致；原生改动是独立功能窗事件权限及新增回归。

## 发布物与证据

Host `dist/dsh-toolbox-0.1.0-beta.2.tgz`，16336752 字节，SHA-256 `02a78a4fc2937ad976e24c7ec7bce901c65ab24364ece0880d14282937de7da5`。

Client `dist/dsh-toolbox-client-0.1.0-beta.2.tgz`，4332 字节，SHA-256 `98d3ca72b914edc4647fe4bd122347e96284392566c45cf50a6e000f15e702cb`。

最终原生源码提交 `2ef140050ded033d520bfc130aa2a98a12967ea3`；桌面 exe SHA-256 `3f1bd82e1155e7f0ce48eb3a854b8053d9369696c30943c487705a6d95caeeff`。版本清单随包；归档 README 与当前源码逐字节一致。最终发布载荷源码基线 `2ef1400`，其后仅验收脚本/记录更新。

集成树证据：`.tmp/beta1-{node-test,ui-test,host-test,modules-test,real-ffmpeg,package-build}.log`；`artifacts/beta-acceptance/beta1-f4091f79-d21a-44d2-baf2-cc85d16a6096/` 中有真实 NDJSON、透明像素检查、截图附件、模型精确数据库核对及可见回复记录；初始候选安装证据在 `artifacts/beta-package-acceptance/75c19f6c-ca01-4cf9-8e83-63cbba667db7/`；最终包默认拒绝、共享、重启、卸载与数据保留重新通过，证据在 `artifacts/beta2-package-acceptance/462a2d2b-11cc-4cae-9cba-60cec9b53476/`。新增日志前缀 `beta2-node-test/ui-test/package-build`；其余未变代码使用本次已通过回归。运行日志仅本地保留，不将临时会话 token 或登录文件提交 Git。

## 明确保留的 beta 限制

1. 密码本、Windows Hello/系统认证、密钥保存与取回未做 UI 自动化。[Computer Use 技能](C:/Users/xcxix/.codex/plugins/cache/openai-bundled/computer-use/26.1106.51428/skills/computer-use/SKILL.md) 引用的操作指南明确“Do not automate user authentication dialogs”及“Do not automate password manager apps or password manager websites”；凭据流程由本人手工验收，不作为本次通过项。
2. 外部翻译未配置测试凭据，不发送真实请求；自定义服务实网测试保持忽略。窗口置顶准星点击目标、翻译默认全局键、便笺全局键录入等未在本轮全部重跑；原 H1 和自动回归覆盖不能代替这些 OS 场景。
3. 截图滚动/GIF/OCR/贴图、画布全部笔型/撤销、锁屏/睡眠/音频 AFK、脚本全部运行时及异常恢复未逐个进行新一轮人工场景遍历。
4. 只在本机 Windows x64、单屏 100% 缩放受控验收；多显示器、其他 DPI/系统、Windows 前台窗口焦点策略、长时间稳定性及强杀恢复仍待扩大覆盖。
5. 原个人数据与配置导入未实施；没有把原 C 盘数据库搬入新内核。外部公开分发前仍需第三方许可及兼容性审计。

这些是 beta 范围，不能写成全部十模块已经原样替代旧工具箱。下一轮优先补齐上述人用场景和异常恢复，再推进旧数据迁移。
