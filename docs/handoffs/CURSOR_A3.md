# Cursor / Grok 4.7 High 交接 — A3 第一阶段

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`

分支：`agent/cursor-native`

没有启动桌面，没有真实截屏、系统剪贴板、全局热键或安装 Profile。这一阶段只包含五项授权迁移和关闭状态便笺。打开编辑器握手、`agent.artifacts.read`、原画布 draw/snapshot 还没有接通，不能当成完成。

## 已实现

配置版本 6。从版本 5 升级时，如果 `agent_access.sticky_note` 曾为 true，迁移把它改回 false，并写入 `modules.agent_support_generation = 1`。缺省或 0 代不能把便笺授权算作有效。人之后调用 `kernel_set_agent_access` 才会重新打开。截图、剪贴板、屏幕注释、应用时长的已有授权不动。`media_proc` 等五项仍然不能授权。

`sticky_note` 进入静态支持名单。目录字段仍是 `agent_supported`、`agent_allowed`、`agent_effective`，默认不允许。

已广告并且只覆盖关闭、没有写入会话的便笺：

- `agent.notes.search` `{query?,limit?,offset?}`：查询最多 200 个 Unicode scalar，limit 1..20，offset 0..10000。返回 id、标题、最多 120 字预览、`updated_at` 和窗口状态，不返回正文。
- `agent.notes.read` `{id}`：id 1..80 个非控制字符。正文超过 256KiB UTF-8 返回 `INVALID_REQUEST`，不截断。
- `agent.notes.create` `{title,content_md?}`：标题 1..500 scalar，默认关闭，只插入一次。
- `agent.notes.update` `{id,expected_updated_at,title?,content_md?}`：至少一个变更字段。安全整数 CAS。冲突码 `CONFLICT`，不覆盖。成功后轮换写入会话，旧的无会话自动保存不再落盘。响应 `display_sync:"closed"`。
- `agent.notes.open` `{id}`：已打开则只聚焦，不改冲突令牌；关闭的便笺打开一次。

便笺正打开，或已有写入会话时，read/update 返回 `UNAVAILABLE`，文案是 open note editor is not synchronized yet。这是故意拒绝，不是已同步。

## 测试

```powershell
. .\scripts\Use-ProjectEnvironment.ps1
$env:CARGO_TARGET_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target'
$env:CARGO_BUILD_BUILD_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\intermediates'
cargo test -p app-core --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- agent_access test_config_migration
cargo test -p all-in-one-host --manifest-path .\native\YourAllIn1Helper\Cargo.toml --lib --offline --locked -j2 -- --test-threads=1 agent_api human_grant
```

app-core 5 通过。宿主 `agent_api` 与 `human_grant` 共 9 通过。

## 下一阶段才算接通

`toolbox_agent_ui_ready` / `toolbox_agent_ui_result`、`sticky://agent-command`、`screen-ink://agent-command`、图像分块和提交后取消语义都还没改。`agent.ink.draw` 与 `agent.ink.snapshot` 仍不广告。
