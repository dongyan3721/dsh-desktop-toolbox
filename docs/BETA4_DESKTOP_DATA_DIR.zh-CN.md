# beta.4：未设置 DSH_HOME 时的桌面数据目录

日期：2026-11-14。

- Host 与 Client 同步为 `0.1.0-beta.4`。Client 对 Host 的版本依赖同步更新。
- 依赖声明保持 beta.3：Harness `0.2.2-rc.1` 或 `0.2.2-rc.3`，Cordis `~4.1.0`。
- 桌面组件自己解析数据目录：显式 `dataDir`，其次 `DSH_TOOLBOX_DATA_DIR`，再次 `DSH_HOME/toolbox-desktop-data`。两者都为空时使用用户主目录下的 `.dsh/toolbox-desktop-data`。相对的显式目录返回 `INVALID_CONFIG`。
- Bundle 不再用环境变量表达式填 `dataDir`。
- 两份原生 exe 沿用 beta.3，SHA-256 不变。桌面 `3f1bd82e1155e7f0ce48eb3a854b8053d9369696c30943c487705a6d95caeeff`，headless `c00ef5a71233e9ffddbd39ef5bee845c9229c5d730f803aa32c6ea0f547c310a`。原生源码 revision 仍是 `2ef140050ded033d520bfc130aa2a98a12967ea3`。
- 测试只跑了桌面数据目录和协议替身：`node --test tests/desktop-data-dir.test.mjs tests/desktop-service.test.mjs`，5 通过。没有安装到 Profile，没有启动 Harness，没有做 rc.3 运行兼容测试。

交付文件：

```text
dist/dsh-toolbox-0.1.0-beta.4.tgz
16337921 字节
SHA-256 85db403a943ae14873e6884ebdca872550ae5a65d1115782bab3f190f71f7aa0

dist/dsh-toolbox-client-0.1.0-beta.4.tgz
5114 字节
SHA-256 bd3569f724e9a2d0d4829dcf72f450e159daa2771ba11130ae62c124f148a0f3
```

导入时使用同版本的 Host 和 Client。
