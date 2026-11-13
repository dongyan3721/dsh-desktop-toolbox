# beta.3：DSH rc.3 安装声明更新

日期：2026-11-14。用户报告 DSH `0.2.2-rc.3` 拒绝安装 beta.2，并明确要求只修改声明，新版运行兼容性由用户验证。

- Host 与 Client 同步升级为 `0.1.0-beta.3`，Client 对 Host 的版本依赖同步更新。
- Host 的 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-subprocess`、`@deepseek-ai/dsh-sandbox` peer 范围均改为 `0.2.2-rc.1 || 0.2.2-rc.3`。
- Cordis、Schemastery 等其他依赖声明保持原值。
- 复用 beta.2 的 JS 和两份原生 exe；不重新编译原生代码。完整性清单更新包版本及 Harness 声明范围，保留原生源码 revision 和 exe SHA-256。
- 仅进行打包内容、版本/依赖声明和载荷一致性检查；不安装到任何 Profile，不启动 Harness，不执行 rc.3 运行兼容测试。原 beta.2 的验收结果仍只对应其实际测试环境。
- beta.2 及此前归档保留，新包在 D 盘工作区 `dist/` 生成。
- 打包器同时带入仓库此前已添加的 MIT `LICENSE` 文件；其内容与仓库原文件核对一致。

交付文件：

```text
dist/dsh-toolbox-0.1.0-beta.3.tgz
dist/dsh-toolbox-client-0.1.0-beta.3.tgz
dist/dsh-toolbox-0.1.0-beta.3.manifest.json
```

导入时使用同版本的 Host 和 Client 两个包。声明允许安装不等于已确认 rc.3 的运行兼容性。
