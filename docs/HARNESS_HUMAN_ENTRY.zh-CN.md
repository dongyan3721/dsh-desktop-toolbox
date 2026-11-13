# 实际 Harness 0.2.2-rc.1 人用可见入口核实

日期：2026-11-13
核实者：Zed（只读检查 E 盘安装，未启动 GUI）
工作树：`D:\Code\dsh-toolbox\.worktrees\zed`

## 1. 结论

实际安装的 DeepSeek Harness `0.2.2-rc.1` **存在可外部安装、无需聊天/模型/工具/控制台命令的人用可见入口**：

- 外部 npm Package 只要被装入 Profile 并成为启用的 Cordis Loader Entry，同时在 `package.json` 声明 `dsh.client` 并导出 `./client` 浏览器 bundle，Host 的 `@deepseek-ai/dsh-client-modules` 会扫描该 Entry 并向浏览器提供 bundle。
- 浏览器 bundle 通过 Client 插件的 `ctx.slots.inject(...)` 注册到公开的 `sidebar.panellist` 列表槽和 `main` keyed 槽；左侧导航会渲染图标与可见标签，点击后选中同名主面板。这是本仓库实际使用的可见入口，不是侧边栏假想 API。
- 桌面版使用同一个 Web 前端与 Web Profile 组合（`$DSH_HOME/profiles/desktop`），并且自带 Plugins 管理界面；安装入口是设置中的 Plugins 页面或 `dsh plugin --profile desktop add <spec>` 的等价流程。
- Host 与浏览器之间的自定义人用控制可以通过 `ctx.connection.rpc` 的通用 RPC 通道完成，不需要修改 `dsh-api-remotes` 的编译期能力白名单，也不需要 Typert 代码生成。

因此可以实施最小可见入口；真实点击/窗口/快捷键验收仍由 Codex 完成（本轮不启动 GUI、不发送全局键）。

## 2. 安装事实与只读证据

### 2.1 版本与桌面 Profile

- `E:\deepseek-harness\resources\runtime\primary-runtime\runtime.json`：`desktopVersion: "0.2.2-rc.1"`、`node: "24.21.0"`、`pnpm: "11.28.5"`。
- `E:\deepseek-harness\resources\runtime\cli\bin\dsh.cmd --version`：`0.2.2-rc.1`。
- `app.asar/lib/main.js` 的 `resolveDesktopPaths()` 使用：
  - `profile: join(dshHome, "profiles", "desktop")`
  - Profile 首次创建调用 `createPluginProfile(projectDir)` → `initProfile(projectDir, WEB_PROFILE.bundles)`，即桌面插件 Profile 基于 Web Profile bundles。
- `app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js` 的 `main()` 调用 `loadProfileDirectory("dsh", projectDir, installAnchor)`，再以 `profile: "desktop"`、`--no-open --host 127.0.0.1 --port 0` 运行 Web 应用。
- 结论：桌面版不是另一套无法扩展的前端；它运行 Web 客户端与外部插件 Profile。

### 2.2 外部 Client bundle 的装载路径

`app.asar/dsh/node_modules/@deepseek-ai/dsh-client-modules/package.json`：

```json
"dsh": { "client": { "platform": "web", "inject": [], "immediately": true } }
```

其 README 与 `lib/index.js` 明确：

- Host 半扫描**启用的 Loader Entry** 对应包 manifest；`resolveMeta()` 读取 `pkg.dsh.client`，要求 `platform === "web"`，并用 `clientExportOf()` 读取 `pkg.exports["./client"]`（字符串，或带 `default` 字符串的对象）。
- 缺失 `./client` 导出会报错；bundle 必须已经构建。Host 通过 `/plugins` 组合 URL 提供资源。
- 浏览器半消费 `window.__ModuleLoader__.load({ id, factory })` 注册的 factory；factory 执行后返回包导出。首次物化时才运行模块体。
- 静态平台模块表包含 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives` 等；`dsh.client.external` 只用于非基线模块请求。
- 外部包必须自行产出同样的 bundle 形式；当前安装物内没有独立的公共 `client build preset` 包，因此本分支采用与现有 bundle 相同的最小 `window.__ModuleLoader__.load` 手写形式。该形式能否被真实桌面加载需 Codex 在 GUI 中验收。

### 2.3 可见侧边栏入口的实际调用形状

`app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/package.json` 声明：

```json
"dsh": {
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-api-workspace-controller",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-layout",
      "@deepseek-ai/dsh-client-ui-session",
      "@deepseek-ai/dsh-client-ui-workspace",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-shortcuts"
    ]
  }
}
```

`dsh-client-ui-sidebar/README.md` 的 “Global panel entries” 明确：

- 插件向 root-scoped `sidebar.panellist` 列表添加 `{ id, order?, label }` 图标组件；
- 同一个 `id` 指向布局 root-scoped `main` keyed slot 中的组件；
- `label` 作为可见文本、可访问名称和折叠 tooltip；
- 点击面板行由 sidebar 调用 `ctx.layout.selectPanel(id)`。

`dsh-client-ui-sidebar/lib/client.js` 的 `apply(ctx)` 实际声明：

```js
children: {
  "sidebar.panellist": { kind: "list", scope: "root" },
  ...
}
```

`dsh-client-ui-plugin-manager/lib/client.js` 给出真实注册示例：

```js
yield ctx.slots.inject("main", function* () {
  // ...
  yield ctx.slots.register({
    name: "main",
    key: PANEL_ID,
    locale: NS,
    // store/inject/children 视页面需要
  }, PluginManagerPage);
  // ...
});

yield ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
  name: "sidebar.panellist",
  id: PANEL_ID,
  order: 0,
  label: () => t("panel"),
  locale: NS
}, PluginsPanelIcon));
```

这证明最小实现所需形状是：

- 侧边栏：`ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name, id, order?, label }, Icon))`
- 主面板：`ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: id, inject: () => props }, Panel))`
- Client 插件导出 `apply` 与 `inject`（服务名数组）；本分支使用 `["slots", "connection"]`。

### 2.4 Host 到 Client 的自定义人用 RPC

`app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/README.md` 明确提供 generic RPC；`lib/index.js` 与 `lib/client.browser.js` 的实际形状：

Host：

```js
const connection = ctx.get("connection");
connection.rpc.handle("/toolbox-human", async (endpoint, payload, signal, peer) => {
  // 返回 { ok: true, value } 或 { ok: false, error: { code, message, details } }
});
```

Client：

```js
const result = await ctx.connection.rpc.call("/toolbox-human", "showMain", {}, signal);
// result = { ok: true, value } | { ok: false, error: { code, message, details } }
```

- Channel 必须匹配 `/^\/[A-Za-z0-9._~-]+$/`，且不能是保留的 `/api`。
- endpoint 段匹配 `/^[A-Za-z0-9_$.-]+$/`。
- Host handler 返回 JSON-safe 的 `RemoteResult`；客户端会校验 `rpcId`、response envelope 和错误字段。
- 该通道是已安装 Connection 服务的一部分，不要求修改 `dsh-api-remotes` 的编译期 Remote 能力白名单，也不要求 Typert 代码生成。

## 3. 本分支采用的最小实现

### 3.1 可见入口

- `packages/dsh-toolbox-client/`：外部 Client Package。
  - `package.json` 声明 `dsh.client.platform = "web"`、`exports["./client"]`，并提供 Host 半 entry。
  - `client.js` 使用 `window.__ModuleLoader__.load({ id: "dsh-toolbox-client", factory })`，factory 导出 `apply` / `inject`。
  - 注册 `sidebar.panellist` 项 `id: "toolbox"` 与 `main` keyed 面板 `key: "toolbox"`。
  - 选中面板时自动调用 Host adapter 的 `showMain`，显示打开状态与重试按钮；不发送任何模型请求。

### 3.2 Host adapter

- `packages/dsh-toolbox/src/human-entry/host.js`：可选消费 `ctx.get("toolboxDesktop")`，注册 `/toolbox-human` 通道。
  - `status` → `toolboxDesktop.status(signal)`
  - `showMain` → `toolboxDesktop.showMain({ signal })`
  - `openPanel` → `toolboxDesktop.openPanel(moduleId, { signal })`
  - 服务缺失返回 `DEPENDENCY_MISSING`；输入错误返回 `INVALID_REQUEST`；未知 endpoint 返回 `UNSUPPORTED`；取消返回 `CANCELLED`；其他错误净化后返回稳定 code 或 `INTERNAL`。
- 该服务是 H1_CONTRACT 的 proposed API；Codex 已在 integration 分支提供 `toolboxDesktop` 服务。本工作树未包含该 desktop runtime，因此只验证 adapter 的接口消费和错误映射，不声称真实桌面调用成功。

### 3.3 Bundle / 装配请求（Codex 负责）

本分支不修改根 manifest、主包 `exports` 或 Profile。Codex 需要：

1. 在 `packages/dsh-toolbox/package.json` 增加 `./human-entry` 子路径导出（指向构建后的 `lib/human-entry/host.js`），或由主入口直接导入该模块。
2. 在 `packages/dsh-toolbox-client/package.json` 中保持 `dsh.client` 与 `./client`；打包时确保 `client.js`、`index.js`、`cordis.patch.yml`、`README.md` 进入 tarball。
3. 将 `dsh-toolbox-client` 及其 Bundle patch 安装/插入桌面 Profile；当前桌面 Profile 是 `$DSH_HOME/profiles/desktop`。
4. 提供 `toolboxDesktop` 服务并完成真实 Tauri 窗口/面板调用；提供 Host 启动与卸载顺序。
5. 在真实 GUI 中点击侧边栏“工具箱”，验证主面板出现、Tauri 主窗口打开、关闭/重开、卸载后入口消失。

## 4. 未验证与阻碍

- 本轮**没有启动 GUI、没有点击 Harness、没有发送全局键**；真实可见性、菜单渲染、侧边栏点击、Tauri 窗口、焦点和快捷键均未由 Zed 验收。
- 未在真实桌面 Profile 中安装或启用 `dsh-toolbox-client`；Profile 写入由 Codex 负责。
- 当前安装物未提供可独立调用的公共 Client build preset；手写 bundle 的结构来自已安装 first-party bundle 的实际形状，仍需真实加载验证。若 loader 拒绝手写 bundle，Codex 可用仓库内共享 Client 构建预设重新产出同一 `./client` 导出。
- 本工作树未包含 integration 分支的 `toolboxDesktop`；实际 desktop service 调用由 Codex 验收。本轮使用**实际安装的 `@deepseek-ai/dsh-client-connection` Node Client** 验证 generic RPC envelope/错误层，service 本身仍为 fake。
- 没有用 Tool、聊天斜杠命令、CLI 或控制台命令替代人的可见入口。若真实 GUI 验证失败，应报告入口未完成，而不是降低验收标准。

## 5. 本分支实际文件与自动验证

- `packages/dsh-toolbox-client/package.json`：`dsh.client.platform = "web"`、`exports["./client"] = "./client.js"`、`dsh.bundle.patch = "./cordis.patch.yml"`。
- `packages/dsh-toolbox-client/client.js`：手写 lazy-CJS bundle；`window.__ModuleLoader__.load` 注册 `dsh-toolbox-client`，导出 `apply`/`inject`；注册 `sidebar.panellist` 和 `main` 的 `toolbox` 同 id。
- `packages/dsh-toolbox-client/index.js`：Host 半 entry；重新导出 `dsh-toolbox/human-entry` 的 `apply`/`inject`（该子路径导出由 Codex 增加）。
- `packages/dsh-toolbox-client/cordis.patch.yml`：插入 `toolbox-human-entry` Loader Entry。
- `packages/dsh-toolbox/src/human-entry/host.js`：`/toolbox-human` 通用 RPC adapter；`status`/`showMain`/`openPanel`；显式保留 `OUTCOME_UNKNOWN`、`NATIVE_UNAVAILABLE`、`NATIVE_START_FAILED`、`NATIVE_START_TIMEOUT`、`NATIVE_INTEGRITY`、`DESKTOP_PROTOCOL`、`DESKTOP_CAPABILITIES`、`DESKTOP_SHUTDOWN_FAILED`；`causeCode` 进入 debug details。
- `packages/dsh-toolbox/tests/human-entry.host.test.mjs`、`human-entry.client.test.mjs`、`human-entry.sdk.test.mjs`：入口/adapter 测试 + 实际 Connection SDK 集成测试。
- 可见错误只显示简洁中文和可操作建议；内部 code、英文 message、堆栈不进入正常界面，调试信息保留在 Error 对象的 `code`/`message`/`details`。

自动验证命令（工作树内）：

```powershell
powershell.exe -NoProfile -Command ". 'D:\Code\dsh-toolbox\.worktrees\zed\scripts\Use-ProjectEnvironment.ps1'; Set-Location 'D:\Code\dsh-toolbox\.worktrees\zed'; node --test packages/dsh-toolbox/tests/human-entry*.test.mjs"
```

结果：29 项通过（包含实际 `@deepseek-ai/dsh-client-connection` Node Client 的 envelope/rpcId/错误层测试）。随后运行 `node --test packages/dsh-toolbox/tests/*.test.mjs`：108 项通过、0 失败。`npm pack --dry-run --json` 在 client 包内列出 `README.md`、`client.js`、`cordis.patch.yml`、`index.js`、`package.json` 五个文件（约 3.2 KB tgz）。

这些是源码/包形状、实际 SDK Connection 与 fake desktop service 的自动测试，不是 GUI 验收。
