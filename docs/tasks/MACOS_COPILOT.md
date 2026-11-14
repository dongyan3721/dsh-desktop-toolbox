# COPILOT：跨平台构建与打包审查

先阅读根 AGENTS.md、docs/MACOS_EXPLORATION.zh-CN.md 和当前契约/参考指南。当前任务覆盖旧 beta.5 所有权。

工作树：/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/copilot
分支：codex/macos-copilot

允许新增 scripts/build-desktop-macos.sh、scripts/bundle-desktop-macos.mjs、tests/macos-package.test.mjs、docs/handoffs/MACOS_COPILOT.md。交付 macOS 桌面编译/资源打包脚本，支持 darwin-arm64/x64 独立资源与 manifest（字段同旧 desktop-manifest，新增平台清晰），不覆盖 Windows manifest/distribution，不改 root manifest 和旧脚本。兼容带空格路径。可先实现无需执行全量构建的聚焦校验。Codex 执行真实编译。

可直接开始，在自己的工作树提交并写 handoff。不得修改用户选定的模型/模式，不另启CLI agent。编译缓存/临时输出在本工作树；可只读复用已安装依赖。提交保持用户邮箱2914566893@qq.com；其他 co-author 只用已核实官方邮箱。
