# dsh-toolbox-client

The beta.5 Client panel mounts the original Vue Dashboard inside the Harness main-content slot. Module cards, enablement and the independent Agent grant switches are reused from the desktop UI; opening a feature still delegates to the original native panel. Mounting the Harness panel does not open the separate native main window.

Before packing, run `npm --prefix packages/dsh-toolbox-client run build:client`. It builds the Dashboard with the workspace Vue toolchain and inlines its JS/CSS into `client.js`. This keeps the package self-contained and avoids relying on an unverified static-asset URL. The Dashboard is mounted in a Shadow DOM; its theme is scoped to the embedded container and does not change Harness document styles. Shortcut preferences remain visible, but recording is explicitly directed to the native window because it requires native WebView focus.

The Client uses the existing `/api` Connection RPC carrier. Besides existing `status`, `showMain` and `openPanel` endpoints, beta.5 requires the Host-owned closed `toolbox-human/console` route and its actions (`snapshot`, module/grant changes, shortcut preferences/check/update, general preferences and manual opening). This Client change does not implement that Host/native service contract; it must be integrated by Codex before the console is operational.

The repository's vendored Harness reference and frontend test snapshot are `0.2.2-rc.1`. The installed Harness is user-reported as `0.2.2-rc.3`; this worktree has not verified the new embedded bundle in that installed runtime or a GUI session. The package version/peer range remains beta.4 pending coordinated beta.5 integration.
