# DSH Toolbox collaboration rules

The user authorized Codex to prepare the environment and prototype, then delegate to local Cursor (Grok 4.7), Antigravity (Gemini 3.8 Flash), and Zed (Claude Agent ACP / custom DeepSeek Flash). Codex coordinates integration. Use the model already selected in each app.

- Workspace: `D:\Code\dsh-toolbox`. Original C-drive project and existing Harness user data are read-only. Do not read credentials or private databases.
- Read `docs/MIGRATION_PLAN.zh-CN.md`, `docs/IMPLEMENTATION_BASELINE.zh-CN.md`, `docs/BRIDGE_PROTOCOL.md`, and your task in `docs/tasks/` before editing.
- Read the fixed upstream guide in `docs/references/deepseek-harness-plugin-dev-guide/AGENTS.md` and the relevant REFERENCE/INSTALLATION sections. Installed Harness `0.2.2-rc.1` takes precedence over the guide's historical baseline.
- Before commands dot-source `scripts/Use-ProjectEnvironment.ps1`. Put all build intermediates, tests, temporary files and packages inside this workspace. Reuse D-drive caches and installed E-drive Harness read-only. Do not change global tools, settings or caches.
- Shared working tree: edit only your assigned paths. Do not revert another agent's files, run git clean/reset, commit, publish, install into the existing user profile, or alter root manifests/lockfiles without coordination.
- Root scripts, prototype index, environment, integration tests, dependency snapshot and shared contract are Codex-owned. Report cross-boundary changes as requests in your handoff instead of making them.
- Avoid mock success. Distinguish unavailable, planned and implemented capabilities. New APIs must be confirmed against installed JS/README; installed packages do not ship TypeScript declarations.
- Keep user secrets and private content out of logs, prompts and tool results. No clipboard, screenshot or app tracking in the prototype.
- Deliver actual code and focused tests, then write your handoff with changed files, exact commands/results and remaining issues. Never claim hardware/UI tests you did not perform.
