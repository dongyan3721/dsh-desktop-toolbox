# DSH Toolbox collaboration rules

## Current unified beta.8 release (supersedes platform split)

The user requires ONE release version and ONE complete bundle for Windows and
macOS. Root and Host JavaScript packages must not have platform installation
filters; native payloads use an explicit target inventory and runtime dispatch.
Build current native sources for Windows, retain the accepted Mac app, and
verify each bundled target. Preserve beta.7 and all older tags/assets. Use
workspace-local profiles/caches and retain default-OFF Agent grants. Codex owns
CI, integration, packaging and publication. CI runners are disposable test
machines; do not change the local machine global toolchain or everyday data.

## Current macOS beta.7 release

The user now defers dependency decoupling and authorizes a macOS Apple Silicon
beta release with five Agent modules and direct GitHub URL installation. Codex
owns integration, isolated installed-Harness acceptance and publication. Keep
beta.6 and older tags/assets immutable. Do not infer Intel or Windows beta.7
acceptance from the macOS run. Continue to preserve the original human UI and
default-OFF Agent grants.

## Current macOS exploration, 2026-11-14 (supersedes Windows assignment)

The user's latest assignment authorizes all six existing Zed ACP threads (Zed,
Antigravity, Qoder, Cursor, Copilot, OpenCode), without changing their selected
models or modes. Use independent worktrees and `codex/` branches on this Mac.
The integration root is `/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox`;
the independent desktop repository `/Users/santa_antilles/Desktop/your_all_in_one`
is a read-only comparison input for this round. See `docs/MACOS_EXPLORATION.zh-CN.md`
and `docs/tasks/MACOS_*.md` for current assignments. Previous beta.5 ownership and
D/E-drive environment requirements below are historical for this round.

On macOS source `scripts/use-project-environment.sh` before builds/tests. Use the
installed Harness read-only and a workspace-local isolated DSH_HOME for acceptance.
Do not read credentials/personal databases or mutate the everyday Harness profile.
Codex owns shared contracts, Host lifecycle, integration, real desktop tests and
root packaging. Delegates perform synthetic/non-GUI tests only. Preserve all
historical artifacts/tags and the existing pnpm policy.

## Commit attribution and URL installation, 2026-11-14

Codex commits must include `Co-authored-by: Codex <codex@openai.com>`, as authorized by the user. Other agents may add their own co-author trailer only when their official attribution email is verified; never invent one. Preserve the repository-local user email `2914566893@qq.com`.

The next release adds a self-contained root `dsh-toolbox-bundle` for GitHub URL and single tarball installation. Host and Client development packages remain separate. Codex owns the root manifest, generated `distribution/`, packaging and isolated installation acceptance. Do not change historical tags/artifacts or weaken pnpm's build/exotic-dependency policy.

## Current assignment: beta.5 feedback, 2026-11-14

The user's latest assignment replaces the previous app/model ownership for this round: all three delegates are existing Zed threads, named Copilot, Grok Build, and Claude Code. Do not start agents in Cursor, CodeBuddy, Antigravity, or Qoder, and do not change the user's selected models/modes. Historical worktree/branch names stay unchanged. Read `docs/BETA5_FEEDBACK_PLAN.zh-CN.md` and the corresponding `docs/tasks/ZED_B5_*.md`; those files override earlier task ownership for this round. Copilot uses `.worktrees/antigravity`, Grok Build uses `.worktrees/cursor`, and Claude Code uses `.worktrees/zed`. Codex alone coordinates shared contracts, Host/native console transport, integration, real desktop tests, and packaging on main. Installed Harness is now user-reported `0.2.2-rc.3`; the local vendored SDK is still rc.1 and does not prove rc.3 compatibility. Preserve beta.4 and all earlier release artifacts/tags.

The user authorized Codex to prepare the environment and prototype and delegate to local agents. Latest reassignment: CodeBuddy replaces Antigravity/Gemini for frontend work, using the model/mode already selected by the user. Cursor (Grok 4.7) and Zed (Claude Agent ACP / custom DeepSeek Flash) continue. Codex coordinates integration. Do not use Antigravity or Qoder for the current frontend assignment.

- Product priority (latest user clarification, 2026-11-13): preserve original human UI, windows, tray and shortcuts. Module enablement and Agent authorization are separate persistent controls; Agent grants default OFF. Exactly screenshot, clipboard, screen_ink, app_usage and sticky_note support Agent access and share the GUI kernel/data after explicit grant. The other five modules (media_proc/window_pin/script_runner/translator/password_vault) are unsupported for Agent. Notes are newly authorized for development, superseding the prior four-module list; do not simply restore old headless exports. Read `docs/A2_NEXT_PHASE.zh-CN.md`, `docs/AGENT_ACCESS_PLAN.zh-CN.md`, `docs/A2_CONTRACT.md` and `docs/HUMAN_FIRST_PLAN.zh-CN.md`. Legacy headless Agent exports must not bypass new grants in new releases; historical archives stay frozen.

- Integration workspace: `D:\Code\dsh-toolbox`, owned by Codex. Each delegated agent must work only in its own Git worktree: `.worktrees/cursor` on `agent/cursor-native`, `.worktrees/antigravity` on `agent/antigravity-bridge`, or `.worktrees/zed` on `agent/zed-features`. Original C-drive project, integration workspace and existing Harness user data are read-only for delegated agents. Do not read credentials or private databases.
- CodeBuddy now exclusively owns frontend work in the EXISTING `.worktrees/antigravity` / `agent/antigravity-bridge` slot. The directory/branch names are historical; do not create or rename worktrees/branches. Read `docs/tasks/CODEBUDDY_A3.md`; prior Antigravity A3 instructions describe the transferred scope, not a second active writer. Keep the user's selected CodeBuddy model and mode.
- Read `docs/MIGRATION_PLAN.zh-CN.md`, `docs/IMPLEMENTATION_BASELINE.zh-CN.md`, `docs/BRIDGE_PROTOCOL.md`, and your task in `docs/tasks/` before editing.
- Read the fixed upstream guide in `docs/references/deepseek-harness-plugin-dev-guide/AGENTS.md` and the relevant REFERENCE/INSTALLATION sections. Installed Harness `0.2.2-rc.1` takes precedence over the guide's historical baseline.
- Before commands dot-source `scripts/Use-ProjectEnvironment.ps1`. Put all build intermediates, tests, temporary files and packages inside this workspace. Reuse D-drive caches and installed E-drive Harness read-only. Do not change global tools, settings or caches.
- Separate working trees: use your assigned worktree as the current directory for every command, and use that worktree's absolute paths for editor tools when the app is still attached to the integration folder. Edit only assigned paths inside that worktree. Do not revert another agent's files, run git clean/reset, publish, install into the existing user profile, or alter root manifests/lockfiles without coordination. Commits to your own branch may include only your assigned files; never commit or merge on main.
- Root scripts, prototype index, environment, integration tests, dependency snapshot and shared contract are Codex-owned. Report cross-boundary changes as requests in your handoff instead of making them.
- Avoid mock success. Distinguish unavailable, planned and implemented capabilities. New APIs must be confirmed against installed JS/README; installed packages do not ship TypeScript declarations.
- Keep secrets/private content out of diagnostics, logs and development prompts. The five supported modules may share their authorized content as intentional product tool results; no implicit grant or hidden collection. Delegates use synthetic fixtures and non-GUI tests only. Codex alone performs controlled real desktop/capture/clipboard/usage/model acceptance in isolated data; do not inspect personal databases or credentials.
- Build, temporary, runtime, test and artifact directories must be local to your worktree. Shared SDK snapshots and D-drive dependency caches are read-only inputs; do not run installers against the shared node_modules junction.
- Deliver actual code and focused tests, then write your handoff with your branch, worktree, changed files, exact commands/results and remaining issues. Never claim hardware/UI tests you did not perform.
