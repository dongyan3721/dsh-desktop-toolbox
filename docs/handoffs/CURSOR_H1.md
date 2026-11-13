# Cursor / Grok 4.7 High 交接 — H1 桌面插件模式

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`

分支：`agent/cursor-native`

未合并 `main`。主目录 `D:\Code\dsh-toolbox` 未改。没有启动桌面程序，没有跑 GUI smoke，没有发送全局键。

提交：

- `be5d8b7` 正式 `--toolbox-plugin` 启动、隔离数据目录、私有控制管道，以及原快捷键注册表的启用/停用。参数隔离、管道和快捷键回归写在同一组文件里：`tauri_app.rs` 的 setup 同时拥有数据目录、管道就绪和退出刷新，拆成三次提交不能各自编译。这一笔是可集成的编译单元。

## 公共控制接口

只存在于 GUI 二进制 `all-in-one-desktop`。headless 桥不实现这些参数。

```text
all-in-one-desktop --toolbox-plugin --pipe-name \\.\pipe\dsh-toolbox-<uuid> --instance-id <uuid> --data-dir <absolute> --parent-pid <pid>
```

管道名必须等于 `dsh_bridge::transport::expected_pipe_name(instance_id)`。`--smoke-test` 仍走原来的 headless `DesktopHost::bootstrap` 加 demo seed。插件模式拒绝 `--smoke-test`、`--ui-smoke-test` 和 `--keep-open`。没有 `--toolbox-plugin` 时，管道参数被拒绝，空参数仍是独立桌面。

插件模式只启动原来的 Tauri 事件循环和一份 `DesktopHost` / `AppKernel`。不调用 `BridgeService` 或 `run_from_env`。`dsh-bridge` 新增的 `transport` 只转出已经测过的 v1 帧、当前用户管道、父进程 watch 和 `InstanceLock`。桌面在 `data_dir/instance.lock` 上持有这把锁，第二份内核在进 GUI 前失败。

数据目录必须是绝对路径，且不能落在 `APPDATA` 或 `LOCALAPPDATA` 下面。运行时创建 `webview`、`logs`、`temp`。`run_plugin` 设置 `WEBVIEW2_USER_DATA_FOLDER`、`TEMP`、`TMP`、`TMPDIR`。主窗口、置顶角标和保存提示的 WebView 都带 `data_directory`。没有 `config.json` 时只启用 `sticky_note`，`launch_at_login` 为 false，不写演示数据，不注册更新插件，不调用 `updates::start` 或 `install_after_shutdown`，启动时不打开主窗口。已有 `config.json` 不覆盖。

帧仍是 bridge v1：4 字节小端长度加 UTF-8 JSON。先 `hello`，运行时初始化完成后再 `ready`。`ready` 放在全局快捷键注册和托盘安装之后。连接进程的 PID 必须等于 `--parent-pid`。入站通道容量是 1；同一批里的 request 和 cancel 返回 `CANCELLED`，不调用方法。`status`、`desktop.show_main`、`desktop.open_panel` 在 Tauri 主线程执行。`desktop.show_main` 走原来的 `WindowSpec::dashboard("/overview")`，已有窗口按原逻辑聚焦复用。`desktop.open_panel` 只接受目录里的 `module_id`；未知返回 `INVALID_REQUEST`，禁用返回 `DISABLED`。

| 方法 | 参数 | 成功结果 |
| --- | --- | --- |
| `status` | `{}` | `protocolVersion:1`、`nativeVersion`、`capabilities`、`modules`、`desktop:true` |
| `desktop.show_main` | `{}` | `{opened:true}` |
| `desktop.open_panel` | `{module_id}` | `{opened:true}` |
| `desktop.shutdown` | `{}` | `{stopping:true}` |

`capabilities` 只有这四项。`desktop.shutdown` 先在 UI 线程外调用原来的便笺 `flush_open_windows`。失败返回 `INTERNAL`，结果里没有 `stopping:true`，也不调用 `app.exit`。成功后才写 `{stopping:true}`，随后 `app.exit(0)`。退出路径看到这次刷新已接受，就不再做第二次可失败的刷新。父进程退出、控制连接断开或协议错误走同一条刷新门槛；刷新失败时不退出。关闭主窗口仍隐藏窗口并保留托盘和快捷键，这段原逻辑没有改。

这是宿主控制管道，不是 Agent 工具。没有新增 Agent 方法，也没有 `actor:human` 入口。

## 构建

```powershell
. .\scripts\Use-ProjectEnvironment.ps1
$env:CARGO_TARGET_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target'
$env:CARGO_BUILD_BUILD_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\intermediates'
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 plugin_launch desktop_control
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 preferences::tests
cargo test -p dsh-bridge --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2
cargo build -p all-in-one-host --bin all-in-one-desktop --release --manifest-path .\native\YourAllIn1Helper\Cargo.toml --offline --locked -j2
```

Release 二进制没有启动：

`D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target\release\all-in-one-desktop.exe`

SHA256：`B360DF5C3580EB0405F0F0479AC16A98E542952A8A8BF528EE2665B38D62D714`

这个哈希对应 `be5d8b7`。Tauri 的 `beforeBuildCommand` 在工作树里编译了未改动的 `src-ui`。`Cargo.lock` 只给 `all-in-one-host` 补上已有的 `dsh-bridge` 和 `uuid`。桌面 crate 额外打开 tokio 的 `io-util` 和 `net`，工作区默认 features 里没有这两项。

## 测试

这些都是非 GUI 测试，没有调用 `RegisterHotKey`，也没有发送按键。

`plugin_launch` 与 `desktop_control`：7 通过。覆盖独立模式和 `--smoke-test` 与插件模式分离、错误管道名和用户目录被拒绝、新配置只启用便笺且 `sticky_note:create` 未分配、已有配置保留 `screenshot:capture = PrimaryMod+SecondaryMod+F8`、禁用截图时该动作不在注册表、重新启用后恢复、再次禁用后移除、控制客户端必须是父进程、`ready` 等运行时标志、重复 `show_main`、同批取消不打开窗口、失败的 shutdown 不带 `stopping:true`、父进程退出在刷新被拒绝时不调用 finish。

`preferences::tests`：9 通过。这是原来的默认键、未分配动作、冲突、回滚、禁用模块仍可配置、重新启用后恢复注册。源码里的 Windows 默认键没有改。

`dsh-bridge --lib`：19 通过。包含原有管道 ACL、实例锁、取消和图片转换回归；`transport` 转出后这些测试仍编译。

没有跑全部 host 库测试。上述命令分别过滤掉 57、55 和 0 项。没有跑 `--smoke-test`，因为它会写 demo 数据。

## 未验证

Codex 需要做可见桌面和物理键验收。本轮没有打开窗口、托盘、WebView2 数据目录的实际效果、系统热键注册、真实命名管道客户端，或从另一个前台程序发来的全局键。快捷键结论只到 `ShortcutRegistry`。`os-hal` 的 unreachable 警告和 `mod-password-vault` 的未使用项是原有警告，这次没有改那些文件。
