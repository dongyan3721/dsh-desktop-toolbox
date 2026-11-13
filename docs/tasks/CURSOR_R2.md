# Cursor 第二轮：原生边界审查与图片转换

用户已授权继续。保持 Grok 4.7 High。工作树 `D:\Code\dsh-toolbox\.worktrees\cursor`，分支 `agent/cursor-native`，第一轮提交 4476dad；先确认分支。主目录与其他工作树只读。

读取主目录最新 NEXT_PHASE_PLAN.zh-CN.md 和 BRIDGE_PROTOCOL.md Round 2 decisions。工作树的旧协议不是本轮最终依据。

修改范围扩展为本工作树 `native/YourAllIn1Helper/crates/dsh-bridge/**`、`crates/mod-media-proc/**`、必要原生 Cargo.toml 与 Cargo 生成的 Cargo.lock、docs/handoffs/CURSOR_R2.md。保持原核心/其他模块不改，必要越界请求写 handoff。允许只提交自己文件，不合并 main。

先做 A，尽早提交可集成的独立 commit；再做 B，单独提交。

A. 审查取消提交点、关停 drain、便笺更新时间令牌一致性与队列资源上限；按最新协议给取消前/提交后和有限队列补实际测试。CANCELLED 只表示未提交；提交后返回成功，退出前 flush 并等待工作停稳。保持现有真实持久化、ACL/父PID/锁测试通过。

B. 在原 mod-media-proc 提供最小公开的可等待图片转换入口，复用原处理代码，不另写编码器；接入 media.convert_image。要求精确 outputPath、已有输出拒绝、取消落定、私有同目录临时文件、无覆盖发布避免检查竞态；原生端验证实际读写根、junction/symlink、路径与格式。只在真实支持时加入 capabilities。

测至少 png/jpeg/webp/bmp/ico 中宣称支持的全部格式、坏输入、已有输出保持原字节、越界/链接路径、取消前/转换中/发布后及临时文件清理。使用D盘生成夹具，不读用户媒体或启动采集。若 Win32/文件系统边界无法可靠落实，保留 UNSUPPORTED 并明确阻碍，不弱化协议。

加载自己工作树环境并继续使用 build/rust/cursor/{target,intermediates}；运行有针对性的 cargo test --locked --offline 及 release build。若缺离线依赖可从网络下载到既有D盘Cargo缓存，勿改全局环境。交付 commit、真实测试结果、release路径/哈希、限制。现在执行。

实施期间追加：Codex 在本机对话中授权扩展到 `mod-sticky-note/src/lib.rs` 及其测试，修正便笺创建/关闭、正文/冲突令牌双次提交的崩溃窗口。以 `f38936b` 交付最小 headless 事务 API 与桥适配，保留原桌面 API 行为；11 项模块回归通过。另按集成反馈以 `549ea07` 修正入站通道背压和 reader 停稳。最终集成与包验收由 Codex 完成，见 `docs/INTEGRATION_R2.zh-CN.md`。
