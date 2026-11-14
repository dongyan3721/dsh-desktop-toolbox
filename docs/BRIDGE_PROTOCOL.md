# Toolbox bridge v1 — first-wave contract

Current desktop addendum (beta.5, 2026-11-14): the original desktop runtime advertises `desktop.console` for its private verified parent connection, with closed human-only `{action,args}` validated in Host and native code. This is separate from the Agent method whitelist; Agent calls cannot use it to change grants. The Harness browser-owner Connection carries the human UI request. Snapshot omits private content/full config; background reads do not restart an exited runtime, and explicit `reconnect` is handled by Host before requesting snapshot. Current settings, supported actions and acceptance evidence are in `BETA5_ACCEPTANCE.zh-CN.md`; first-wave headless examples below are historical fixtures, not current product exports.

This contract is owned by Codex. Implementations may request corrections in their handoff; do not change it independently.

## macOS exploration addendum (2026-11-14)

The native HAL keeps macOS monitor bounds in desktop points for human window
placement and xcap region capture. Agent monitor bounds and drawing coordinates
are physical pixels; the bridge converts them once using the display scale.
The ink canvas uses the original logical size, without dividing Retina points
by the scale a second time. Synthetic/Windows adapters keep their pixel bounds.

macOS desktop integration uses the same v1 framing, envelopes, cancellation and
closed methods over a Unix domain socket. This addendum specifies the current
implementation work; acceptance is reported separately in MACOS_ACCEPTANCE.zh-CN.md.

Host creates a fresh private 0700 directory with `mkdtemp` beneath its configured
temporary directory and passes the absolute `<directory>/s` as `--pipe-name`.
The UTF-8 path is at most 103 bytes. The complete random instanceId remains in
the handshake; the short filesystem name is not an authorization identity.
Native verifies the private directory and the connected parent's PID and uid,
sets the socket to 0600, and refuses an existing endpoint. It does not probe,
take over, or remove stale sockets from other instances. Native only removes
the socket it successfully bound; Host removes its empty private directory
after confirming the owned process exited. Parent death/disconnect follows the
same ordered flush/shutdown contract as Windows. Data-directory exclusivity
must use a real macOS file lock.

Windows retains its existing named-pipe path and ACL/PID checks. No HTTP fallback
or discovery/attachment to an independently running personal desktop is added.
The existing independently released 0.1.4 app does not implement this protocol.

## Transport and ownership

Windows Named Pipe, private random name `\\.\pipe\dsh-toolbox-<instanceId>`. Native is server, Node is client. Native restricts the pipe to the current user, rejects remote clients, and verifies the supplied parent PID against the connecting process where Windows APIs permit. This is trusted same-user IPC, not a sandbox for hostile same-user code.

Each frame is a four-byte unsigned **little-endian** byte count followed by UTF-8 JSON. Length must be 1..4,194,304. Reject malformed UTF-8/JSON, zero/oversized frames, duplicate active request IDs and version mismatch. Support partial and coalesced frames. Protocol fields are not user/model-controlled identities.

Client hello: `{ "v":1, "type":"hello", "instanceId":"<uuid>" }`.
Server ready: `{ "v":1, "type":"ready", "instanceId":"<same uuid>", "capabilities":["status","notes.create",...] }`.
Handshake must finish before requests; a wrong instance closes the connection.

Request: `{ "v":1, "type":"request", "id":"<unique string>", "method":"notes.create", "params":{...} }`.
Success: `{ "v":1, "type":"response", "id":"<same>", "ok":true, "result":<JSON-safe value> }`.
Failure: `{ "v":1, "type":"response", "id":"<same>", "ok":false, "error":{ "code":"UNSUPPORTED", "message":"..." } }`.
Cancel: `{ "v":1, "type":"cancel", "id":"<active request>" }`.
Optional progress: `{ "v":1, "type":"event", "id":"<active request>", "event":"progress", "data":{...} }`.

One terminal response per accepted request. Cancel is cooperative; never report cancellation while continuing uncontrolled file writes. Unknown method fails `UNSUPPORTED`; errors must not contain credentials or private content. Stable error codes include `INVALID_REQUEST`, `UNSUPPORTED`, `DISABLED`, `CANCELLED`, `TIMEOUT`, `NOT_FOUND`, `CONFLICT`, `ACCESS_DENIED`, `DEPENDENCY_MISSING`, `INTERNAL`.

## First methods

- `status`, params `{}`: `{ protocolVersion:1, nativeVersion:string, capabilities:string[], modules:[{id:string, available:boolean, enabled:boolean, reason:string}] }`. Only advertise working methods/modules. Starting the bridge must not capture clipboard, screenshots or app usage.
- `notes.create`: `{title:string, content_md:string, open:false}` → existing serialized StickyNoteRecord. First wave persists a note without opening a window. `open:true` fails `UNSUPPORTED` until a real native UI path exists.
- `notes.search`: `{query:string, limit:integer, offset:integer}` → `{items:StickyNoteRecord[], total:integer}`. Validate query/limits and avoid indiscriminate private-data dumping.
- `notes.update`: `{id:string, title?:string, content_md?:string, expected_updated_at?:integer}` → StickyNoteRecord. Expected timestamp mismatch returns `CONFLICT`; document if the old storage precision cannot reliably support this and leave update unadvertised until corrected.
- `media.convert_image`: `{inputPath:string, outputPath:string, format:"png"|"jpeg"|"webp"|"bmp"|"ico"}` → `{outputPath:string, format:string}`. Never overwrite without a separate authorization design; first wave rejects an existing output. File paths must stay within native-configured read/write roots, after junction/symlink-aware validation. Cancellation must settle before acknowledging completion.
- `bridge.shutdown`, params `{}` → `{stopping:true}`; flush data and release owned resources, then exit.

Native proposed invocation (new interface to implement): `dsh-toolbox-native.exe --pipe-name <full pipe> --instance-id <uuid> --data-dir <D path> --parent-pid <pid> --allow-read-root <D fixture root> --allow-write-root <D output root>`. Multiple roots may repeat. Do not use the current default Tauri data path. Data dir has an exclusive instance lock. Parent exit/disconnect shuts down the owned bridge. Existing user app is never attached or terminated.

## Node integration API

Antigravity implements `packages/dsh-toolbox/src/bridge/client.js` exporting `connectBridge({pipePath, instanceId, signal, timeoutMs})` → a Promise of `{request(method, params, {signal, timeoutMs} = {}), close()}`. `close()` is async, idempotent, rejects pending calls and waits for socket teardown. Request rejects an Error with stable `.code`. No arbitrary process launch, no HTTP fallback, no retries of side effects. Native launch policy and root plugin integration are Codex-owned next steps.

Zed implements tool factories accepting the above request-capable client. Export `createNoteTools(bridge)` and `createImageTools(bridge)` from their assigned feature files; return arrays of real `defineTool` definitions, without registering on a global context. User inputs are translated to this protocol; each execution forwards `exec.signal`. No bridge means the root plugin does not register these tools. File authorization must be injected by the integration layer; image factory additionally accepts `{authorizePaths}` and calls it before IPC. Missing authorizer fails closed. Fake clients belong only in focused tests.

## Round 2 decisions (2026-11-13, authoritative for integration)

Wire version stays 1. Envelope fields do not change. Reject non-object/array envelopes, invalid UTF-8, invalid JSON and unknown envelope fields. Validate ready capabilities as unique non-empty strings; validate both response alternatives and event fields. Never put malformed payloads or private content in an error message. Bound active requests, queued requests and unmatched cancellation IDs; document the selected finite limits.

### Cancellation and write outcomes

`connectBridge` additionally accepts `cancelTimeoutMs` (default 1500, positive finite milliseconds). All supplied timeouts must be positive finite numbers. Before dispatch, an aborted request rejects CANCELLED without sending it. Once dispatched, an abort or request timeout sends one cancel frame, **keeps the request tracked**, and waits up to cancelTimeoutMs for its authoritative terminal response. Server success resolves the canonical result, even if cancellation was requested after commit; a server failure propagates its actual error, including CANCELLED when no change was made. A signal must not overwrite an already authoritative successful write in the transport or factory. Harness's outer result policy remains independently verified by Codex.

If the cancellation grace expires or transport disappears before a mutating request's terminal response, report stable `OUTCOME_UNKNOWN` (with sanitized `causeCode` such as CANCELLED, TIMEOUT or DISCONNECTED), tear down the connection and do not retry. For simplicity all dispatched calls may use this conservative unknown-outcome classification. The caller must query/reconcile persisted state before retrying a write; this is not an exactly-once guarantee. Native must return CANCELLED only before its mutation commit point, return success once committed, and finish/flush owned work before shutdown/exit.

`close()` waits for actual socket close, is idempotent and clears every timer/signal listener it owns. Host unload first stops new calls and drains tracked calls, then asks for bridge.shutdown, awaits process exit, closes remaining transport, and only then applies a bounded managed-process termination fallback. Do not call ctx.fiber.dispose recursively from its own disposer.

### Shared note limits

Use Unicode scalar counts (Rust chars; JavaScript must reject unpaired surrogates). Titles: 1..500 scalars and non-whitespace; note IDs: 1..80; search query: 1..200 and non-whitespace; content_md: 0..1,048,576. Whitespace means Unicode White_Space, matching Rust char::is_whitespace; do not substitute JavaScript String.trim's different NEL/BOM set. Reject controls below U+0020, except CR/LF/TAB in content_md only. Preserve valid original text. Search limit: 1..20, default 20; offset: 0..10000, default 0. expected_updated_at: non-negative safe integer. Other integer fields in model results must be safe for JavaScript. Envelope/body byte limit remains 4MiB and can reject a payload even if individual fields satisfy their scalar limits.

Image formats remain png/jpeg/webp/bmp/ico. The image method must reject an existing destination without a check-then-overwrite race; use private same-directory staging plus a no-clobber publication operation. Cancel before publication removes staging and reports CANCELLED; cancel after successful publication reports success. Both native-configured root restrictions and Host file authorization apply. Tool registration is gated by actual ready capabilities, never by the existence of a JavaScript factory.
