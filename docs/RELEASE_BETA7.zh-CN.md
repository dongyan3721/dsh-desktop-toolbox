macOS Apple Silicon 的五模块 Agent beta，适配已安装的 DeepSeek Harness 0.2.2-rc.3。

安装：在 Harness「插件 → 添加插件」输入：
```
https://github.com/dongyan3721/dsh-desktop-toolbox#v0.1.0-beta.7
```
也可使用本页的 `dsh-toolbox-bundle-0.1.0-beta.7.tgz` 或它的下载 URL。无需 Rust 编译和安装脚本；不要导入自动生成的 Source code 归档。

本版包括完整 Host、Client、原生 `.app` 与完整性清单。新配置只启用便笺，五项 Agent 授权默认关闭。截图、屏幕注释、便笺、系统剪贴板与应用使用时长在授权后共享原生 GUI 内核和数据。撤权及关闭模块会阻止旧工具继续调用。

实际验收：190 项 Node 测试通过，9 项 Windows 专属历史用例明确跳过；完整包在安装版 Harness 中完成五模块 SDK 调用、图片附件、真实应用时长增长、五项授权边界和便笺重启持久化。原 `.app` 资源签名通过严格校验。

范围：仅 macOS arm64。Windows x64 继续使用 beta.6，历史 tag 和资产不变。beta.7 未验收 Intel、多屏、全部十模块和物理全局快捷键。本版为 ad-hoc 签名的开发者 beta，尚无 Developer ID 公证；截图需要用户自行授予 macOS 系统权限，验收机已有许可。SDK 调用验收不等同于模型自动选择工具。

详见仓库 `docs/BETA7_MACOS_RELEASE.zh-CN.md`。单包 SHA-256 随本 Release 的 `SHA256SUMS-beta.7.txt` 提供。
