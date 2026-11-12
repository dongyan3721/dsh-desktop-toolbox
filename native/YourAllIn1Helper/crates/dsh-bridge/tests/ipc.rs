//! Process-level checks against the real `dsh-toolbox-native` binary and a D: data directory.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|dir| dir.join("AGENTS.md").is_file() && dir.join("native").is_dir())
        .expect("CARGO_MANIFEST_DIR is not inside the toolbox project")
        .to_path_buf()
}

fn fixture(name: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let tmp = project_root().join(".tmp");
    let root = tmp.join("dsh-bridge-tests").join(format!(
        "{name}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    assert!(
        fixture_is_inside_tmp(&root, &tmp),
        "refusing to delete {} because it is outside {}",
        root.display(),
        tmp.display()
    );
    if root.exists() {
        std::fs::remove_dir_all(&root).unwrap();
    }
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn fixture_is_inside_tmp(path: &std::path::Path, tmp: &std::path::Path) -> bool {
    fn key(path: &std::path::Path) -> String {
        let mut normalized = PathBuf::new();
        for component in path.components() {
            match component {
                std::path::Component::ParentDir => {
                    normalized.pop();
                }
                std::path::Component::CurDir => {}
                other => normalized.push(other),
            }
        }
        normalized
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase()
    }
    let path = key(path);
    let tmp = key(tmp);
    !tmp.is_empty() && path.starts_with(&(tmp + "\\"))
}

struct Running {
    child: Child,
    stderr: Option<std::thread::JoinHandle<String>>,
}

impl Running {
    fn spawn(data_dir: &std::path::Path, instance_id: &str, parent_pid: u32) -> Self {
        let pipe = format!(r"\\.\pipe\dsh-toolbox-{instance_id}");
        let temp = project_root().join(".tmp");
        let mut command = Command::new(env!("CARGO_BIN_EXE_dsh-toolbox-native"));
        command
            .args([
                "--pipe-name",
                &pipe,
                "--instance-id",
                instance_id,
                "--data-dir",
                &data_dir.display().to_string(),
                "--parent-pid",
                &parent_pid.to_string(),
            ])
            .current_dir(data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .env("TEMP", &temp)
            .env("TMP", &temp)
            .env("TMPDIR", &temp);
        let mut child = command.spawn().expect("bridge process");
        let stderr = child.stderr.take().expect("stderr");
        let stderr = std::thread::spawn(move || {
            let mut text = String::new();
            let mut reader = std::io::BufReader::new(stderr);
            let _ = reader.read_to_string(&mut text);
            text
        });
        Self {
            child,
            stderr: Some(stderr),
        }
    }

    fn wait_exit(&mut self, limit: Duration) -> (std::process::ExitStatus, String) {
        let started = Instant::now();
        let status = loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                break status;
            }
            if started.elapsed() > limit {
                panic!("bridge process did not exit");
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let stderr = self
            .stderr
            .take()
            .expect("stderr task")
            .join()
            .unwrap_or_default();
        (status, stderr)
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(task) = self.stderr.take() {
            let _ = task.join();
        }
    }
}

async fn connect(instance_id: &str) -> NamedPipeClient {
    let pipe = format!(r"\\.\pipe\dsh-toolbox-{instance_id}");
    let started = Instant::now();
    loop {
        match ClientOptions::new().open(&pipe) {
            Ok(client) => return client,
            Err(err) if started.elapsed() < Duration::from_secs(8) => {
                let _ = err;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(err) => panic!("pipe did not open: {err}"),
        }
    }
}

async fn write_frame(client: &mut NamedPipeClient, value: &Value) {
    let payload = serde_json::to_vec(value).unwrap();
    let mut frame = (payload.len() as u32).to_le_bytes().to_vec();
    frame.extend_from_slice(&payload);
    client.write_all(&frame).await.unwrap();
}

async fn read_frame(client: &mut NamedPipeClient) -> Value {
    let mut len_buf = [0_u8; 4];
    tokio::time::timeout(Duration::from_secs(8), client.read_exact(&mut len_buf))
        .await
        .expect("frame header timeout")
        .expect("frame header");
    let len = u32::from_le_bytes(len_buf) as usize;
    assert!(len > 0 && len <= 4_194_304);
    let mut body = vec![0_u8; len];
    tokio::time::timeout(Duration::from_secs(8), client.read_exact(&mut body))
        .await
        .expect("frame body timeout")
        .expect("frame body");
    serde_json::from_slice(&body).unwrap()
}

async fn handshake(client: &mut NamedPipeClient, instance_id: &str) -> Value {
    let frame = serde_json::to_vec(&json!({
        "v": 1,
        "type": "hello",
        "instanceId": instance_id
    }))
    .unwrap();
    let mut bytes = (frame.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(&frame);
    client.write_all(&bytes[..3]).await.unwrap();
    tokio::time::sleep(Duration::from_millis(80)).await;
    client.write_all(&bytes[3..]).await.unwrap();
    let ready = read_frame(client).await;
    assert_eq!(ready["type"], "ready");
    assert_eq!(ready["instanceId"], instance_id);
    ready
}

#[tokio::test(flavor = "current_thread")]
async fn real_process_persists_notes_rejects_unknown_methods_and_shuts_down() {
    let dir = fixture("ipc-restart");
    let instance = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    let mut running = Running::spawn(&dir, instance, std::process::id());
    let mut client = connect(instance).await;
    let ready = handshake(&mut client, instance).await;
    let capabilities = ready["capabilities"].as_array().unwrap();
    assert!(capabilities.iter().any(|item| item == "status"));
    assert!(capabilities.iter().any(|item| item == "notes.create"));
    assert!(!capabilities.iter().any(|item| item == "media.convert_image"));

    write_frame(
        &mut client,
        &json!({
            "v": 1,
            "type": "request",
            "id": "status-1",
            "method": "status",
            "params": {}
        }),
    )
    .await;
    let status = read_frame(&mut client).await;
    assert_eq!(status["ok"], true);
    assert_eq!(status["result"]["protocolVersion"], 1);
    let modules = status["result"]["modules"].as_array().unwrap();
    assert!(modules
        .iter()
        .any(|module| module["id"] == "clipboard" && module["available"] == false));
    assert!(modules
        .iter()
        .any(|module| module["id"] == "media_proc" && module["available"] == false));

    write_frame(
        &mut client,
        &json!({
            "v": 1,
            "type": "request",
            "id": "bad-method",
            "method": "clipboard.read",
            "params": {}
        }),
    )
    .await;
    let rejected = read_frame(&mut client).await;
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["error"]["code"], "UNSUPPORTED");

    write_frame(
        &mut client,
        &json!({
            "v": 1,
            "type": "request",
            "id": "create-1",
            "method": "notes.create",
            "params": {"title": "Process note", "content_md": "ipc-persist-token", "open": false}
        }),
    )
    .await;
    let created = read_frame(&mut client).await;
    assert_eq!(created["ok"], true);
    assert_eq!(created["result"]["is_open"], false);
    let id = created["result"]["id"].as_str().unwrap().to_string();

    write_frame(
        &mut client,
        &json!({"v": 1, "type": "request", "id": "stop-1", "method": "bridge.shutdown", "params": {}}),
    )
    .await;
    let stopped = read_frame(&mut client).await;
    assert_eq!(stopped["result"]["stopping"], true);
    let (status, _) = running.wait_exit(Duration::from_secs(8));
    assert!(status.success());
    assert!(dir.join("app.db").is_file());

    let instance_b = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    let mut restarted = Running::spawn(&dir, instance_b, std::process::id());
    let mut client = connect(instance_b).await;
    handshake(&mut client, instance_b).await;
    write_frame(
        &mut client,
        &json!({
            "v": 1,
            "type": "request",
            "id": "search-1",
            "method": "notes.search",
            "params": {"query": "ipc-persist-token", "limit": 5, "offset": 0}
        }),
    )
    .await;
    let found = read_frame(&mut client).await;
    assert_eq!(found["result"]["total"], 1);
    assert_eq!(found["result"]["items"][0]["id"], id);
    assert_eq!(found["result"]["items"][0]["is_open"], false);
    write_frame(
        &mut client,
        &json!({"v": 1, "type": "request", "id": "stop-2", "method": "bridge.shutdown", "params": {}}),
    )
    .await;
    let _ = read_frame(&mut client).await;
    let (status, _) = restarted.wait_exit(Duration::from_secs(8));
    assert!(status.success());
}

#[tokio::test(flavor = "current_thread")]
async fn illegal_frame_closes_the_process_and_releases_the_lock() {
    let dir = fixture("ipc-frame");
    let instance = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    let mut running = Running::spawn(&dir, instance, std::process::id());
    let mut client = connect(instance).await;
    handshake(&mut client, instance).await;
    client.write_all(&0u32.to_le_bytes()).await.unwrap();
    let ended = tokio::time::timeout(Duration::from_secs(2), client.read(&mut [0_u8; 8])).await;
    assert!(ended.is_ok());
    let (status, _) = running.wait_exit(Duration::from_secs(8));
    let _ = status;
    let instance_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    let mut restarted = Running::spawn(&dir, instance_b, std::process::id());
    let mut client = connect(instance_b).await;
    handshake(&mut client, instance_b).await;
    write_frame(
        &mut client,
        &json!({"v": 1, "type": "request", "id": "stop", "method": "bridge.shutdown", "params": {}}),
    )
    .await;
    let _ = read_frame(&mut client).await;
    let _ = restarted.wait_exit(Duration::from_secs(8));
}

#[tokio::test(flavor = "current_thread")]
async fn second_process_cannot_lock_the_same_data_directory() {
    let dir = fixture("ipc-lock");
    let first_id = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    let mut first = Running::spawn(&dir, first_id, std::process::id());
    let mut client = connect(first_id).await;
    handshake(&mut client, first_id).await;

    let second_id = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
    let mut second = Running::spawn(&dir, second_id, std::process::id());
    let (status, stderr) = second.wait_exit(Duration::from_secs(8));
    assert!(!status.success());
    assert!(stderr.contains("locked by another instance"));
    assert!(!stderr.contains("ipc-lock-secret"));

    write_frame(
        &mut client,
        &json!({"v": 1, "type": "request", "id": "still-alive", "method": "status", "params": {}}),
    )
    .await;
    let status_body = read_frame(&mut client).await;
    assert_eq!(status_body["ok"], true);
    write_frame(
        &mut client,
        &json!({"v": 1, "type": "request", "id": "stop", "method": "bridge.shutdown", "params": {}}),
    )
    .await;
    let _ = read_frame(&mut client).await;
    let _ = first.wait_exit(Duration::from_secs(8));
}

#[tokio::test(flavor = "current_thread")]
async fn parent_exit_and_foreign_client_do_not_keep_the_lock() {
    let dir = fixture("ipc-parent");
    let mut parent = Command::new("ping.exe")
        .args(["-n", "40", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("parent sleeper");
    let instance = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    let mut running = Running::spawn(&dir, instance, parent.id());
    let mut client = connect(instance).await;
    let mut buf = [0_u8; 32];
    let read = tokio::time::timeout(Duration::from_secs(2), client.read(&mut buf)).await;
    match read {
        Ok(Ok(0)) | Ok(Err(_)) => {}
        Err(_) => panic!("foreign client was not disconnected"),
        Ok(Ok(size)) => panic!("foreign client received {size} bytes"),
    }
    assert!(running.child.try_wait().unwrap().is_none());
    let _ = parent.kill();
    let _ = parent.wait();
    let _ = running.wait_exit(Duration::from_secs(8));

    let instance_b = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
    let mut restarted = Running::spawn(&dir, instance_b, std::process::id());
    let mut client = connect(instance_b).await;
    handshake(&mut client, instance_b).await;
    write_frame(
        &mut client,
        &json!({"v": 1, "type": "request", "id": "stop", "method": "bridge.shutdown", "params": {}}),
    )
    .await;
    let _ = read_frame(&mut client).await;
    let _ = restarted.wait_exit(Duration::from_secs(8));
}
