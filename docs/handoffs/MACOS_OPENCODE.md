# OPENCODE：已安装 Harness 只读核实（macOS）

日期：2026-11-14。工作树：`/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/opencode`，分支 `codex/macos-opencode`。本文件是唯一提交内容，文件外证据均在 `.tmp/`、`runtime/`（均被 `.gitignore` 忽略，未提交）。

任务边界：只读核实安装的 Harness、runtime node/pnpm、CLI help、SDK 包与导出、隔离 Profile 安装与模型对话的可执行步骤。未启动 GUI，未读取 `~/.dsh` 凭据/session/数据库，未修改日常 Profile，未改用户选定模型/模式，未另启 CLI agent。所有真实桌面/采集/模型验收仍由 Codex 执行。

## 1. 安装事实

| 项目 | 值 | 证据 |
| --- | --- | --- |
| App 路径 | `/Applications/DeepSeek Harness.app` | `PlistBuddy` |
| 版本 / build | `0.2.2-rc.3` / `0.2.2-rc.3` | `Contents/Info.plist` |
| Bundle ID | `com.deepseek.dsh` | 同上 |
| 平台 | `darwin` / `arm64` | `runtime/primary-runtime/runtime.json` |
| payloadDigest | `0e843ca0dcc7ce2385777214363bab4636ed859ac77abe615949a29312fbe196` | 同上 |
| runtime node | `24.21.0`（真实二进制 `runtime/primary-runtime/dependencies/node/bin/node`，121,418,800 字节） | `node -v` |
| runtime pnpm | `11.28.5`（`dependencies/pnpm/bin/pnpm.cjs`） | `pnpm.cjs -v` |
| runtime python | `3.12.14` | `runtime.json` |
| CLI 入口 | `runtime/cli/bin/dsh`（shell 包装器，用 `ELECTRON_RUN_AS_NODE=1` 调 `Contents/MacOS/DeepSeek Harness` 执行 `app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`） | 读取包装器 |

`runtime/versions.json` 记录 `node 24.21.0`、`pnpm 11.28.5`，与 primary-runtime 一致。

## 2. CLI 事实

`sourced scripts/use-project-environment.sh` 后（`DSH_HOME=<worktree>/runtime/dsh-dev`）：

- `dsh --version` → `0.2.2-rc.3`（退出码 0）。
- `dsh --help`：顶层用法 `dsh [--profile] <name> [options] [app-args...]`、`dsh plugin --profile <name> <pnpm-args...>`；选项含 `--profile`、`--from-default-profile`、`--patch`、`--dump-config`、`--dump-config-schema`、`--dump-default-config`；示例含 `dsh web`、`dsh headless "<task>"`、`dsh tui --resume <session>`。
- `dsh plugin --help`：把剩余参数原样转发给 Profile 目录内的 pnpm（`add`、`remove`、`why` 等），首次使用会初始化 Profile。
- `dsh --profile web --dump-config`：在空白隔离 `DSH_HOME` 上成功组合并退出（1,288 行，202 个 entry），首次运行自动生成 `runtime/dsh-dev/profiles/web/`（`package.json`、`cordis.yml`、`cordis.patch.yml`、`pnpm-workspace.yaml`）。
- `dsh --profile headless --help`：`Answer one task and exit; the answer goes to stdout and diagnostics to stderr.`；选项 `--json`、`--session-id`、`--permission-mode`、`--approval-policy`、`--add-dir`。该调用已生成 `profiles/headless`（模板内容，未启动对话、未联网）。

## 3. SDK 布局与可导入性

### 3.1 实际路径

- Harness 插件运行时包：`app.asar/dsh/node_modules/@deepseek-ai/*`（asar 内部，非普通目录）。
- asar 根另有 8 个 `@deepseek-ai` 包在 `/node_modules`，属于 Electron 应用自身依赖，不是插件 SDK，勿混用。
- `app.asar.unpacked/dsh/node_modules/@deepseek-ai/` 仅含 macOS 原生载荷：`libreoffice-kit`、`libreoffice-kit-darwin-arm64`、`dsh-experimental-cua-macos`、`node-addon-system-darwin-arm64`。
- 旧 Windows 工具脚本写的 `E:/deepseek-harness/resources/app.asar/dsh/node_modules` 在本机不存在。

### 3.2 包清单（用自写只读 asar 头解析器统计，未解包全部内容）

- `dsh/node_modules/@deepseek-ai` 下 340 个 `package.json` 条目，其中 329 个版本为 `0.2.2-rc.3`。
- 非 rc.3 的 11 个：`cordis@4.1.0`、`cordis-plugin-group|include|loader@1.1.0`、`cordis-plugin-timer@1.2.0`、`cosmokit@1.9.0`、`schemastery@3.19.0`、`libreoffice-kit[-darwin-arm64]@0.2.3`、`node-addon-system[-darwin-arm64]@0.1.2`。
- 工具箱测试 `scripts/test-context.mjs` 直接 import 的 `cordis`、`cordis-plugin-loader`、`dsh-system-prompt`、`dsh-tools`、`dsh-tool-executor-native`、`dsh-subprocess-local`、`dsh-fs-local` 全部存在，均为 rc.3（cordis 4.1.0 / loader 1.1.0）。
- `@deepseek-ai/schemastery@3.19.0` 存在于 `dsh/node_modules/@deepseek-ai/schemastery/package.json`，是 rc.3 包的公共依赖。
- 工具包的 `exports.types` 指向 `lib/types/*.d.ts`，但安装物内 **0 个 `.d.ts` 文件**（统计 10,261 个 `@deepseek-ai` 文件，`.d.ts` 与 `.d.ts.map` 均为 0）。这印证 AGENTS 中“安装包不附带 TypeScript 声明”的判断；类型只能读 asar 内 `src/*.ts` 或 README。
- `@deepseek-ai/dsh-desktop-host` 的 `package.json` 无 `exports`、无 `types`，只有 `main: lib/index.js`。
- `@deepseek-ai/dsh-cli` 不存在于 rc.3 安装物（旧脚本 `inspect-harness-runtime.cjs` 的 selected 列表已过期）。

### 3.3 asar 的导入限制（实测）

1. **CJS `require` 可用**：`ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" -e "require('<asar>/dsh/node_modules/@deepseek-ai/cordis/package.json')"` → 成功（`@deepseek-ai/cordis 4.1.0`）。
2. **ESM 无法从 asar 解析**：把 `node_modules` 软链到 `app.asar/dsh/node_modules` 后，普通 node 或 Electron-as-node 执行 `import '@deepseek-ai/cordis'` 均 `ERR_MODULE_NOT_FOUND`（ESM 解析 realpath 后 stat 不到 asar 路径）。仓库测试是 ESM，因此**必须先把包实体复制出 asar**。
3. **提取后可用（已验证）**：用 Electron-as-node 的 `fs` 读 asar 复制 7 个入口包并递归依赖 → 47 个包、19 MiB 到 `.tmp/rig/node_modules`；随后：
   - `import('@deepseek-ai/cordis')`、`cordis-plugin-loader`、`dsh-tools` 成功（`Context` 为 function；两个模块分别导出 13 / 25 个符号）。
   - 最小挂载探针成功：`SystemPrompt` → `ToolsService` → `LocalFileSystem` 依次 mount，`ctx.tools.execute` 为 function，`ctx.fiber.dispose()` 正常退出。
   - 结论：用安装物自建 rc.3 SDK 快照是可行且可复现的；把快照放仓库约定的 `vendor/harness-runtime/node_modules`（`vendor/` 已 gitignore）即可让现有 ESM 测试解析。

## 4. 隔离 Profile 与插件安装

全部在 `DSH_HOME=<worktree>/runtime/dsh-dev`，未触碰 `~/.dsh`：

- `dsh plugin --profile probe add <synthetic.tgz>` → 成功，输出 `initialized profile probe at .../runtime/dsh-dev/profiles/probe`、`+ dsh-synthetic-probe 0.0.0`、`Done in 342ms using pnpm v11.28.5`。
- 合成包没有 `dsh.bundle` 时 CLI 明确警告：`declares no dsh.bundle — installed as a plain dependency, not a profile layer`（不会假装成为组合层）。
- **端口隔离问题**：不带参数时 pnpm 使用全局内容寻址仓库 `/Users/santa_antilles/Library/pnpm/store/v11`（本次因此写入了 1 个合成包，已如实记录，未清理全局仓库以免再次改动）。
- **修正已验证**：`dsh plugin --profile probe2 add <tgz> --store-dir "$PWD/.tmp/pnpm-store"` 成功，输出 `store is at .../.tmp/pnpm-store/v11`，store 与 Profile 都留在工作树内。建议 Codex 在所有隔离安装中显式传 `--store-dir`。
- Profile 目录由 CLI 生成，`profiles/node_modules` 由 dsh 维护；不要手工复制包（遵守指南第 236 行）。

## 5. 模型对话的可执行步骤（未执行）

命令形状（隔离 Profile）：

```sh
source scripts/use-project-environment.sh            # DSH_HOME=<worktree>/runtime/dsh-dev
DEEPSEEK_API_KEY=<用户授权的一次性测试值> \
  dsh --profile headless --json "<synthetic task>"   # 或 dsh --profile headless "<task>"
```

- `headless` 帮助已确认可运行；`--json` 输出逐行 run events，适合自动断言。
- 凭据来源证据：`dsh-llm-deepseek-api-key` 的 `Config.apiKeyEnv` 默认值为 `DEEPSEEK_API_KEY`（读 asar 内 `src/config.ts`），凭据按请求解析；另有 `dsh-llm-deepseek-account` 账号方式（会用用户凭据，本任务禁止触碰）。
- **未执行原因**：隔离 `DSH_HOME` 无任何凭据，真实对话需要用户授权的测试 key 或登录；读取日常 Profile/凭据被任务禁止，且运行会产生网络请求。因此本轮没有“模型对话通过”的证据，不能写成已验收。
- 建议 Codex 用一次性合成 key + 本地/受控 endpoint，或由用户显式授权后执行，并把 stdout `--json` 事件留档。

## 6. 现有脚本可移植性（给 Codex 的精确问题）

1. **`scripts/use-project-environment.sh` 让 `node` 变成坏命令**：它把 `runtime/bin` 置于 PATH 首位，该目录的 `node` 是
   `#!/bin/sh` + `exec "$DSH_DESKTOP_NODE_EXECUTABLE" ...`。普通 shell 未设该变量时，实测 `node -v` → `runtime/bin/node: line 3: exec: : not found`，退出码 127。任何依赖 PATH 中 `node` 的脚本（如 `node scripts/build.mjs`）都会失败。
   建议：脚本内 `export DSH_DESKTOP_NODE_EXECUTABLE="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"`（实测加上后 `node -v` → v24.21.0），或改用 `runtime/primary-runtime/dependencies/node/bin/node` 且不前置 `runtime/bin`。CLI 的 `dsh` 不受影响。
2. **`scripts/inspect-harness-runtime.cjs` 硬编码 Windows 路径** `E:/deepseek-harness/resources/app.asar/dsh/node_modules`，在 macOS 直接 `ENOENT`；且 selected 含 rc.3 已不存在的 `@deepseek-ai/dsh-cli`。建议 base 改为可配置（`DSH_INSTALLED_APP` 或默认 `/Applications/DeepSeek Harness.app/Contents/Resources`）。
3. **`scripts/extract-process-sdk.cjs` 有 Windows 盘符保护** `startsWith('d:\\code\\dsh-toolbox\\')`，在 macOS 必抛 `SDK destination escaped the project`；`fs.cpSync` 对 asar 目录不稳（本地实测 `cpSync` 报 `ENOENT ... lib`），需按文件 `readFileSync/writeFileSync` 递归复制（本 handoff 的 `.tmp/extract-sdk-macos.cjs` 已验证可跑）。另外 `dsh-subprocess`/`dsh-fs`/`dsh-sandbox` 在 rc.3 仍存在，但 ESM 测试实际需要的是 `-local` 变体加上 `dsh-tool-executor-native`。
4. **`packages/dsh-toolbox/tests/human-entry.sdk.test.mjs` 依赖 `vendor/harness-reference` 的 rc.1 快照**，该目录被 gitignore 且本工作树不存在；在 macOS 需先按 rc.3 重新生成，否则该测试无法运行（未运行，未验证 rc.3 兼容性）。这是上一轮 rc.1 证据不能外推到 rc.3 的具体位置。

## 7. 未验证 / 未做

- 未启动桌面 GUI、未加载 Web UI、未做真实截屏/剪贴板/快捷键/使用时长验收（Codex 独占）。
- 未运行仓库完整测试套件：缺 `node_modules`，且 `tests/prototype.test.mjs` 等依赖 Windows 原生 host，不能作为 macOS 证据。
- 未在隔离 Profile 安装 `dsh-toolbox-bundle`：工作树内 `distribution/manifest.json` 是 `0.1.0-beta.6`、原生来源为 `.exe`（Windows x64），不适用于 macOS；本轮未构建 macOS 产物。
- 未验证模型对话、未验证远端安装、未验证 telemetry/网络行为。
- 未读取 `~/.dsh` 任何凭据、session、个人数据库；也未确认日常 Profile 的模型/模式（不必要且禁止）。

## 8. 跨边界请求（Codex 决定，不擅自改）

1. 修 `scripts/use-project-environment.sh` 的 `node` 前置/`DSH_DESKTOP_NODE_EXECUTABLE`。
2. 把两个 SDK 提取脚本的平台/路径改为可配置，或提供 macOS 版；提取方式改为逐文件复制。
3. 评估是否把 `--store-dir` 写进隔离安装流程，避免污染 `~/Library/pnpm/store/v11`。
4. 由 Codex 用授权测试凭据执行一次真实 `headless` 对话，并决定 rc.3 的 `vendor/harness-reference` 快照是否重建；本 handoff 只提供方法，不声称兼容性已通过。

## 9. 复现命令（均在本工作树执行）

```sh
source scripts/use-project-environment.sh
dsh --version
dsh --help | head -40
dsh plugin --help

# 平台/版本
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "/Applications/DeepSeek Harness.app/Contents/Info.plist"
cat "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/runtime.json"

# asar 内 CJS 可用性
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  -e "console.log(require('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/cordis/package.json').version)"

# 隔离 Profile（不传 --store-dir 会写全局 store，务必带上）
dsh plugin --profile probe3 add "$PWD/.tmp/synthetic-plugin/dsh-synthetic-probe-0.0.0.tgz" --store-dir "$PWD/.tmp/pnpm-store"
dsh --profile web --dump-config | head -20

# rc.3 SDK 快照 + 可导入性（node 解析按脚本所在目录，.tmp/rig/node_modules 生效）
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" .tmp/extract-sdk-macos.cjs
node .tmp/rig/import-probe.mjs
node .tmp/rig/mount-probe.mjs
```

说明：`.tmp/extract-sdk-macos.cjs`、`.tmp/rig/*`、`.tmp/synthetic-plugin/*` 是本地验证产物（gitignore），未提交；如需长期复用应由 Codex 决定是否转成受管脚本。

## 10. 提交

- 分支 `codex/macos-opencode`，本 handoff 为唯一提交文件；提交者邮箱 `2914566893@qq.com`，未添加未核实的 co-author。
- 未合并 main、未打 tag、未发布、未安装到用户日常 Profile。