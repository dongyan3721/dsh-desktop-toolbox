# Cursor / Grok 4.7 High 交接 — A2 授权与四模块共享

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`

分支：`agent/cursor-native`

未合并 `main`。没有启动桌面，没有真实截屏、系统剪贴板写入、监听热键或安装 Profile。

## 阶段 1：配置、目录、授权

人的“开启功能”和“允许 Agent 访问”分开保存。`modules.agent_access` 缺省或缺少某个键都是 false。配置从版本 4 迁到 5 时补上空表，不改已有 `enabled`、`settings`、快捷键和未知字段。

静态支持只有 `screenshot`、`clipboard`、`screen_ink`、`app_usage`。`kernel_list_modules` 的每一项增加：

- `agent_supported`
- `agent_allowed`：支持且用户授权
- `agent_effective`：allowed 并且模块已挂载、已开启

人的命令 `kernel_set_agent_access` 只接受 `{module_id, allowed}`，返回完整目录。未知模块、不支持模块、多出来的 `actor` 都拒绝。授权可以在功能关闭时保存；关闭功能不清除授权，关闭授权不关功能，也不改 `usage_tracking`。保存失败时内存授权不变。

每次 Agent 调用走 `AppKernel::authorize_agent`。顺序是支持、是否挂载、是否开启、是否授权，对应 `UNSUPPORTED`、`UNAVAILABLE`、`MODULE_DISABLED`、`AGENT_ACCESS_DENIED`。控制管道不接受 `kernel_set_agent_access`。人的 `clipboard_list_items` 在未授权时仍然可用。

目录样例（默认新配置，功能开着、授权关着）：

```json
{"id":"clipboard","enabled":true,"agent_supported":true,"agent_allowed":false,"agent_effective":false}
{"id":"sticky_note","agent_supported":false,"agent_allowed":false,"agent_effective":false}
```

阶段 1 测试：

```powershell
. .\scripts\Use-ProjectEnvironment.ps1
$env:CARGO_TARGET_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target'
$env:CARGO_BUILD_BUILD_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\intermediates'
cargo test -p app-core --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- agent_access
cargo test -p app-core --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- test_config_migration
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 human_grant
```

`agent_access` 4 通过，旧配置迁移 1 通过，`human_grant` 2 通过。

## 阶段 2

四模块共享方法还没在这一笔里。图片传输和注释画布接线随后写在本文件。
