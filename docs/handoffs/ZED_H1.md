# Zed H0/H1 交接：Harness 人用可见入口与 Host adapter

日期：2026-11-13
工作树：`D:\Code\dsh-toolbox\.worktrees\zed`
分支：`agent/zed-features`
同步基线：`e02ae29`
模型：保持 Claude Code ACP / 自定义 DeepSeek Flash，未切换。
本轮未启动 GUI、未发送全局键、未安装到用户 Profile、未修改 E 盘安装或主目录。

## 结论

实际安装的 Harness `0.2.2-rc.1` 支持外部人用可见入口。实现路径不是 Tool、聊天斜杠命令或 CLI，而是：

1. 外部 Package 声明 `dsh.client` 并导出 `./client` 浏览器 bundle；
2. 作为启用的 Cordis Loader Entry 装入 Profile；
3. `@deepseek-ai/dsh-client-modules` 扫描 Entry，把 bundle 提供给 Web/Desktop 前端；
4. bundle 通过 `ctx.slots.inject/register` 注册 `sidebar.panellist` 项和同名 `main` 面板；
5. 点击左侧可见“工具箱”后，面板通过通用 Connection RPC 调用 Host adapter，再由 adapter 调用 Codex 提供的 `toolboxDesktop` 服务打开原桌面窗口。

详细只读证据与调用形状见 **`docs/HARNESS_HUMAN_ENTRY.zh-CN.md`**。

## 变更文件

新增，均在任务范围：

- `docs/HARNESS_HUMAN_ENTRY.zh-CN.md`
- `packages/dsh-toolbox-client/package.json`
- `packages/dsh-toolbox-client/index.js`
- `packages/dsh-toolbox-client/client.js`
- `packages/dsh-toolbox-client/cordis.patch.yml`
- `packages/dsh-toolbox-client/README.md`
- `packages/dsh-toolbox/src/human-entry/host.js`
- `packages/dsh-toolbox/tests/human-entry.host.test.mjs`
- `packages/dsh-toolbox/tests/human-entry.client.test.mjs`

未修改：主插件入口 `src/index.js`、tool factory、bridge、Rust、src-ui、根 manifest/lock、主包 `exports`/Bundle、其他 agent 文件。

## 实际实现

### 可见入口（Client）

`packages/dsh-toolbox-client`：

- `package.json`：`dsh.client.platform = "web"`、`exports["./client"] = "./client.js"`、`dsh.bundle.patch = "./cordis.patch.yml"`。
- `client.js`：与已安装 first-party bundle 相同的 `window.__ModuleLoader__.load({ id, factory })` 形式；导出 `apply`、`inject = ["slots","connection"]`。
- `apply(ctx)`：
  - `ctx.slots.inject("main", () => ctx.slots.register({ name:"main", key:"toolbox", inject: () => ({ connection }) }, ToolboxPanel))`
  - `ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name:"sidebar.panellist", id:"toolbox", order:0, label:"工具箱" }, ToolboxIcon))`
- 选中主面板时自动调用 `showMain`；不发送模型请求、不注册工具。
- 面板显示打开状态、稳定错误码与重试按钮；错误显示已去除控制字符并限长。

### Host adapter

`packages/dsh-toolbox/src/human-entry/host.js`：

- 导出 `name = "dsh-toolbox-human-entry"`、`inject = ["connection"]`、`HUMAN_ENTRY_CHANNEL = "/toolbox-human"`。
- 通过 `ctx.connection.rpc.handle(channel, handler)` 注册通用 RPC；注册由 `ctx.effect` 持有并随插件卸载释放。
- 只接受三个 endpoint：
  - `status` → `toolboxDesktop.status(signal)`
  - `showMain` → `toolboxDesktop.showMain({ signal })`
  - `openPanel` → `toolboxDesktop.openPanel(moduleId, { signal })`
- 输入严格校验：空对象、`moduleId` 1..80 Unicode scalar、无孤立 surrogate、无 C0 控制符、拒绝未知字段。
- 服务缺失返回 `DEPENDENCY_MISSING`；方法缺失/未知 endpoint 返回 `UNSUPPORTED`；输入错误返回 `INVALID_REQUEST`；取消返回 `CANCELLED`；稳定服务错误码原样保留；未知错误码归一为 `INTERNAL` 且不泄漏原始消息。
- `showMain`/`openPanel` 必须返回 `{ opened: true }`；结果经 JSON round-trip 净化。
- Host adapter 是可选消费方：`toolboxDesktop` 不存在时 channel 仍可注册并明确失败，不伪造成功。

## 实际命令与结果

安装物只读核实：

```powershell
E:\deepseek-harness\resources\runtime\cli\bin\dsh.cmd --version
# 0.2.2-rc.1

E:\deepseek-harness\resources\runtime\cli\bin\dsh.cmd --help
E:\deepseek-harness\resources\runtime\cli\bin\dsh.cmd plugin --help
```

使用临时 `DSH_HOME=D:\Code\dsh-toolbox\.worktrees\zed\.tmp\h1-home` 转储默认 Web 配置（未启动 App、未访问用户 Profile）：

```powershell
dsh --profile web --dump-default-config > .tmp\web-default-config.yml
```

确认 `dsh-client-modules`、`dsh-client-ui-sidebar`、`dsh-client-ui-plugin-manager` 等均为 Loader Entry；桌面 `lib/main.js` 使用 `$DSH_HOME/profiles/desktop`，首次创建基于 Web Profile bundles。

自动测试（工作树内）：

```powershell
powershell.exe -NoProfile -Command ". 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'; Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed'; node --test packages/dsh-toolbox/tests/human-entry*.test.mjs"
```

结果：19 tests / 19 pass / 0 fail。

包内回归：

```powershell
node --test packages/dsh-toolbox/tests/*.test.mjs
```

结果：98 tests / 98 pass / 0 fail（包含 bridge、features 与 human-entry）。

语法与包形状：

```powershell
node --check packages/dsh-toolbox-client/client.js
node --check packages/dsh-toolbox-client/index.js
node --check packages/dsh-toolbox/src/human-entry/host.js

Set-Location packages/dsh-toolbox-client
npm pack --dry-run --json
```

`npm pack --dry-run` 列出 5 个文件：`README.md`、`client.js`、`cordis.patch.yml`、`index.js`、`package.json`，约 3.2 KB tgz。未生成发布包、未发布、未安装。

## 需要 Codex 完成的跨边界改动

> 截至本补充，第 1、2 项已由 Codex 在 integration 分支完成；以下保留为装配约束和验收依据。

1. **主包子路径导出**：`packages/dsh-toolbox-client/index.js` 重新导出 `dsh-toolbox/human-entry`。请给 `packages/dsh-toolbox/package.json` 增加：
   ```json
   "./human-entry": "./lib/human-entry/host.js"
   ```
   现有 `scripts/build.mjs` 递归复制 `src/` 到 `lib/`，因此构建后会存在该文件；请在实际构建后确认。
2. **提供 `toolboxDesktop` 服务**：按 H1_CONTRACT 实现 `status(signal?)`、`showMain({signal}?)`、`openPanel(moduleId,{signal}?)`，并保证返回/错误净化。adapter 以 `ctx.get("toolboxDesktop")` 可选消费。
3. **安装与 Profile 装配**：将 `dsh-toolbox-client` 作为 Bundle 安装到桌面 Profile；其 `cordis.patch.yml` 插入 `toolbox-human-entry`。当前桌面 Profile 为 `$DSH_HOME/profiles/desktop`；不要手工改用户 Profile，由集成流程完成。
4. **真实 GUI 验收**：Codex 需实际启动 Desktop、点击左侧“工具箱”、确认 Tauri 主窗口打开、关闭/重开、重启、卸载后入口消失。Zed 未做这些。
5. **Client bundle 构建方式**：当前安装物没有可独立调用的公共 Client build preset；本分支 bundle 按已安装 first-party bundle 的实际 `window.__ModuleLoader__.load` 形状手写。若真实 loader 拒绝，请用仓库共享 Client 构建预设重新产出同一 `./client` 导出；不要降低为 Tool/CLI/斜杠入口。
6. **发布元数据**：client 包当前 `private: true` 仅用于本地集成；Codex 决定最终包名/版本/发布方式。`npm pack --dry-run` 可正常出包。

## 未测/限制

- 未启动 GUI、未点击 Harness、未验证视觉/焦点/键盘、未发送全局键。
- 未把包安装到真实桌面 Profile，未验证 `dsh-client-modules` 对**本包** bundle 的扫描/服务/执行。
- 本工作树未连接真实 `toolboxDesktop`；Host adapter 的 service 仍以 fake 测试，实际服务由 Codex 在 integration 提供。
- 未验证 Tauri 主窗口、偏好面板、快捷键、单实例、卸载清理。
- 未新增或修改任何模型 Tool，未用聊天/CLI/控制台命令冒充人的可见入口。

## 入口收口补充（第二轮）

提交基线：`b3a6592`；本补充提交见分支最新提交。

### 实际 SDK 核对

- 读取了实际安装版本的 `@deepseek-ai/dsh-client-connection` Node/browser Client 实现（`vendor/harness-reference/.../lib/client.node.js`、`lib/client.browser.js`）。
- 确认 generic RPC 的真实层级：
  - Client `connection.rpc.call(channel, endpoint, payload, signal)` 生成 `{type:"client-request", rpcId, method, payload}`。
  - Host handler 返回 `{ok:true,value}` / `{ok:false,error:{code,message,details}}`；Client 校验 `server-response`、`rpcId`、成功/失败两支和 `details` 对象。
  - 错误层不会把失败当成功；rpcId 不匹配会拒绝。
- Client slots：实际 `dsh-client-ui-sidebar/lib/client.js` 声明 `sidebar.panellist` 为 root-scoped list，并实际使用 `ctx.slots.inject(..., () => ctx.slots.register(...))`；本分支的注册形状与之一致。`main` keyed 注册形状来自安装物 `dsh-client-ui-plugin-manager/lib/client.js` 的实际代码；该 bundle 不在当前 vendor 参考快照中，故测试只对 sidebar 实际 bundle 做源码形状断言，另用 deferred slot 测试验证本入口在 declaration 前不提前注册。
- `dsh-client-ui-slots` 本身是宿主前端 shell 内部模块，安装物没有可独立导入的公共包；本轮没有伪造一个“真实 slots SDK”测试。

新增 `packages/dsh-toolbox/tests/human-entry.sdk.test.mjs`，直接导入实际 `client.node.js` 的 `installConnection`，只替换 HTTP carrier。测试覆盖：
- 实际 SDK envelope 成功传递到本入口的 `callHumanEntry`。
- 实际 SDK 返回结构化失败 envelope。
- `OUTCOME_UNKNOWN` + `causeCode` 穿过实际 SDK 进入程序 Error 对象。
- 实际 SDK 拒绝错误 `rpcId`，不会当作成功。

### 人用错误显示

- 正常面板只显示简洁中文和可操作建议；不显示协议 code、英文 message、堆栈。
- 删除“本页面不发起模型请求”等开发说明。
- 异常状态保存原始 `Error` 对象（`code`/`message`/`details`）供调试；UI 只按 code 映射友好文案。
- 只有 Host adapter 确认 `opened:true` 后才显示“桌面工具箱已打开。”；`{opened:false}` 或异常显示错误，不谎称已打开。

### Host stable code

显式保留以下 code，不再落入 `INTERNAL`：
`OUTCOME_UNKNOWN`、`NATIVE_UNAVAILABLE`、`NATIVE_START_FAILED`、`NATIVE_START_TIMEOUT`、`NATIVE_INTEGRITY`、`DESKTOP_PROTOCOL`、`DESKTOP_CAPABILITIES`、`DESKTOP_SHUTDOWN_FAILED`。

`OUTCOME_UNKNOWN` 的 `causeCode` 经白名单格式校验后放入 `error.details.causeCode`，再由客户端写入调试 Error 对象。

### 测试结果

```powershell
powershell.exe -NoProfile -Command ". 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'; Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed'; node --test packages/dsh-toolbox/tests/human-entry*.test.mjs"
```

结果：29 tests / 29 pass / 0 fail。

```powershell
node --test packages/dsh-toolbox/tests/*.test.mjs
```

结果：108 tests / 108 pass / 0 fail。

### 当前集成状态与未测

- Codex 已在 integration 分支增加主包 `./desktop`、`./human-entry` 子路径导出，并提供无 tools 依赖的 `toolboxDesktop` 服务；本工作树未包含这些 integration 文件，本轮未修改它们。
- 未连接真实 `toolboxDesktop`/desktop runtime；SDK 集成测试的 Host service 仍是 fake。真实 desktop service、Tauri 窗口、GUI 点击、焦点、快捷键和卸载清理仍由 Codex 验收。
- 未启动 GUI、未改个人 Profile、未发送全局键。
