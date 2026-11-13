# beta.5 Harness 内嵌主控台交接

## 交付

- 工作树：`D:\Code\dsh-toolbox\.worktrees\antigravity`
- 分支：`agent/antigravity-bridge`
- 实现提交：`723b05e` (`Embed Vue dashboard in Harness client`)
- 主控台复用原 Vue Dashboard 并挂载进 Harness 面板 Shadow DOM。挂载只读取状态，不调用 `showMain`；具体功能仍走原生窗口，页脚提供显式打开独立主窗口入口。
- 原模块卡片与人用/Agent 两种独立开关沿用 `ModuleManager`。快捷键设置保持可见，但提示并引导到原生偏好设置录入。
- 内嵌样式及主题限制在面板容器；卸载恢复容器原有主题属性/变量，不写 Harness document 根节点。

## 打包方案与 Host 配套

使用工作区 Vue/Vite 工具链编译 Dashboard 为单个 CommonJS bundle，将生成的 CSS 和 JS 内联进 `packages/dsh-toolbox-client/client.js`。没有依赖未验证的静态资源 URL；`npm pack --dry-run` 显示包只有 `README.md`、`client.js`、`cordis.patch.yml`、`index.js`、`package.json` 五个文件，bundle 为 262,984 bytes。

Client 复用 Harness Connection RPC carrier，新增客户端调用 `/api` 的 `toolbox-human/console`，并沿用现有 `toolbox-human/openPanel` 与 `toolbox-human/showMain`。Codex 仍需实现并核对 Host/native 端闭集 endpoint：`snapshot`、`setModuleEnabled`、`setAgentAccess`、`getShortcutPreferences`、`checkShortcut`、`checkAllShortcuts`、`updateShortcut`、`updateGeneral`、`openManual`。snapshot 投影要求 `target_os`、`module_catalog`、`config.general.language/theme`；修改模块/授权需返回规范目录。快捷键偏好要求 `shortcuts` 数组，批量检查要求 `checks` 数组；打开窗口端点需以 `{opened:true}` 确认。客户端不会把 Host 未接线伪装成成功，也不创建第二内核或独立 HTTP 服务。

快捷键按键录制依赖原生 WebView 焦点，内嵌端明确不可录制并提供原生主窗入口。强调色仍由原 `PreferencesPanel` 的 localStorage 管理；Harness 与 Tauri 的存储域不同，跨窗口共享强调色尚未解决。包版本及 `dsh-toolbox` peer range 仍为 beta.4，需 Codex 在配套 beta.5 集成时协调更新。

## 验证

以下命令均在指定工作树执行，并先 dot-source `scripts/Use-ProjectEnvironment.ps1`：

- `npm --prefix .\native\YourAllIn1Helper\src-ui run build`：通过（含 `vue-tsc --noEmit`）。
- `npm --prefix .\native\YourAllIn1Helper\src-ui test`：168/168 通过。
- `npm --prefix .\packages\dsh-toolbox-client run build:client`：通过，生成 262,984 bytes 的内联 Client bundle。
- `node --test .\packages\dsh-toolbox\tests\human-entry.client.test.mjs .\packages\dsh-toolbox\tests\human-console.client.test.mjs`：17/17 通过。
- `npm pack --dry-run --json --ignore-scripts .\packages\dsh-toolbox-client --cache .\.npm-cache`：通过，包清单五个文件且无外置 Dashboard 资源。
- `git diff --check`：通过。

未在 Harness `0.2.2-rc.3` 实例或真实 GUI 验收，也未测试真实系统采集、快捷键录入或安装用户 Profile。仓库可用的 Harness 前端参考/测试快照为 `0.2.2-rc.1`。需要 Codex 接通 Host/native RPC 后再做受控集成验收。
