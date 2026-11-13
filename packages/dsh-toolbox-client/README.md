# dsh-toolbox-client

Human-visible DeepSeek Harness entry for DSH Toolbox, verified on 0.2.2-rc.1 in Web and packaged Electron.

Install this package and the matching dsh-toolbox version together. It declares dsh.client and exports ./client, a browser bundle that registers the 工具箱 sidebar entry and matching main panel. Clicking it opens the original Tauri toolbox window; it needs no model request and registers no model tool.

The Host entry re-exports dsh-toolbox/human-entry. It consumes the independent toolboxDesktop service and registers three authenticated Connection exact Fetch routes at /api/toolbox-human/{status,showMain,openPanel}. The browser uses Connection RPC framing and correlation over these routes. The shared carrier retains authentication, Host/Origin checks, owner admission and disconnect cancellation. No core patch or separate HTTP listener is required.

The earlier generic /toolbox-human channel was replaced after real profile testing found a provider-shadow-context registration failure in this installed SDK. The independent-provider SDK regression covers the supported exact-route composition and disposal.

This is a local human preview. Original data import, full ten-module GUI/key acceptance and release/license auditing remain separate migration stages. See workspace docs/INTEGRATION_H1.zh-CN.md for actual tested scope and installation details.
