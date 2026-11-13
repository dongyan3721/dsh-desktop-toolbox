# A2 shared contract: human enablement and Agent grants

Owner: Codex. Date: 2026-11-13. User's latest scope supersedes earlier Agent allowlists. H1 lifecycle, ownership, framing, identity and keyboard contracts remain in force. Implementations may not claim unimplemented operations.

## Policy and UI

- Only `screenshot`, `clipboard`, `screen_ink`, `app_usage` support Agent access. The other six catalog entries are human-only, including notes and media.
- Add `modules.agent_access: HashMap<String, bool>`; missing map/key means false, including old configurations. Preserve unknown config fields and existing enabled/settings/shortcuts. A forged true for an unsupported/unknown ID never authorizes it.
- Extend `kernel_list_modules` entries with `agent_supported: boolean`, `agent_allowed: boolean`, `agent_effective: boolean`. Keep existing platform `supported`, `available`, `enabled` semantics. Effective also requires runtime availability; static support alone does not advertise a working method.
- Human-only Tauri command: `kernel_set_agent_access` with `{module_id: string, allowed: boolean}` returns the complete updated module catalog, as `kernel_set_module_enabled` does. Reject unknown IDs and attempts to grant unsupported modules. Persist transactionally; UI rolls back/reloads canonical state after failure.
- Grants can be edited while a supported module is disabled; indicate that access is currently ineffective. Module disable preserves grant. Agent revoke does not stop human UI/shortcuts or change sampling settings. Unsupported modules display localized “不支持 Agent / Agent access unsupported”, not an interactive grant control.
- Native code enforces support, current module enablement/availability, and grant on **every Agent call**, independent of Node tool visibility. No Agent setter, enable command, generic IPC dispatch, `actor: human`, arbitrary script, vault, note or media route.

## Native desktop pipe (Cursor) and service (Codex)

Use the existing GUI owner/process/kernel. Never create another NativeOwner/headless kernel for Agent tools. Preserve all H1 calls/capabilities. Add:

1. `agent.get_access` with `{}` returns `{revision: number, modules: [{id, agent_supported, agent_allowed, agent_effective}], methods: string[]}`. Metadata only, no AppConfig, clipboard content, window titles, usage records or secrets. `methods` lists genuinely implemented Agent data methods, regardless of current grants; Node intersects with effective modules. Revision changes when policy/effective access changes during an instance. Across restarts Node reloads the entire snapshot.
2. Agent data methods below. Strict per-method arguments, bounded payloads, reject unknown extra/identity/path arguments. Guard before effects and before publishing read/image data; stale authorization results are denied. Cancellation must reach native work, not just the waiting Promise. Never automatically replay an uncertain write/capture.

Codex extends `toolboxDesktop` service:

```js
getAgentAccess({ signal } = {}) // -> native access snapshot
agentCall(method, params = {}, { signal } = {}) // -> native canonical result
onAgentAccessChanged(listener) // -> disposer; snapshot as listener argument
```

Service starts a metadata-only poll while subscribed (target 1 second), publishes initial and changed snapshots, and withdraws effective access on disconnect. Existing bridge only supports request-scoped events; do not invent unsolicited global events in this phase. Listener/poll/connection cleanup belongs to service scope. Tool calls still recheck access and native enforces immediately, including during the polling interval. Do not auto-start a second process or implicitly restart/retry side effects.

## A2 data methods and rollout

The following names are reserved. Cursor first delivers policy and small JSON methods with focused tests, then image/canvas methods. Zed may develop against fixtures but registers a method only when advertised. Return JSON-safe canonical module data, with bounded filtering; do not return huge raw config/database dumps.

| Method | Module | Input and boundary |
| --- | --- | --- |
| `agent.screenshot.monitors` | screenshot | `{}`; genuine display identifiers/bounds/scales |
| `agent.screenshot.capture` | screenshot | `{monitor_id: uint32, region?: {x:int,y:int,width:uint,height:uint}}`; explicit physical-pixel region relative to selected monitor, validated bounds; omitted region captures that monitor. No user-supplied file path; returns a PNG artifact descriptor |
| `agent.clipboard.list` | clipboard | `{keyword?: string, limit?: int}`; default20, max100; text history summaries with ID/type/time and bounded preview, not whole blobs |
| `agent.clipboard.read_text` | clipboard | `{id: positive int}`; text item only, bounded text, structured error for non-text/too-large |
| `agent.clipboard.write_text` | clipboard | `{text: string}`; max64KiB UTF-8; actual OS clipboard plus same history DB; no auto-paste, duplicate suppression, truthful failure |
| `agent.ink.status` | screen_ink | `{}`; shared session state |
| `agent.ink.start` / `agent.ink.stop` | screen_ink | `{}`; existing shared UI session, no separate canvas |
| `agent.ink.passthrough` | screen_ink | `{enabled: boolean}`; same canvas state |
| `agent.ink.clear` | screen_ink | `{}`; explicit action clears current shared canvas |
| `agent.ink.draw` | screen_ink | `{strokes: [{points:[{x:number,y:number}], color:'#RRGGBB', width:number}]}`; native validates finite physical-screen coordinates/width, max128 strokes and8192 points/request, no JS/HTML or input simulation; renders on original canvas. Return applied count/revision only after UI acknowledgment |
| `agent.ink.snapshot` | screen_ink | `{}`; actual current shared canvas/composite PNG, no supplied image standing in for real UI state; uses screen_ink grant, never arbitrary desktop capture via raw IPC |
| `agent.usage.status` | app_usage | `{}`; tracking state only, no enable/change settings |
| `agent.usage.overview` | app_usage | `{start_date:'YYYY-MM-DD',end_date:'YYYY-MM-DD'}`; real valid dates, inclusive, max31 days, ordered; shared stats |
| `agent.usage.apps` | app_usage | same date range plus `{limit?:int}` default20 max100; bounded aggregate per app, no unbounded sessions/window-title dump |
| `agent.usage.hourly` | app_usage | `{date:'YYYY-MM-DD'}`; bounded daily aggregate |

Images: native descriptor `{artifact_id:string, mime_type:'image/png', byte_length:number, width:number, height:number}` plus implementation-owned transfer metadata if needed. Cursor and Codex finalize a bounded transfer path/chunk mechanism before Zed claims live image delivery; JSON frames remain <=4MiB, no giant base64. Any path is generated/validated within the GUI's artifact root, not an Agent input. Max PNG 16MiB, native caps pixels before allocation. Artifact association carries module/grant revision; download and model publication recheck the corresponding grant. Codex owns bridge/file transfer glue. Zed must verify the installed SDK's real image result API and document it; a path string alone is not a model-visible image. If no suitable SDK API exists, report the blocker without faking success.

Exact domain result fields reuse checked original structs where possible. Cursor documents tested response examples/schema in `docs/handoffs/CURSOR_A2.md` with the first commit; Codex resolves any schema conflict before live integration. SDK capabilities and native advertised methods, not planned names, determine registration. No generic “run arbitrary command” tool. Four module-specific tool factories may group actions using closed enums; no supported-module list expansion.

## Errors, tests and file ownership

Stable codes: `UNSUPPORTED` (module/method not supported), `MODULE_DISABLED`, `AGENT_ACCESS_DENIED`, `UNAVAILABLE`, `INVALID_REQUEST`, `CANCELLED`, plus truthful existing execution errors. Never collapse rejection into a successful empty result. No content in error/log/poll metadata. No implicit cross-module actions such as copying a screenshot into the system clipboard without that separately authorized operation.

Cursor owns Rust app-core policy/config/catalog, src-tauri desktop control/IPC and needed bounded changes within mod-screenshot/mod-clipboard/mod-screen-ink/mod-app-usage. Original canvas rendering is Vue-owned: coordinate native/frontend drawing acknowledgment through Codex and Antigravity, not by editing Vue in Cursor's tree. Antigravity owns `src-ui` types/components/translations and the narrow original-canvas structured drawing handler/ack if needed. Zed owns only new `packages/dsh-toolbox/src/agent/**` and `packages/dsh-toolbox/tests/agent-*.test.mjs`. Each owns its new handoff. Codex owns this contract, shared docs, desktop service, bridge, root entry/exports/patch/build/integration tests, and retiring old Agent exports. Ask via handoff for cross-boundary code; do not silently edit it.

All agents use existing assigned worktrees, D caches, workspace-local temp/build/test outputs and synthetic data. No new worktrees/branches. No real capture/listener/shortcut/UI launches or user profile installation by delegates. Do not run tests requiring desktop side effects. Existing human GUI preview remains installed until Codex's integration gates pass. Focused tests cover unauthorized direct RPC, independent module grants, migration/persistence/revoke, bounded inputs, shared state and cancellation. Codex runs genuine GUI/model/sharing/keyboard/packaging acceptance after integration.
