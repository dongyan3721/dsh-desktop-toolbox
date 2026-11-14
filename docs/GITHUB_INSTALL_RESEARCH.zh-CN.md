# GitHub 安装机制与 Toolbox 适配研究

日期：2026-11-14。目标为本机 `E:\deepseek-harness\DeepSeek Harness.exe`，安装包内 `@deepseek-ai/dsh-plugin-manager` 为 `0.2.2-rc.3`，自带 pnpm 为 `11.28.5`。

后续实施：beta.6 已新增自包含的根 Bundle，并通过真实 GitHub commit URL 安装与运行。本研究下文保留 beta.5 当时的判断；最新支持范围与证据见 [beta.6 验收](BETA6_URL_INSTALL_ACCEPTANCE.zh-CN.md)。

## 结论

- beta.5 已能通过 **GitHub Release 安装包的 HTTPS 链接**安装，无需先手动下载。本轮在独立 D 盘 Profile 实测成功。
- 当前直接输入 **源码仓库地址**不能交付可运行的工具箱：根目录不是 DSH Bundle，Host 的构建 JS 和原生资源也不在 Git 中。
- 可以支持单个 GitHub 仓库地址安装，但需要新增发布结构；建议发布自包含的预构建安装入口，不让用户编译 Rust。
- 不采用“根 Bundle 的 dependencies 指向两个 Release URL”的轻量包装方案：本轮实测被宿主自带 pnpm 的 `blockExoticSubdeps` 拦截。

## Harness 实际做了什么

桌面插件页将输入作为安装 spec 交给 Host 的 `pluginManager`；CLI 的 `dsh plugin --profile <name> add <spec>` 则转交 pnpm。两者复用 Profile 和包管理基础设施，但 GUI 还有安装检查、日志、兼容性、启用和失败处理。

1. `parseInstallSpec()` 区分 registry、Git、tarball 和本地路径。GitHub 简写、Git URL、GitHub 仓库 URL 都属于 Git；以 `.tgz` 等后缀指向的 URL 属于 tarball。
2. GUI 的 `inspect()` 对 Git / tarball 仅识别形式与下载主机，不预先把仓库当作插件执行，也不替作者补构建产物。
3. GitHub 仓库安装前可用 `git ls-remote` 做网络预检；真正获取和安装包交给 pnpm。Git spec 支持 commit/tag 和 `path:` 子目录参数。
4. Git 依赖读取指定仓库版本的包内容。若依赖安装脚本生成入口，可能需要用户批准相应脚本。它不会因为仓库有 Releases 就自动挑选附件。
5. DSH 从包的 `dsh.bundle.patch` 识别 Bundle，检查平台和 DSH 兼容性，再把选择保存到 Profile。Patch 中的模块仍须有可解析的构建入口；安装成功不等于运行成功。
6. 是否立即启用、能否热加载和是否需要重启，由调用路径和运行状态决定。不要把 CLI 包操作、GUI 安装和实际桌面运行验收混为一谈。

本轮读取的是安装包内的 README 和编译 JS，只读提取到 `.tmp/research-github-install/installed/`，未修改 E 盘安装。

对应代码：`@deepseek-ai/dsh-plugin-manager/lib/types/install-spec.js` 的 `parseInstallSpec` / `pinnedGitOrigin`，以及 `lib/index.js` 的 `installBundle` / `runPnpm` / 构建脚本审批流程。

官方参考：[插件管理服务](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.zh.md)、[插件管理界面](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)、[pnpm 安装来源](https://pnpm.io/package-sources)。网页会随上游变化，本文行为结论以本机 rc.3 / pnpm 11.28.5 为准，不套用 pnpm 12 专属行为。

## 当前仓库的缺口

| 项目 | beta.5 状态 | 对 Git 安装的影响 |
| --- | --- | --- |
| 根 `package.json` | `dsh-toolbox-workspace` 开发工作区，没有 `dsh.bundle` | 直接安装根目录不能作为 Toolbox Bundle 启用 |
| Host | 在 `packages/dsh-toolbox`，有 Bundle / exports | 可以定位子目录，但入口依赖 `lib` 和 `resources` |
| Host 构建产物 | `lib`、`resources` 被 Git 忽略，beta.5 tag 中不存在 | 获取源码不会得到可运行的 Host 和原生程序 |
| Client | 独立包，Host 适配器重导出 `dsh-toolbox/human-entry` | 单装 Client 无法代替 Host，单装 Host 也没有侧栏入口 |
| 根构建脚本 | 复制 Host JS，不生成完整桌面发布物 | 不能仅添加一个调用现有 build 的 `prepare` 就宣称支持 |
| Release 附件 | 两个完整的预构建 `.tgz` | 可直接作为两个顶层安装 spec |

`private: true` 本身不是本文判定失败的理由。核心问题是 Bundle 声明、发布内容和双包组合。

例如，宿主能识别下面这个子目录 spec，但**目前不能据此完成产品安装**：

```text
github:dongyan3721/dsh-desktop-toolbox#9bbece198c11f419c85d2ba6cdd3731588b0dccc&path:/packages/dsh-toolbox
```

## 现在可用的安装方式

在插件页“添加插件”中，分别输入以下两个地址，并启用两个 Bundle：

```text
https://github.com/dongyan3721/dsh-desktop-toolbox/releases/download/v0.1.0-beta.5/dsh-toolbox-0.1.0-beta.5.tgz
https://github.com/dongyan3721/dsh-desktop-toolbox/releases/download/v0.1.0-beta.5/dsh-toolbox-client-0.1.0-beta.5.tgz
```

它们是 Release 安装包链接，不是 GitHub 自动生成的 Source code 归档，也不是 Release 页面链接。CLI 可以在同一次 `add` 中传入两个地址。实际用户 Profile 名应按自己的客户端确定，不照抄本轮隔离 Profile 名。

本轮实测：官方桌面 CLI 在 `.tmp/research-github-install/harness-home` 中创建 `github-release-research`，从上述两个 URL 安装成功。使用 `--ignore-scripts`；这两个发布包没有安装生命周期脚本，不需要生成构建产物。pnpm 有 peer 提示，退出码为 0，宿主依赖仍由 Harness 提供。

随后确认五个导出入口文件可解析、两个原生 exe 存在，并用实际 `dsh --profile github-release-research --dump-config` 成功组合出 `toolbox-desktop`、`toolbox-agent`、`toolbox-human-entry` 三行。未启动该 Profile 的工具箱进程或进行新一轮 GUI 验收；beta.5 原有 GUI 验收见 `BETA5_ACCEPTANCE.zh-CN.md`。

原生文件大小分别为桌面程序 36,475,904 字节、headless 程序 4,398,592 字节。下载日志和组合结果保存在 `.tmp/research-github-install/`，未接触正常用户 Profile 或私有数据库。

## 否决的轻量包装方案

本轮另造本地 fixture：根 Bundle 声明三行 Patch，两个 `dependencies` 分别指向上述 Release URL，再在独立 `github-wrapper-research` Profile 安装。

实际失败：`ERR_PNPM_EXOTIC_SUBDEP`，URL 类型依赖不能在启用 `blockExoticSubdeps` 时作为传递依赖。日志为 `.tmp/research-github-install/wrapper-install.log`。

因此不通过要求用户关闭该策略来推广这一方案。该测试验证了 URL 传递依赖限制；未把 fixture 发布到远端，也未声称已完成 Git spec 的端到端安装测试。

## 建议的后续开发

1. 设计一个自包含安装 Bundle，将 Host、Client、Patch 和 Windows x64 原生资源一起交付。开发源码仍保留现有分工，发布步骤负责装配。核对 Client half 的 exports / manifest 解析规则，保证内嵌主控台仍由正确模块加载。
2. 为 GitHub spec 提供**已包含预构建产物的版本化目录/入口**。若要求直接粘贴仓库根地址，根 manifest 必须同时成为可安装 Bundle；若接受带 `path:` 的地址，可保留根工作区结构。具体采用哪种布局在实现阶段确定，不新建分支或 worktree，不改写 beta.5 tag。
3. 对 Windows exe 入 Git 带来的仓库体积作实测评估。另一条备选路线是 Git 包用 Node `prepare` 下载固定版本、校验 SHA256、解包预构建产物；这条路线需要脚本审批、网络和失败恢复，不作为当前已经实现的能力。
4. 在 CI / 本地发布流程校验 JS、Client 和原生程序来自同一发布清单；更新版本时同步安装入口，固定 commit 可复现，不使用 `latest` 猜测附件。
5. 设计现有双包安装的升级操作，避免旧 Bundle 与新 Bundle 重复注册相同行和重复启动内核；保留用户数据及现有授权，新增授权仍默认 OFF。
6. 使用空白 D 盘 Profile，走**真正的远端 Git spec**安装，核对锁定 commit、入口、平台 / peer、三行配置和桌面表现，再测试卸载、重装、升级和失败恢复。通过后才在 README 宣布支持“一条仓库地址安装”。

若将来发布到 npm，也可让安装 Bundle 依赖两个固定的 registry 版本，避开 URL 传递依赖限制；这涉及额外发布渠道，不在本次研究中执行。

本轮只修改仓库本地 Git 提交邮箱并新增本文；没有变更产品代码、发布包或公开 Release。
