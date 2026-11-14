# beta.6 URL 安装验收

日期：2026-11-14。状态：本地完整包、旧双包切换和真实 GitHub commit URL 安装均通过。固定 tag 与 Release URL 在发布阶段继续验证。

## 构建

- 输入源码 commit：`797f0baaab55538c782ee9ee742bdf19a35a9e70`。
- 完整包 `dsh-toolbox-bundle@0.1.0-beta.6`，同时生成同版本 Host / Client 兼容安装包。历史包与 tag 未覆盖。
- 使用 `scripts/Build-Package.ps1` 构建原 Vue 界面、桌面 release 和 headless release，生成资源清单并装配完整包。原生业务代码未修改。
- 完整包 30 个运行时文件，带原生完整性清单和全部文件 SHA256。无安装脚本、无运行时依赖下载；根 Client 注册 ID 与包名一致。
- `node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs`：190 通过，其中新增装配测试 5 项。
- `node scripts/bundle-github.mjs --verify`：通过。未将 SDK、源码构建目录、工作树或测试数据库打入安装包。

## 本地安装和真实界面

目标是已安装 rc.3 的官方 CLI，pnpm 为其自带的 11.28.5。安装、缓存、Profile 和合成数据都在 `runtime/beta6-url/c659e194-293f-4449-88e3-ca1634437ec7`，无正常用户 Profile / 私有数据库读取。

1. 完整 `.tgz` 安装成功，没有传 `--ignore-scripts`，也没有添加构建白名单或放宽传递依赖策略。
2. 官方 Web 运行时启动，页面实际出现工具箱侧栏入口；点击可显示原内嵌 Vue 主控台，十模块、五个授权开关和五个“不支持 Agent”均可见。五个授权默认 OFF。
3. 从主控台打开真实原生便笺管理窗，创建一条合成便笺并保存中文标题 / 内容。新包路径下只有一个原生内核。
4. 实际 `clientModules` 服务的模块图中只有一个 `dsh-toolbox-bundle` Client，没有旧 `dsh-toolbox-client`；已安装完整包的 30 个运行时文件重新校验通过。
5. 受控 Driver 经真实服务检查五模块授权默认拒绝、Agent 工具未注册、未授权 notes.search 返回 `AGENT_ACCESS_DENIED`，然后调用宿主 `appExit(0)`。进程退出码 0，无残留原生子进程。

截图在本机 `artifacts/beta6-url/complete-bundle-console.jpg`。合成便笺持久化通过本轮独有数据库的只读校验确认，没有读取个人便笺。

桌面 Electron 的新 Profile 初始化时进入账号登录页，本轮没有操作登录，也没有把该步骤写成 Electron 界面通过。实际浏览器界面验收使用同一 rc.3 安装提供的 Web 运行时和真实 Windows 原生程序；beta.5 的 Electron 验收保留为历史证据。

## 卸载、重装和切换

- 完整包卸载前后，合成 `app.db` 的 SHA256 完全相同；重装完整包后的真实运行时 Driver 通过并正常退出。
- 旧双包切换测试在同一隔离 Profile 执行：完整包移除 → 安装冻结 beta.5 双包 → 移除两个旧包 → 安装完整 beta.6 → 核对三行各一份 → 真实运行时 Driver。通过，退出码 0；合成便笺标题和正文在切换后仍完全一致。
- 测试 Driver 为 `scripts/beta6-install-acceptance.mjs`，不进入产品安装包。首次 Driver 误用历史文档中的 `webPlugins` 服务名而处于 pending；读取 rc.3 编译实现后改为实际的 `clientModules`，后续运行通过。这是验收脚本修正，未改变产品授权或客户端代码。

## 实际 GitHub 远端验证

在全新的 `github-remote/harness-home` 和 `github-remote/pnpm-store` 中，向官方 CLI 直接传入：

```text
https://github.com/dongyan3721/dsh-desktop-toolbox#641023d0e35c521cfbc406ea56a18568eadac249
```

安装通过，pnpm 将其记录为 `github:` spec，锁文件实际下载地址为 `https://codeload.github.com/dongyan3721/dsh-desktop-toolbox/tar.gz/641023d0e35c521cfbc406ea56a18568eadac249`。没有复用本地包安装来源、忽略脚本开关、构建白名单或策略豁免。pnpm 给出宿主 peer 提示，退出码 0。

随后用实际 rc.3 Web 运行时加载该远端安装，Driver 通过：版本 beta.6、30 文件完整性通过、一个 Client、原生进程已连接、五模块默认拒绝；`appExit(0)` 后退出码 0。日志在 `github-remote/install-github.log` 与 `github-remote/acceptance-github.log`。

固定版本 tag 和单个 Release `.tgz` URL 在发布阶段继续验证，不能将上面的 commit spec 通过替代二者的证据。

## 范围

本轮验证安装布局与入口，复用 beta.5 业务源码；没有重新穷举十模块、外部翻译服务、密码本 / Windows Hello、多显示器或全部 DPI。没有模型聊天验收请求，也没有新增 Agent 授权。Git 中新增预构建二进制会增加仓库大小；这是避免用户端编译和安装脚本的交付取舍。
