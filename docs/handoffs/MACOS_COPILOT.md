# Copilot macOS 构建/打包交接

- 工作树：`/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/copilot`
- 分支：`codex/macos-copilot`
- 代码提交：`de5f0d4` (`build: add isolated macOS desktop packaging`)

## 变更

- `scripts/build-desktop-macos.sh` 提供 `darwin-arm64` 和 `darwin-x64` 构建入口，UI、Cargo release 目标及中间产物均按架构隔离在工作树内；参数和路径均加引号，可处理带空格路径。构建要求 macOS，且拒绝未提交的 native/frontend 源码。
- `scripts/bundle-desktop-macos.mjs` 输出到 `packages/dsh-toolbox/resources/darwin-arm64/` 或 `darwin-x64/`，分别写入无扩展名 `all-in-one-desktop` 和 `desktop-manifest.json`。manifest 保留旧 desktop 字段，标记 `platform: darwin` 及对应 `architecture`，写入源码 revision 和二进制 SHA-256。不会写 Windows manifest 或资源。
- `tests/macos-package.test.mjs` 使用合成可执行文件验证两个架构并存、哈希/manifest、可执行权限、空格路径、Windows 资源不变及无效输入拒绝。

## 验证

命令均在指定工作树执行，并先加载项目环境：

```sh
cd /Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/copilot && source scripts/use-project-environment.sh && /opt/homebrew/bin/node --test tests/macos-package.test.mjs
```

结果：3 项通过，0 失败。

```sh
cd /Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/copilot && source scripts/use-project-environment.sh && bash -n scripts/build-desktop-macos.sh && git diff --check
```

结果：通过。另以不支持的架构参数调用构建脚本，确认退出码为 2 并显示用法。

未运行 UI/Cargo 全量编译、未生成真实 macOS 二进制，也未做 GUI 验收；依派工由 Codex 执行。测试只使用合成文件。

## 集成注意事项

当前 `packages/dsh-toolbox/package.json` 和根 `package.json` 仍声明仅支持 `win32`/`x64`；本任务按范围未改这些 manifest。Codex 集成 macOS 资源前需处理对应平台声明，并确认根打包流程会纳入架构目录中的二进制和 manifest。历史 Windows manifest、distribution 与旧构建脚本未改动。
