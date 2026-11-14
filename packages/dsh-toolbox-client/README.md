# dsh-toolbox-client

The shared Windows/macOS Client panel mounts the original Vue Dashboard inside the Harness main-content slot. Module cards, enablement and the independent Agent grant switches are reused from the desktop UI; opening a feature still delegates to the original native panel. Mounting the Harness panel does not open the separate native main window.

Before packing, run `npm --prefix packages/dsh-toolbox-client run build:client`. It builds the Dashboard with the workspace Vue toolchain and inlines its JS/CSS into `client.js`. This keeps the package self-contained and avoids relying on an unverified static-asset URL. The Dashboard is mounted in a Shadow DOM; its theme is scoped to the embedded container and does not change Harness document styles. Shortcut preferences remain visible, but recording is explicitly directed to the native window because it requires native WebView focus.

The Client uses the existing `/api` Connection RPC carrier. The matching Host/native package implements the closed `toolbox-human/console` route (snapshot, module/grant changes, shortcut preferences/check/update, general preferences and manual opening), alongside `status`, `showMain` and `openPanel`. It controls the same desktop kernel as the separate native window; the console is not an Agent tool. Both packages must use version `0.1.0-beta.8`.

Acceptance uses SDK code extracted from the official `0.2.2-rc.3` app on each tested platform. Build/test and live acceptance evidence is recorded separately in the workspace. Shortcut recording opens the native window; accent color is local to each UI storage origin, while language/theme and module settings use the shared kernel.
