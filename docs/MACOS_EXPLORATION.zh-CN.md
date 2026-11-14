# macOS 解耦与兼容性探索（2026-11-14）

用户最新指令覆盖旧 Windows 派工。目标：确认独立桌面程序 0.1.4-beta 与插件 native 0.1.3-beta 的依赖边界，交付可维护方案及 macOS 实测证据。独立仓库只读；不把两棵树直接覆盖同步。新代码不等于已发布；旧 Windows beta.6、distribution 与历史归档保持原状，除非另行明确生成新测试输出。

所有协作者使用 Zed 内现有 ACP thread，保留模型/模式。每条命令和编辑用自己的绝对 worktree 路径；先 source scripts/use-project-environment.sh。不得更改 main/其他工作树/用户 Profile/凭据/个人数据库；只做合成数据和非 GUI 测试。只提交自己的指定文件，handoff 必须写 commit、命令、结果、待验证项和跨边界请求。邮箱只使用已验证身份；可在正文写 Agent 名称，不虚构 co-author。Codex 负责集成、Host、真实 GUI 和 Harness 对话验收。

建议方向待代码核实：独立桌面程序作为版本化外部伴随程序，通过私有本机 IPC 提供显式 capability 与兼容性握手；插件保留安装/配置/生命周期适配及闭集 Agent 接口。短期保留内置模式兼容，不用源码路径自动发现或全局 PATH 猜测来绑定应用，不接管正在运行的个人实例。独立程序缺少协议时明确报不兼容，不把更高 app version 当作协议兼容。

任务分配见 docs/tasks/MACOS_*.md。所有真实桌面/采集/快捷键/模型验收仅由 Codex 执行，并记录已测和未测。
