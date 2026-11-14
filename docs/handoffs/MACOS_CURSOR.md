# Cursor handoff — macOS private Unix socket

Worktree: `/Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/cursor`

Branch: `codex/macos-cursor`

No GUI, capture, clipboard, or desktop launch. Windows named pipes stay `\\.\pipe\dsh-toolbox-<instance-id>`.

## Host endpoint

`--pipe-name` is the absolute socket path Host created. Native does not read `TMPDIR` to derive it. Host's `os.tmpdir()` and the native process `TMPDIR` (`dataDir/.tmp`, later `dataDir/temp`) are different, so both `parse` and `listen` only check the explicit path:

- absolute, no `.` / `..` / empty segment / trailing slash
- byte length `<= 103` (`sockaddr_un.sun_path` includes the NUL)
- final component is `s`
- parent directory name is `dsh-` plus 6 ASCII alphanumerics
- that parent is not a symlink, `uid == getuid()`, and mode `& 0777 == 0700`

Host creates that fresh `0700` directory (mkdtemp) and passes the path. Native does not create or remove the directory. If `s` already exists, bind fails and the existing node is left in place. There is no connect probe and no stale-socket takeover. Drop unlinks only the socket this listener created. Host `rmdir`s the directory after the process has exited.

Socket mode is set with `fs::set_permissions(path, Permissions::from_mode(0o600))`, then `lstat`. `fchmod` on the socket fd returns `EINVAL` (22) on this Mac. A connected peer must have `uid == getuid()` and `pid == --parent-pid`. `instanceId` is still the hello/ready check, not part of the path. Peer checks require the client socket to stay open; after it closes, `LOCAL_PEERPID` returns `ENOTCONN` (57).

## Test

```text
cd /Users/santa_antilles/PycharmProjects/dsh-desktop-toolbox/.worktrees/cursor && source scripts/use-project-environment.sh && cargo test -p dsh-bridge --manifest-path native/YourAllIn1Helper/Cargo.toml --lib --offline -- --test-threads=1 macutil:: service::tests::pipe_name_must_match_instance_id
```

Result: 6 passed, 0 failed. Covered: path outside process `TMPDIR`, mode `0700`, symlink rejection, socket `0600` via path chmod, existing socket left untouched, flock, parent-exit kqueue, and live peer pid/uid. `all-in-one-host` was not compiled here.

`native/YourAllIn1Helper/Cargo.lock` adds `libc` to the `dsh-bridge` dependency list only.
