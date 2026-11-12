# Cursor / Grok 4.7 High 交接 — 原生桥第二轮

工作树：`D:\Code\dsh-toolbox\.worktrees\cursor`

分支：`agent/cursor-native`
未合并 `main`。主目录 `D:\Code\dsh-toolbox` 未改。

提交：

- `38fb766` 取消只在提交前返回 `CANCELLED`，提交后返回成功；关停和父进程退出会等正在执行的写入结束。队列 16，未匹配取消 id 32。
- `549ea07` reader 到 session 的通道容量是 1。同一次读出的 request 和 cancel 仍在同一批里交给 session。session 退出时 abort 并 await 自己启动的 reader。响应写被堵住时，父进程 watch 关闭会打断这次写入，不再等管道自己掉线。
- `5461a40` 精确路径图片转换。只有读根和写根都配置时才广告 `media.convert_image`。
- 便笺原子存储是 `5461a40` 之后的下一笔提交。

## 图片转换

`mod-media-proc` 增加 `convert_image_exact` / `convert_image_exact_with`。它复用原来的编码器，不新写 codec，也不启动采集或 FFmpeg 任务。

输出先写到目标目录里的 `.dsh-<uuid>.partial`（`create_new`），编码结束并丢掉 writer 之后才 `hard_link` 到精确 `outputPath`。目标已存在时 `hard_link` 失败，不会先检查再覆盖。发布成功后删掉临时文件。取消发生在发布前时删掉临时文件并返回 `Cancelled`；发布成功之后再取消仍返回 `Completed`。

桥只在同时配置了非空读根和写根时把 `media.convert_image` 放进 `capabilities`，并把 `media_proc` 标成 available。没有根时不广告这个方法；直接调用返回 `ACCESS_DENIED`，消息是 `image conversion has no authorized read and write roots`。

路径必须是绝对路径。输入和输出父目录都先 `canonicalize`，所以 junction 和符号链接解析到根外会被拒绝。输出文件名只能是单段。已有输出，包括悬空符号链接，返回 `CONFLICT` 且不改原字节。格式只接受 `png`、`jpeg`、`webp`、`bmp`、`ico`。错误文本不带路径。

## 入站背压

`pending = 16` 只限制已经交给 session 的请求。reader 现在用 `mpsc::channel(1)`，`send().await` 会停住下一次 socket 读。通道里最多 1 批，reader 自己还可拿着正在发送的 1 批，所以在途批次数是 2。一批是一次 `read` 解出的帧；一帧最大 4MiB。压力测试在不读响应时写不进全部请求，峰值批次数不超过 2，峰值消息数不超过 `2 * (1 + 65536 / 5)`。

## 构建

```powershell
. .\scripts\Use-ProjectEnvironment.ps1
$env:CARGO_TARGET_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target'
$env:CARGO_BUILD_BUILD_DIR = 'D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\intermediates'
cargo test -p mod-media-proc -p dsh-bridge --manifest-path .\native\YourAllIn1Helper\Cargo.toml --offline --locked
cargo build -p dsh-bridge --release --manifest-path .\native\YourAllIn1Helper\Cargo.toml --offline --locked
```

Release 二进制：

`D:\Code\dsh-toolbox\.worktrees\cursor\build\rust\cursor\target\release\dsh-toolbox-native.exe`

当前 release（含便笺原子存储）SHA256：`E2F21AEBF8836BAA00B73AC6B886A4B37EEC895DA67DD1C11CE6805E2E528D72`

图片提交 `5461a40` 当时的 release SHA256：`44D813E0DD13EB30040B40691926BB81531F787F27982D309F30BF9538AD40DD`

这次 release 构建没有 `dsh-bridge` 警告。测试夹具从 `CARGO_MANIFEST_DIR` 向上找到同时含 `AGENTS.md` 和 `native/` 的项目根，再用该根下的 `.tmp`。递归删除前会确认路径是 `.tmp` 的子目录。不依赖 `.worktrees/cursor`。

## 测试

`cargo test -p dsh-bridge --lib --offline --locked`：19 通过，0 失败。包含五种格式、坏输入、已有输出字节不变、根外路径、junction、符号链接、发布前/中/后取消、临时文件清理、入站压力上限，以及 session 退出时 reader 不再读。

`cargo test -p dsh-bridge --test ipc --offline --locked`：4 通过。无读写根的真实进程不广告 `media.convert_image`，`media_proc` 仍是 available false。

`cargo test -p mod-media-proc --offline --locked`：库测试 6 通过，其中 `exact_conversion_uses_real_codecs_and_settles_cancellation` 覆盖五种格式和取消落定。`lifecycle` 1 通过。`real_ffmpeg` 里已安装 FFmpeg 的那项通过；需要 `ALL_IN_ONE_QA_MEDIA_INPUT` 的项是 ignored。桥本身没有启动采集。

`cargo test -p mod-sticky-note --offline --locked`：11 通过。原来的 10 项桌面回归仍在，新增的一项覆盖创建回滚、更新回滚、同一毫秒和时钟落后时令牌加 1，以及过期令牌不改正文。

没有读用户媒体，没有做桌面窗口或剪贴板测试。创建文件符号链接若返回 Win32 1314（没有创建符号链接的特权），该项测试接受这个结果，junction 用例仍然执行。

## 限制

canonicalize 之后再打开，同一用户仍有 TOCTOU。这不是对抗同用户的沙箱。发布只用 `hard_link`，不用 `rename`，因为 Windows 上 rename 会覆盖。`file_index` 不稳定，没有用来判断是不是同一个文件。

`TIMEOUT` 仍未使用。信封 `deny_unknown_fields` 不变。父进程 PID 复用和带 `SeTakeOwnershipPrivilege` 的管理员绕过 DACL，这两项没有扩大处理。

便笺的原子存储在图片提交之后单独修正。`create_closed_note` 在一次事务里 INSERT `is_open = 0`，不调用 `spawn_note_window`。`save_closed_content` 在同一次事务里写标题/正文、单调且不超过 JS 安全整数的 `updated_at`，并用 `expected_updated_at` 做 CAS。时钟不比旧令牌新（同一毫秒、时钟倒退，或库里的令牌已经在墙钟前面）时，新令牌是旧值加 1，不会把令牌改小。期望令牌不匹配时返回冲突，正文和令牌都不变。`create_closed_note_checking` / `save_closed_content_checking` 让测试在 COMMIT 前失败；事务回滚，不会留下半次写入。桌面的 `create_note`、`save_content`、窗口序号和关闭刷新没有改。桥的 `notes.create` / `notes.update` 改走这两个 headless 函数，不再 `create` 后再 `close`，也不再在桥里执行第二条修正令牌的 SQL。这条 headless 路径不看桌面写入会话游标。
