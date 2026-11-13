# A3 集成状态与自动回归

2026-11-13。状态：三方 A3 已合入 `integration/notes-mvp`，集成修正提交 `0c86a70`；工作树干净。**尚未完成新版本的真实 GUI/模型/发布包验收，未更新已安装 alpha.6。** main 的产品代码仍是旧预览基线；本记录不表示已将开发版发布到 main。

## 已集成

- Cursor：五项授权与配置 v6 迁移、同桌面内核便笺五动作/版本 CAS、原编辑器及画布握手、产物分块/授权代次。提交 `52d3070`、`1f98a56` 及 handoff。
- CodeBuddy：五项授权界面、双开关并发修正、原便笺编辑同步、原画布绘制/快照/清空、Markdown 渲染清洗。提交 `3d775c9`、`4f39e91`、`32d4929`、`28603aa` 及 handoff。
- Zed：五类 Agent 工具、动态授权注册/撤回、便笺固定动作、图像附件/服务生命周期、已提交结果的取消语义。提交 `1c86f05`、`f903f2f` 及 handoff。
- Codex：单一桌面服务的 access/call/subscription、受控图像读取、Bundle/Entry/导出接线、旧 headless 产品入口退役、真实 SDK 附件存储与渲染回归。历史 alpha 回归移到不随包发布的测试夹具，历史归档保留。

支持 Agent 的仍只有截图、剪贴板、屏幕注释、应用使用时长、便笺；授权默认关闭。其他五项仅供人使用。

## 合并时修正

1. 用同一准备会话的生命周期守卫释放便笺：成功读取、更新、冲突及异常均解冻；不向重新注册的新窗口错误发送旧 apply/release。
2. 原生统一将画布点与线宽从物理像素转换为逻辑像素；前端取消猜测坐标的兼容分支，防止重复缩放。
3. 控制管道将同步业务放到工作线程，同时继续消费取消/父退出/断连消息；活跃请求的取消标志传至实际 UI/业务调用，待处理队列有界。补真实异步管道“请求开始后再取消”测试；测试写半通道需显式 shutdown，已修正最初退出清理挂起的问题。
4. 不混淆全局授权快照 revision 与每模块产物授权 epoch；撤权再授权不复活旧图像，发布过程授权变化则拒绝。
5. HTML 数字实体越界不会再使便笺预览抛出 RangeError。

## 本次实际验证

| 范围 | 结果 | 限制 |
| --- | --- | --- |
| Node / SDK / 既有集成 | 173通过 | 包括真实 Loader/进程历史回归、实际 attachment-local/sharp 存储与图像内容块；新 GUI Agent 方法仍需真机验收 |
| Vue | 167通过 | 原组件逻辑、可控并发、编辑/画布握手 fixture 与安全渲染；不是 OS 点击/键盘验收 |
| Rust 桌面宿主库 | 78通过 | 合并后的权限、API、握手、分块、CAS、控制管道与在途取消 |
| Rust app-core 库 | 17通过 | 配置迁移、授权、基础内核与既有回归 |
| **合计** | **435通过，0失败** | 未宣称整个 Rust workspace 的所有测试均已运行 |

Vue `vue-tsc --noEmit && vite build` 通过。原有 os-hal/vault 编译警告保留。最终日志在集成树 `.tmp/a3-node-integrated.log`、`.tmp/a3-ui-integrated.log`、`.tmp/a3-rust-integrated-final.log`；早期被主动终止的挂起测试不是最终通过依据。

命令先点源 `scripts/Use-ProjectEnvironment.ps1`：

```powershell
node scripts/build.mjs
node --test tests/*.test.mjs packages/dsh-toolbox/tests/*.test.mjs
pnpm.cmd --dir native/YourAllIn1Helper/src-ui test
pnpm.cmd --dir native/YourAllIn1Helper/src-ui build
cargo test -p all-in-one-host -p app-core --manifest-path native/YourAllIn1Helper/Cargo.toml --lib --offline --locked -j2 -- --test-threads=1
```

## 尚未完成的门槛

1. 在新原生程序上实测人的窗口与 Agent 共享：便笺打开窗口草稿/冲突/自动保存、真实注释像素、截图、剪贴板与统计。
2. 验证五模块四种开关组合、撤权及旧调用、重启持久化、快捷键和卸载；人的功能不得依赖 Agent 授权。
3. 在已登录隔离 Electron 中确认模型真正调用工具及看见图像，完成新发布包安装/升级/卸载后才更新预览。

构建、测试与后续发布物仍限 D 盘工作区；不读取个人历史、密码或原 C 盘项目数据。H2 十模块完整人用对等与 H3 个人数据导入另有原计划，本轮通过不等于这些阶段已完成。
