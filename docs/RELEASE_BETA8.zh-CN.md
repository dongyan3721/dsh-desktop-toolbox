一个版本、一个安装包，同时支持 Windows x64 与 macOS Apple Silicon（arm64）。双方都使用 DeepSeek Harness 0.2.2-rc.3 / Node 24。

在 Harness「插件 → 添加插件」粘贴同一个地址：
```
https://github.com/dongyan3721/dsh-desktop-toolbox#v0.1.0-beta.8
```
或使用本页同一个 `dsh-toolbox-bundle-0.1.0-beta.8.tgz` 下载 URL。

本版修复 beta.7 只装配 macOS 资源的问题。JavaScript Host / Client 不再设置 os/cpu 安装过滤，完整包同时包含 Windows exe 和 macOS app，运行时按系统选择并校验对应程序。两项原生资源缺一即拒绝打包，Windows 构建也检查 PE 架构，避免只改安装声明却遗漏 Windows 程序。

保留原生主控台、便笺及屏幕标注等窗口。截图、剪贴板、屏幕注释、便笺、应用使用时长均须由用户单独授权给 Agent，默认全部关闭。关闭模块或撤权会阻止旧工具继续访问；没有新增安装脚本或 pnpm 策略豁免。

macOS app 为 ad-hoc 签名的开发者 beta，尚未 Developer ID 公证，截图需要用户自行授予系统录屏权限。当前原生资源覆盖 Windows x64 与 macOS arm64；其他原生架构需另行构建和验收。JS 包可安装不等于所有硬件都有对应原生程序。

beta.7 及更早 tag/资产保持不变，双方系统现在统一升级到 beta.8。校验和见 SHA256SUMS-beta.8.txt，详细证据见仓库 docs/BETA8_UNIFIED_RELEASE.zh-CN.md。


验收：Windows 当前源码编译成功，235 项原生测试与 201 项 SDK 测试通过；Mac 105 项原生测试与 194 项 Node 测试通过（各平台专属或硬件忽略项详见报告）。双方均已通过同一完整包的真实工具链五模块、默认拒绝、撤权、持久化和进程清理验收。Windows 使用托管 Hyper-V 显示器，Mac 使用本机 Retina，未将虚拟桌面结果宣传为全部物理硬件验收。

[验收记录](https://github.com/dongyan3721/dsh-desktop-toolbox/blob/main/docs/BETA8_UNIFIED_RELEASE.zh-CN.md)
