# Antigravity / Gemini 3.8 Flash High — H0/H1 original human interface

User authorized this round. Worktree D:/Code/dsh-toolbox/.worktrees/antigravity, branch agent/antigravity-bridge, synced by Codex. Read updated AGENTS, HUMAN_FIRST_PLAN, H1_CONTRACT and original USER_GUIDE/GUI plans.

First map existing Dashboard (功能/偏好), FeaturePanel, StickyNote, shortcut recorder/conflict/default/clear controls and Tauri invoke/event lifetimes. Preserve original layout, keyboard behavior, language/theme and window routes. Inspect which assumptions break when the original UI is packaged under the new owned plugin runtime. Implement necessary frontend adapter/lifecycle/error fixes supported by actual source APIs; keep existing native Tauri IPC. Do not add Agent exposure or fake HTTP/connected fallbacks, and do not redesign the application. If no code fix is needed, prove that via build/tests and explicit interface/parity evidence rather than inventing changes.

Write scope: native/YourAllIn1Helper/src-ui/** including its local lockfile and meaningful existing/new UI tests; docs/HUMAN_UI_PARITY.zh-CN.md; docs/handoffs/ANTIGRAVITY_H1.md. No Rust, root JS/build/SDK, shared protocol, or Harness Client edits. Cross-boundary requests go to handoff. In parity doc separate source-present, automated-tested and real-GUI-unverified, including local keys and all default/custom bindings.

Dot-source Use-ProjectEnvironment. Root node_modules points to shared read-only SDK: NEVER install there. Install only nested src-ui dependencies using the appropriate isolated/ignore-workspace option and its frozen lockfile, D cache; build Vue with type checking plus existing frontend tests. All outputs are local. Do not start GUI, browser preview, global keys, clipboard, capture, tracking, password UI or auth. Codex will run real desktop validation after integration.

Deliver focused commits, exact commands/results, build output and native integration requests; do not merge main or change model. Proceed now.
