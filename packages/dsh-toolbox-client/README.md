# dsh-toolbox-client

Beta.3 updates dependency declarations only and reuses the beta.2 JS/native payload. Runtime compatibility with DSH 0.2.2-rc.3 is untested in this release and will be checked by the user.

Human-visible DeepSeek Harness entry for DSH Toolbox, verified on 0.2.2-rc.1 in Web and packaged Electron.

Install this package and the matching dsh-toolbox version together. It declares dsh.client and exports ./client, a browser bundle that registers the 工具箱 sidebar entry and matching main panel. Clicking it opens the original Tauri toolbox window; it needs no model request and registers no model tool.

The Host entry re-exports dsh-toolbox/human-entry. It consumes the independent toolboxDesktop service and registers three authenticated Connection exact Fetch routes at /api/toolbox-human/{status,showMain,openPanel}. The browser uses Connection RPC framing and correlation over these routes. The shared carrier retains authentication, Host/Origin checks, owner admission and disconnect cancellation. No core patch or separate HTTP listener is required.

The earlier generic /toolbox-human channel was replaced after real profile testing found a provider-shadow-context registration failure in this installed SDK. The independent-provider SDK regression covers the supported exact-route composition and disposal.

This is local beta 0.1.0-beta.3. The matching Host supports five separately granted Agent modules; this Client remains a human entry and grants no Agent access. See workspace docs/BETA1_ACCEPTANCE.zh-CN.md for measured scope and remaining manual credential, compatibility, data migration and license checks.
