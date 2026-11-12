# Toolbox bridge v1 — first-wave contract

This contract is owned by Codex. Implementations may request corrections in their handoff; do not change it independently.

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
