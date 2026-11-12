# Cursor / Grok 4.7 High 交接 — 原生桥第一轮

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`  
分支：`agent/cursor-native`  
未合并 `main`。主目录 `D:\Code\dsh-toolbox` 未改。

## 已实现

可启动进程 `dsh-toolbox-native`。它只挂载 `AppKernel` 和 `sticky_note`，使用内核默认的 `HeadlessWindowBackend`。没有创建 WebView，没有启动剪贴板、应用统计、密码本、截图、屏幕注释、窗口置顶、脚本或翻译模块，也没有使用 `MockOsHal`。

`capabilities` 只包含已经跑通的方法：

- `status`
- `notes.create`
- `notes.search`
- `notes.update`
- `bridge.shutdown`

`notes.create` 调用模块的 `create_note` 后立即 `close_note`。返回的 `StickyNoteRecord.is_open` 为 `false`，窗口池计数为 0。`open: true` 返回 `UNSUPPORTED`，不会写数据库。Headless 后端在创建过程中只会在内存里登记一次窗口请求，关闭时去掉；这不是桌面便笺窗口，也不能当成后续 Tauri 窗口能力。

`notes.search` 要求非空查询，`limit` 为 1..=20，`offset` 为 0..=10000，只返回命中的一页。`notes.update` 在独占数据锁内比较 `expected_updated_at`。模块自己的 `updated_at` 是毫秒墙钟，桥在时钟没有前进时把令牌改成旧值加 1，因此冲突检测不依赖时钟分辨率。不匹配返回 `CONFLICT`，不会写入。

管道是 `\\.\pipe\dsh-toolbox-<instance-id>`。创建时带当前用户单独的允许 ACE、`SE_DACL_PROTECTED` 和 `PIPE_REJECT_REMOTE_CLIENTS`。连接后用 `GetNamedPipeClientProcessId` 核对 `--parent-pid`，不一致就断开并继续等待父进程。父进程退出、已验证客户端断开、协议错误或 `bridge.shutdown` 都会先停内核、再释放 `instance.lock`。数据目录必须是绝对路径，并且不能落在 `APPDATA` / `LOCALAPPDATA` 下面。

## 启动参数

```text
dsh-toolbox-native.exe --pipe-name \\.\pipe\dsh-toolbox-<uuid> --instance-id <uuid> --data-dir <绝对路径> --parent-pid <pid> [--allow-read-root <已存在绝对目录>] [--allow-write-root <已存在绝对目录>]
```

`--pipe-name` 必须等于 `\\.\pipe\dsh-toolbox-` 加上同一个 `--instance-id` 字符串。`--parent-pid` 必须是仍可打开的其他进程。读写根会做规范化并拒绝用户配置目录；这一轮没有图片转换，所以根目录只被校验和保存，不参与授权写入。

退出码：参数、父进程或数据锁失败为 1。握手后的正常关闭、断线、协议拒绝和父进程退出在释放资源后为 0。

## 构建

在工作树执行，并在点源环境脚本后改写 Cargo 目录：

```powershell
. .\scripts\Use-ProjectEnvironment.ps1
$env:CARGO_TARGET_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target'
$env:CARGO_BUILD_BUILD_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\intermediates'
cargo test -p dsh-bridge --manifest-path .\native\YourAllIn1Helper\Cargo.toml --offline
cargo build -p dsh-bridge --release --manifest-path .\native\YourAllIn1Helper\Cargo.toml --offline
```

Release 二进制：

`D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target\release\dsh-toolbox-native.exe`

测试产物在 `build\rust\cursor\intermediates`。没有改全局 Rust、Cargo 或用户工具箱数据。

## 测试

`cargo test -p dsh-bridge --offline`，13 项通过，0 失败。

库测试覆盖部分帧、粘包、空帧、超长帧、坏 UTF-8、坏 JSON、版本不符、真实 SQLite 重启、冲突更新、`open: true` 不落库、禁用模块不进入 capabilities、进程内重复锁，以及管道 DACL 只有当前用户一条允许 ACE。

进程测试在工作树 `.tmp\dsh-bridge-tests` 上启动真实 exe，覆盖：

- 创建便笺、关闭进程、再次启动后按内容查到同一条，且 `is_open` 为 false
- `clipboard.read` 与图片转换返回 `UNSUPPORTED`
- 长度 0 的帧关闭进程并释放锁
- 第二个进程锁同一数据目录时非 0 退出，stderr 含 `locked by another instance`，第一个进程仍可 `status`
- 连接进程不是 `--parent-pid` 时连接被断开；父进程退出后锁释放，新进程可以再启动

没有操作其他应用、系统剪贴板或认证界面。没有做远程命名管道客户端测试；远程拒绝来自 `CreateNamedPipeW` 的 `PIPE_REJECT_REMOTE_CLIENTS`。没有做真机窗口、截图遮罩或 WebView 测试。

## 未实现

`media.convert_image` 不在 capabilities 里。`image::process` 是 `mod-media-proc` 的私有函数。公开的 `submit_image_jobs` 自己生成输出文件名，并且在后台任务完成前就返回，不能满足协议要求的精确 `outputPath`、拒绝覆盖，以及取消落定后再响应。这一轮没有另写一套编码器，避免假成功。

也没有便笺窗口、截图遮罩、屏幕注释或其他桌面 HAL。后续仍应按迁移计划把桥接模式接回 Tauri，而不是把 Headless 后端当成生产窗口系统。

## 给集成的约束

信封使用 serde 的 `deny_unknown_fields`。hello、request、cancel 不能带协议之外的字段，否则连接关闭。请求 `params` 也只接受各方法列出的字段。`notes.search` 的空查询会被拒绝。取消若和请求在同一批已读帧里，会在写入前返回 `CANCELLED`；写入已经开始后不会再报取消。

不需要修改 `BRIDGE_PROTOCOL.md`。若下一轮要做图片转换，需要 `mod-media-proc` 提供一个公开函数：调用方指定输出路径、已存在则失败、取消标志在替换最终文件前生效，并且能等待取消落定。在那之前不要把 `media.convert_image` 注册成工具。
