# ZED：原生 macOS 编译与平台阻塞

先阅读根 AGENTS.md、docs/MACOS_EXPLORATION.zh-CN.md 和当前契约/参考指南。当前任务覆盖旧 beta.5 所有权。

工作树：/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/zed
分支：codex/macos-zed

允许 native/YourAllIn1Helper/src-tauri 下除 plugin_host.rs/plugin_launch.rs/Cargo* 外的 macOS 编译必要修复，native/YourAllIn1Helper/crates 下除 dsh-bridge 外的 macOS 编译必要修复，docs/handoffs/MACOS_ZED.md。核查当前 native macOS 编译缺陷和 Windows 专属功能准确降级，运行 cargo check/test（工作树本地target）。不改UI、transport、根配置；不启动GUI、不采集。不要大范围升级依赖；锁文件跨界需求给 Codex。必要数据用合成fixture。

可直接开始，在自己的工作树提交并写 handoff。不得修改用户选定的模型/模式，不另启CLI agent。编译缓存/临时输出在本工作树；可只读复用已安装依赖。提交保持用户邮箱2914566893@qq.com；其他 co-author 只用已核实官方邮箱。
