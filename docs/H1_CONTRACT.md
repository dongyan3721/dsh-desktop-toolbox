# H0/H1 human desktop integration contract

Owner: Codex. This round implements the first real human workflow, not more Agent tools. Read HUMAN_FIRST_PLAN.zh-CN.md. Existing alpha.2 and headless regression remain compatible. Current tasks: CURSOR_H1, ANTIGRAVITY_H1, ZED_H1.

## Ownership and scope

- Cursor owns the Tauri desktop host, formal plugin startup, private control pipe, native shortcut lifecycle and Rust tests under src-tauri. Native Cargo manifests/lock may change only as required by Cargo; no unrelated crate work.
- Antigravity owns the original Vue frontend under native/YourAllIn1Helper/src-ui and its tests/lockfile. Preserve existing layout, local/global keyboard workflows, feature panels, themes and language. Do not edit src-tauri or Harness client/host JS.
- Zed owns the external Harness human-entry investigation and, where supported by verified APIs, packages/dsh-toolbox-client plus a narrowly scoped Host adapter under packages/dsh-toolbox/src/human-entry. Do not edit desktop runtime, tool factories or root package/build config.
- Codex owns public contracts, main/integration, packages/dsh-toolbox/src/desktop (process owner/runtime service), package exports/Bundle/config, common build scripts and real GUI/global-key acceptance.
- All three reuse their existing branches/worktrees, synced by Codex before dispatch. Only Codex opens the toolbox desktop or sends global keys. Agents may compile and run non-GUI tests, but do not start the GUI, capture, tracking, password UI, or any user-profile instance.

## Desktop startup, proposed v1 interface (Cursor implements)

Desktop binary remains the existing all-in-one-desktop target. Add formal `--toolbox-plugin --pipe-name <full pipe> --instance-id <uuid> --data-dir <absolute path> --parent-pid <pid>` startup. These are new GUI-mode arguments; do not pretend the current headless binary implements them. Optional GUI resource/runtime flags require coordination.

Plugin mode uses the original real Tauri event loop and exactly one DesktopHost/AppKernel. It never boots the headless BridgeService as a second kernel. Explicit dataDir, WebView data, logs and temp stay in the isolated worktree at development/test time. No updater, demo seeding, autostart changes, attaching old app, or access to original user databases. Fresh H1 fixtures enable only non-capturing functionality needed for notes; do not automatically start clipboard, usage or screenshot capture. Preserve user-managed module settings for later explicit import.

Use the existing bridge v1 framing, current-user pipe restrictions, random instance identity and connecting parent PID check. Share tested utilities where practical; no localhost HTTP or generic legacy IPC proxy. Ready only after the real desktop runtime is initialized. Capabilities must state only implemented desktop controls.

Human-only control methods (not model tools):

| Method | Params | Result |
| --- | --- | --- |
| status | {} | protocolVersion:1, nativeVersion, capabilities, modules, desktop:true |
| desktop.show_main | {} | {opened:true}; create/show/focus original main window, repeated calls reuse it |
| desktop.open_panel | {module_id:string} | {opened:true}; validated catalog ID, preserve original panel behavior |
| desktop.shutdown | {} | {stopping:true} after original flush/exit path is accepted; errors must not claim saved/closed |

Tauri actions marshal to the correct thread. Handle native startup failure, repeated open, rejected/failed save, parent loss and ordered cleanup. Closing the main window retains tray/keys; normal panel closure preserves its original semantics (vault locking included). Plugin unload/real parent exit releases only owned resources. Do not add new default hotkeys or silently rebind conflicts.

Existing native UI invokes its existing Tauri IPC, independent of tools. No request field like `actor:human` may confer access. The private control service is trusted host/UI infrastructure, never a blanket Agent entry point. No Agent mapping for scripts, vault or usage.

## Frontend (Antigravity)

Preserve existing Tauri invoke/event adapters and original view routes. Identify any plugin-mode readiness/transport assumptions and fix them only with a real native handshake/API. No fake connected state, HTTP success fallback, app UI rewrite, or protocol debug details in normal UI. Record cross-boundary native requests instead of editing Cursor files. A plugin-specific UI contract change must be agreed in this file first.

## Harness human entry (Zed)

First verify installed 0.2.2-rc.1 public Client/command/menu extension and external-package loading from actual JS/README/manifests. Record exact package exports, registration shape, Bundle/client build needs and supported native command/Remote seam before implementation. Read-only SDK extraction by Codex on request. Do not invent a sidebar API or modify installed E-drive app files/core.

Preferred Host dependency name for the forthcoming owned desktop runtime is `toolboxDesktop`, methods `status(signal?)`, `showMain({signal}?)`, `openPanel(moduleId,{signal}?)`. This is a proposed service interface, not an existing SDK API. Codex supplies it. UI adapter should invoke this service from a verified human entry. No LLM request, slash-chat prompt, console command, or Tool call is accepted as the final visible entry.

If external entry requires a workspace-registered build preset or nonpublic app modifications, stop that implementation path, report concrete source evidence and propose supported options. Continue useful package/parity work without claiming the entry is complete. Do not weaken the acceptance gate.

## Acceptance and handoff

Each agent commits only assigned files and writes docs/handoffs/{CURSOR,ANTIGRAVITY,ZED}_H1.md with actual commands/results, unverified items and cross-boundary requests. Distinguish source/automated tests from actual physical-key/UI validation. Codex integrates into the existing integration worktree and verifies: visible entry → original main/preferences → desktop note create/edit/save/reopen/restart → temporary custom global key from another foreground app → conflict/default restore → unload. All generated data/artifacts stay in the project; original C project and everyday Harness profile remain untouched.
