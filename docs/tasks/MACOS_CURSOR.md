# CURSOR：macOS 原生私有 IPC

先阅读根 AGENTS.md、docs/MACOS_EXPLORATION.zh-CN.md 和当前契约/参考指南。当前任务覆盖旧 beta.5 所有权。

工作树：/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/cursor
分支：codex/macos-cursor

允许 native/YourAllIn1Helper/crates/dsh-bridge/**、native/YourAllIn1Helper/src-tauri/src/plugin_host.rs、plugin_launch.rs 及必要 Cargo manifests/lock、docs/handoffs/MACOS_CURSOR.md。实现 macOS Unix domain socket 传输，保留 Windows named pipe；使用随机 instanceId/父PID、同用户端点目录0700/socket0600、peer PID/uid 验证、受控清理，不使用HTTP/任意IPC。复用长度帧/desktop protocol；watch_parent 和实例锁需要真正 macOS 实现，拒绝不受支持平台。不改 tauri_app.rs/UI/其他功能。必要时提早汇报精确 Host endpoint 格式。非GUI测试/编译，禁止启动桌面。

可直接开始，在自己的工作树提交并写 handoff。不得修改用户选定的模型/模式，不另启CLI agent。编译缓存/临时输出在本工作树；可只读复用已安装依赖。提交保持用户邮箱2914566893@qq.com；其他 co-author 只用已核实官方邮箱。
