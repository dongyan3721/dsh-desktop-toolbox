# macOS 本机验收与依赖解耦结论

日期：2026-11-14。本轮为本地探索、修复与安装验收，没有发布新版本或改写历史发行资产。

## 结论

Apple Silicon 上，真实 Harness 插件安装、Host/原生私有通道、内嵌工具箱、原生便签与 Agent 共享数据、截图和屏幕注释已跑通。不能据此声明全部十个模块与 Windows 完全一致：全局快捷键物理触发、持续使用时长累计、Intel、多显示器混合缩放，以及若干系统权限/硬件能力仍需补测。

桌面与插件应独立维护、独立发版，通过协议版本、capability 与固定发行资产关联。独立桌面 `0.1.4-beta` 当前没有插件桥接/授权实现，因此直接替换 `native/` 会丢失能力。本轮没有写入独立桌面仓库。完整迁移顺序及外部运行时配置见 [依赖边界方案](DESKTOP_DEPENDENCY_BOUNDARY.zh-CN.md)。

## 实际环境与来源

| 项目 | 验收值 |
| --- | --- |
| 系统/架构 | `sw_vers -productVersion`: `27.0`；`darwin-arm64` |
| 已安装 Harness | `/Applications/DeepSeek Harness.app`，`0.2.2-rc.3` |
| Node / pnpm | Harness 自带 Node `24.21.0` / pnpm `11.28.5` |
| 独立桌面输入 | `/Users/santa_antilles/Desktop/your_all_in_one`，`baeb3e423d222426ae9a7824b81cfb3b157bf8a6`，`0.1.4-beta`，只读比较 |
| 原生版本 | 保留 `0.1.3-beta`；基于原快照并回补桥接及本轮修复，没有冒称已整体升级到 0.1.4 |
| 最终原生 revision | `f20782502eedafd5871cdb78b2e535c30970df7b` |
| 最终 Mach-O SHA-256 | `9220106c938b3964174b73bc8ba88d697d264970787e83ab1ffec61966adf0d6` |
| 预览包来源 revision | `3683573`，包内 `distribution/provenance.json` 保存完整值 |
| 本地预览包 | `artifacts/macos-preview/dsh-toolbox-bundle-0.1.0-beta.6.macos.0.tgz` |

真实 SDK 从已安装 rc.3 的 `app.asar` 提取到工作区，不用旧 rc.1 vendored SDK 代替 rc.3 证据。六位协作者均使用 Zed 已有线程，独立 worktree/分支，未改用户选择的模型和模式。提交、命令与局限见 `docs/handoffs/MACOS_*.md`；Codex 合入集成分支并负责以下真实桌面测试。

## 本轮修复

- Host 在 macOS 选择独立架构资源，通过私有 Unix socket 连原生进程；端点长度、目录所有者/权限、对端 UID/PID、dataDir 独占锁及父进程退出监听均有真实平台实现。
- 外部 `nativeExecutable` 可以配套 `nativeManifest`：启动前核对协议、平台、架构和 hash，随后仍进行真实握手/capability 检查。桌面版本无需与插件版本同步。
- macOS 资源包含完整 `.app`，保留 Info.plist、图标和可执行文件。只打包裸 Mach-O 曾导致应用身份/GUI 自动化识别不完整，已修正。
- `pnpm pack` 会将未声明为 CLI 的原生文件规范为 `0644`。预览脚本对自己的 pack 输出恢复执行位后重新归档；真实 pnpm 安装后仍为 `0755`。没有加安装 hook、CLI 假入口或放宽构建/外来依赖策略。
- 每个真实截图入口增加当前 TCC 权限预检，避免无权限时把仅壁纸帧误报为成功；本机已有权限下的真实截图通过，本轮没有更改系统权限。
- Retina HAL 继续使用桌面逻辑点，Agent 边界转换为物理像素；注释画布不再把逻辑尺寸再次除以缩放。Windows/合成 HAL 保持原像素语义。
- 回补独立桌面已存在的两个修复：GIF 排除窗口销毁时停止；macOS 翻译浮窗边界限制。未移植独立应用自动更新/签名发布链。

## 实测记录

| 链路 | 结果与证据 |
| --- | --- |
| 安装后的 Host + Client | 用 Harness 自带 `dsh plugin --profile toolbox-macos add <tgz>` 安装，实际启动独立 `.app`。左侧“工具箱”可打开内嵌功能/偏好页，并调用 Host 打开原生便签面板。截图：`artifacts/macos-harness-toolbox.jpg` |
| 默认授权 | 新 dataDir 的五项 Agent 授权全 OFF，工具列表为空；其他五项始终不支持 Agent |
| 原生便签 ↔ Agent | 在真实原生窗口创建/编辑合成便签；真实 rc.3 tools executor 读取同一内容；工具 CAS 更新后原窗口即时显示 `MACOS_AGENT_UPDATED_20261114`。重启后内容保留 |
| 模块/授权独立持久化 | 关闭便签模块后 allowed 保留、effective 为 false，旧工具返回 `MODULE_DISABLED`；重启后状态保留；重新开启模块恢复有效授权。原生 UI 撤销授权后工具消失，当前实例旧引用返回 `AGENT_ACCESS_DENIED` |
| 剪贴板 | 在监听前用原生合成便签复制合成文本；工具实际写入 OS 剪贴板，返回 `backend:os`，共享历史可 list/read 到相同文本。未读取原有个人剪贴板历史 |
| 截图 | `synthetic:false`，枚举真实内置屏；32×32 物理区域捕获返回真实 PNG，并通过 rc.3 attachments 服务产生 image attachment |
| 屏幕注释 | 真实 start、draw、passthrough、snapshot、clear、stop 均成功。原始快照 2940×1912，attachment 经图片策略输出 2539×1651 WebP |
| Retina 右下区域 | 最终枚举 2940×1912，scale=2。笔画 `(2200,1500)→(2600,1750)` 获 UI applied=1/revision=1；对实际 attachment 解码后，只抽查合成笔画预期位置，9/9 点符合 `#00AAFF`。结果：`artifacts/macos-retina-pixel-verification.json` |
| 使用统计 | status 返回 tracking=true / 1000ms，overview 可查询；本轮 overview 为 0，未验证持续增长/idle/锁屏/音频例外，不把状态成功当成计时正确 |
| 快捷键 | 设置、物理 accelerator 转换、macOS 符号显示及重启持久化已验证，注册未返回错误。CUA 发送组合键未观察到新便签，物理键盘全局触发仍待人工验证；测试绑定已清除 |
| 正常卸载 | 多轮 unload/quit 均确认 processesExited=true、remainingTools=[] |
| Host 意外退出 | 对本轮专用驱动 PID 发 SIGTERM 后，所属原生进程退出，私有 socket 删除；没有触碰独立个人实例 |
| 模型基线 | 日常 Harness 中新建纯合成基线对话，模型实际回复 `HARNESS_MACOS_AGENT_OK`。隔离 profile 未复制凭据，因此插件工具证据来自真实 SDK executor，不冒称已完成模型选择工具的整轮对话 |

注释窗口创建后立即 draw 曾返回尚无 UI acknowledgment，随后窗口 ready 后执行成功；一次 `UNAVAILABLE` 会暂时撤回工具，下一轮 access 刷新恢复。这是观察到的瞬态，未伪造成功。

JSONL 证据位于 `artifacts/beta-acceptance/`，重点 run：`macos-arm64-20261114-gui`（便签/授权）、`macos-arm64-20261114-modules`（五模块真实 SDK）、`macos-arm64-20261114-retina`（最终 Retina）。运行数据仅在 `runtime/` 工作区内；系统剪贴板最终为本轮合成内容/图像，未为“恢复”而读取个人剪贴板。

## 构建与检查

命令均先 `source scripts/use-project-environment.sh`。Node 编译缓存、Cargo home/target、pnpm store、Harness 测试 profile 与临时文件均落在当前工作区；安装的 Harness 只读。

| 检查 | 结果 |
| --- | --- |
| Vue UI 单元测试 / 类型检查 / Vite 构建 | 175 测试通过，类型检查及构建通过；重新生成内嵌 Client |
| 跨平台 Host/Agent/打包聚焦测试 | 188 通过，0 失败；`artifacts/macos-portable-tests.log`。没有声称全量 Windows `.exe` fixture 测试通过 |
| GIF 聚焦测试 | 14 通过；`artifacts/macos-gif-tests.log` |
| macOS transport/endpoint | 6 通过；`artifacts/macos-transport-tests.log` |
| os-hal / screen-ink | 21 + 9 通过，1 个要求登录桌面的原生测试显式 ignored；含 Retina 坐标回归，`artifacts/macos-retina-tests.log` |
| Host Agent API（release） | 10 通过，覆盖授权、同库数据、CAS、图片与画布确认；`artifacts/macos-host-agent-tests.log` |
| arm64 原生 release + `.app` | 实际构建成功；`artifacts/macos-desktop-build.log`、`artifacts/macos-app-bundle.log` |
| tarball 隔离安装 | 实际 pnpm 安装成功；`artifacts/macos-preview-final-install.log`，验证安装后二进制 hash/执行位与原 manifest 一致 |

关键原生命令：

```sh
source scripts/use-project-environment.sh
cargo build --manifest-path native/YourAllIn1Helper/Cargo.toml -p all-in-one-host --bin all-in-one-desktop --features tauri/custom-protocol --release --locked --offline -j2
cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p os-hal -p mod-screen-ink --lib --locked --offline -j2
cargo test --manifest-path native/YourAllIn1Helper/Cargo.toml -p all-in-one-host --lib --release --features tauri/custom-protocol --locked --offline -j2 -- agent_api::tests::
```

可重复的架构构建入口为 `bash scripts/build-desktop-macos.sh darwin-arm64`（Intel 则 `darwin-x64`）。需先准备本 worktree 的冻结 UI 依赖和 Cargo registry；本轮从现有 registry 只读复制依赖缓存，没有更改全局工具。脚本显式 `--target` 的独立输出路径未完整重跑；实际 release 使用上面的本机目标命令，之后从 native 根执行 Tauri CLI `bundle --bundles app --ci --no-sign --no-binary-patching`，再运行 `bundle-desktop-macos.mjs`。标准 `.app`、归档与安装均已真实执行。

## 发布前仍需完成

1. 桥接/授权/共享窗口能力上移到独立桌面仓库，再生成固定版本外部资产，最终撤掉插件长期维护的第二套业务源码。当前只是接入基础与迁移方案，不是已经完成上移。
2. 真实物理键盘全局快捷键、使用统计长时采样；Retina 外接多屏/混合缩放/负坐标，Intel 与 Windows 回归。
3. macOS 权限首次拒绝、撤销、重新授权后的行为；OCR、自动长截图及 Accessibility 相关入口。当前未改变用户已有 TCC 权限。
4. 密码本/Touch ID/钥匙串、翻译选区、外部解释器与 ffmpeg 路径分别实测；未接触个人密码库。外部窗口真正置顶在 macOS 明确 unsupported，激活窗口不能冒充置顶。
5. Developer ID 签名、公证、干净机器 Gatekeeper 与正式发布流程；当前 `.app` 是本机构建，不是可公开分发的签名发行版。

现有 Windows beta.6 根 manifest、`distribution/`、历史 tags/归档保持不变。本地 `.macos.0` 包是独立验收产物，不替代已发布版本。
