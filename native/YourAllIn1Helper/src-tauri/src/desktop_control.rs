//! Private desktop control pipe. Human host commands only; not an Agent tool surface.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use dsh_bridge::transport::{
    encode_frame, parse_message, ClientMessage, FrameDecoder, ProtocolFault, PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, watch};

use crate::plugin_launch::DESKTOP_CAPABILITIES;

const READ_CHUNK: usize = 64 * 1024;
const MAX_INBOUND_BATCHES: usize = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlError {
    pub code: &'static str,
    pub message: String,
}

impl ControlError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn cancelled() -> Self {
        Self::new("CANCELLED", "request was cancelled before it changed any desktop state")
    }
}

pub trait DesktopControl: Send + Sync {
    fn status(&self) -> Value;
    fn show_main(&self, cancel: &AtomicBool) -> Result<Value, ControlError>;
    fn open_panel(&self, module_id: &str, cancel: &AtomicBool) -> Result<Value, ControlError>;
    fn shutdown(&self, cancel: &AtomicBool) -> Result<Value, ControlError>;
    fn finish_accepted_shutdown(&self) {}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlStop {
    Shutdown,
    Disconnected,
    ProtocolFault,
    ParentExited,
}

enum ReaderEvent {
    Batch(Vec<ClientMessage>),
    Fault(ProtocolFault),
    Eof,
}

pub async fn serve_desktop_control<R, W, C>(
    reader: R,
    writer: W,
    control: Arc<C>,
    instance_id: String,
    parent_exit: watch::Receiver<bool>,
    mut runtime_ready: watch::Receiver<bool>,
) -> ControlStop
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin,
    C: DesktopControl + 'static,
{
    let (tx, mut rx) = mpsc::channel(MAX_INBOUND_BATCHES);
    let mut reader_task = Some(tokio::spawn(read_frames(reader, tx)));
    let mut writer = writer;
    let mut parent_exit = parent_exit;
    let mut pending: VecDeque<ClientMessage> = VecDeque::new();
    let mut handshake = false;
    let mut ready_sent = false;

    let stop = 'session: loop {
        if *parent_exit.borrow() {
            break 'session parent_stop(control.as_ref());
        }
        match accept_hello(&mut pending, &instance_id, &mut handshake) {
            Ok(()) => {}
            Err(stop) => break 'session stop,
        }
        if !ready_sent && handshake && *runtime_ready.borrow() {
            if let Err(stop) = write_ready(&mut writer, &instance_id, &mut parent_exit).await {
                break 'session stop;
            }
            ready_sent = true;
        }
        if ready_sent {
            if let Some(stop) = dispatch_pending(
                &mut pending,
                control.as_ref(),
                &mut writer,
                &mut parent_exit,
            )
            .await
            {
                break 'session stop;
            }
        }

        tokio::select! {
            biased;
            changed = parent_exit.changed() => {
                if changed.is_err() || *parent_exit.borrow() {
                    break 'session parent_stop(control.as_ref());
                }
            }
            changed = runtime_ready.changed(), if handshake && !ready_sent => {
                if changed.is_err() {
                    break 'session ControlStop::Disconnected;
                }
            }
            incoming = rx.recv() => {
                match incoming {
                    Some(ReaderEvent::Batch(messages)) => pending.extend(messages),
                    Some(ReaderEvent::Fault(fault)) => {
                        tracing::warn!(error = ?fault, "desktop control frame was rejected");
                        break 'session ControlStop::ProtocolFault;
                    }
                    Some(ReaderEvent::Eof) | None => break 'session ControlStop::Disconnected,
                }
            }
        }
    };
    if let Some(task) = reader_task.take() {
        task.abort();
        let _ = task.await;
    }
    stop
}

fn accept_hello(
    pending: &mut VecDeque<ClientMessage>,
    instance_id: &str,
    handshake: &mut bool,
) -> Result<(), ControlStop> {
    let front_is_hello = matches!(pending.front(), Some(ClientMessage::Hello { .. }));
    if *handshake {
        return if front_is_hello {
            Err(ControlStop::ProtocolFault)
        } else {
            Ok(())
        };
    }
    let matches_instance = matches!(
        pending.front(),
        Some(ClientMessage::Hello { instance_id: claimed }) if claimed == instance_id
    );
    if matches_instance {
        pending.pop_front();
        *handshake = true;
        return Ok(());
    }
    if pending.front().is_some() {
        return Err(ControlStop::ProtocolFault);
    }
    Ok(())
}

fn parent_stop(control: &impl DesktopControl) -> ControlStop {
    let cancel = AtomicBool::new(false);
    match control.shutdown(&cancel) {
        Ok(_) => {
            control.finish_accepted_shutdown();
            ControlStop::ParentExited
        }
        Err(_) => ControlStop::ParentExited,
    }
}

async fn dispatch_pending<W, C>(
    pending: &mut VecDeque<ClientMessage>,
    control: &C,
    writer: &mut W,
    parent_exit: &mut watch::Receiver<bool>,
) -> Option<ControlStop>
where
    W: AsyncWrite + Unpin,
    C: DesktopControl,
{
    while let Some(message) = pending.pop_front() {
        match message {
            ClientMessage::Hello { .. } => return Some(ControlStop::ProtocolFault),
            ClientMessage::Cancel { .. } => {}
            ClientMessage::Request { id, method, params } => {
                let cancelled = pending.iter().any(|message| {
                    matches!(message, ClientMessage::Cancel { id: cancel_id } if cancel_id == &id)
                });
                pending.retain(|message| {
                    !matches!(message, ClientMessage::Cancel { id: cancel_id } if cancel_id == &id)
                });
                if cancelled {
                    if let Some(stop) = write_failure(writer, &id, &ControlError::cancelled(), parent_exit).await {
                        return Some(stop);
                    }
                    continue;
                }
                let cancel = AtomicBool::new(false);
                let result = call_method(control, &method, &params, &cancel);
                match result {
                    Ok(value) if method == "desktop.shutdown" => {
                        let _ = write_success(writer, &id, &value, parent_exit).await;
                        control.finish_accepted_shutdown();
                        return Some(ControlStop::Shutdown);
                    }
                    Ok(value) => {
                        if let Some(stop) = write_success(writer, &id, &value, parent_exit).await {
                            return Some(stop);
                        }
                    }
                    Err(error) => {
                        if let Some(stop) = write_failure(writer, &id, &error, parent_exit).await {
                            return Some(stop);
                        }
                    }
                }
            }
        }
    }
    None
}

fn call_method(
    control: &impl DesktopControl,
    method: &str,
    params: &Value,
    cancel: &AtomicBool,
) -> Result<Value, ControlError> {
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    match method {
        "status" => {
            require_empty(params)?;
            Ok(control.status())
        }
        "desktop.show_main" => {
            require_empty(params)?;
            control.show_main(cancel)
        }
        "desktop.open_panel" => {
            let module_id = required_module_id(params)?;
            control.open_panel(module_id, cancel)
        }
        "desktop.shutdown" => {
            require_empty(params)?;
            let value = control.shutdown(cancel)?;
            if value.get("stopping").and_then(Value::as_bool) != Some(true) {
                return Err(ControlError::new(
                    "INTERNAL",
                    "desktop shutdown was not accepted",
                ));
            }
            Ok(value)
        }
        _ => Err(ControlError::new("UNSUPPORTED", "method is not a desktop control")),
    }
}

fn require_empty(params: &Value) -> Result<(), ControlError> {
    match params.as_object() {
        Some(map) if map.is_empty() => Ok(()),
        _ => Err(ControlError::new("INVALID_REQUEST", "params must be an empty object")),
    }
}

fn required_module_id(params: &Value) -> Result<&str, ControlError> {
    let map = params.as_object().ok_or_else(|| {
        ControlError::new("INVALID_REQUEST", "params must be an object")
    })?;
    if map.len() != 1 || !map.contains_key("module_id") {
        return Err(ControlError::new(
            "INVALID_REQUEST",
            "open_panel accepts only module_id",
        ));
    }
    map.get("module_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "module_id must be a string"))
}

async fn write_ready<W: AsyncWrite + Unpin>(
    writer: &mut W,
    instance_id: &str,
    parent_exit: &mut watch::Receiver<bool>,
) -> Result<(), ControlStop> {
    write_json(
        writer,
        &json!({
            "v": PROTOCOL_VERSION,
            "type": "ready",
            "instanceId": instance_id,
            "capabilities": DESKTOP_CAPABILITIES,
        }),
        parent_exit,
    )
    .await
}

async fn write_success<W: AsyncWrite + Unpin>(
    writer: &mut W,
    id: &str,
    result: &Value,
    parent_exit: &mut watch::Receiver<bool>,
) -> Option<ControlStop> {
    write_json(
        writer,
        &json!({
            "v": PROTOCOL_VERSION,
            "type": "response",
            "id": id,
            "ok": true,
            "result": result,
        }),
        parent_exit,
    )
    .await
    .err()
}

async fn write_failure<W: AsyncWrite + Unpin>(
    writer: &mut W,
    id: &str,
    error: &ControlError,
    parent_exit: &mut watch::Receiver<bool>,
) -> Option<ControlStop> {
    write_json(
        writer,
        &json!({
            "v": PROTOCOL_VERSION,
            "type": "response",
            "id": id,
            "ok": false,
            "error": {"code": error.code, "message": error.message},
        }),
        parent_exit,
    )
    .await
    .err()
}

async fn write_json<W: AsyncWrite + Unpin>(
    writer: &mut W,
    value: &Value,
    parent_exit: &mut watch::Receiver<bool>,
) -> Result<(), ControlStop> {
    let bytes = serde_json::to_vec(value).map_err(|_| ControlStop::ProtocolFault)?;
    let frame = encode_frame(&bytes).map_err(|_| ControlStop::ProtocolFault)?;
    tokio::select! {
        biased;
        changed = parent_exit.changed() => {
            if changed.is_err() || *parent_exit.borrow() {
                Err(ControlStop::ParentExited)
            } else {
                writer.write_all(&frame).await.map_err(|_| ControlStop::Disconnected)?;
                writer.flush().await.map_err(|_| ControlStop::Disconnected)
            }
        }
        result = writer.write_all(&frame) => {
            result.map_err(|_| ControlStop::Disconnected)?;
            writer.flush().await.map_err(|_| ControlStop::Disconnected)
        }
    }
}

async fn read_frames<R>(mut reader: R, tx: mpsc::Sender<ReaderEvent>)
where
    R: AsyncRead + Unpin,
{
    let mut decoder = FrameDecoder::default();
    let mut buf = vec![0_u8; READ_CHUNK];
    loop {
        let event = match reader.read(&mut buf).await {
            Ok(0) | Err(_) => ReaderEvent::Eof,
            Ok(size) => match decoder.push(&buf[..size]) {
                Err(fault) => ReaderEvent::Fault(fault),
                Ok(frames) => {
                    let mut batch = Vec::new();
                    let mut fault = None;
                    for frame in frames {
                        match parse_message(&frame) {
                            Ok(message) => batch.push(message),
                            Err(error) => {
                                fault = Some(error);
                                break;
                            }
                        }
                    }
                    if !batch.is_empty() && tx.send(ReaderEvent::Batch(batch)).await.is_err() {
                        return;
                    }
                    if let Some(fault) = fault {
                        ReaderEvent::Fault(fault)
                    } else {
                        continue;
                    }
                }
            },
        };
        let _ = tx.send(event).await;
        return;
    }
}

#[cfg(test)]
fn shutdown_was_accepted(result: &Result<Value, ControlError>) -> bool {
    matches!(result, Ok(value) if value.get("stopping").and_then(Value::as_bool) == Some(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Mutex;
    use tokio::io::duplex;
    use tokio::task::JoinHandle;

    struct FakeDesktop {
        opens: Mutex<Vec<String>>,
        fail_shutdown: bool,
        panels: Mutex<Vec<String>>,
        shutdowns: AtomicUsize,
        finishes: AtomicUsize,
    }

    impl DesktopControl for FakeDesktop {
        fn status(&self) -> Value {
            json!({
                "protocolVersion": 1,
                "nativeVersion": "test",
                "capabilities": DESKTOP_CAPABILITIES,
                "modules": [{"id": "sticky_note", "enabled": true}],
                "desktop": true
            })
        }

        fn show_main(&self, cancel: &AtomicBool) -> Result<Value, ControlError> {
            if cancel.load(Ordering::Acquire) {
                return Err(ControlError::cancelled());
            }
            self.opens.lock().unwrap().push("main".into());
            Ok(json!({"opened": true}))
        }

        fn open_panel(&self, module_id: &str, _cancel: &AtomicBool) -> Result<Value, ControlError> {
            if module_id == "not-a-module" {
                return Err(ControlError::new("INVALID_REQUEST", "unknown feature panel"));
            }
            self.panels.lock().unwrap().push(module_id.to_string());
            Ok(json!({"opened": true}))
        }

        fn shutdown(&self, cancel: &AtomicBool) -> Result<Value, ControlError> {
            self.shutdowns.fetch_add(1, Ordering::SeqCst);
            if cancel.load(Ordering::Acquire) {
                return Err(ControlError::cancelled());
            }
            if self.fail_shutdown {
                return Err(ControlError::new(
                    "INTERNAL",
                    "desktop shutdown was not accepted",
                ));
            }
            Ok(json!({"stopping": true}))
        }

        fn finish_accepted_shutdown(&self) {
            self.finishes.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn fake(fail_shutdown: bool) -> Arc<FakeDesktop> {
        Arc::new(FakeDesktop {
            opens: Mutex::new(Vec::new()),
            fail_shutdown,
            panels: Mutex::new(Vec::new()),
            shutdowns: AtomicUsize::new(0),
            finishes: AtomicUsize::new(0),
        })
    }

    fn request(id: &str, method: &str, params: Value) -> Vec<u8> {
        encode_frame(
            &serde_json::to_vec(&json!({
                "v": 1,
                "type": "request",
                "id": id,
                "method": method,
                "params": params
            }))
            .unwrap(),
        )
        .unwrap()
    }

    async fn read_json(reader: &mut (impl AsyncRead + Unpin)) -> Value {
        let mut len_buf = [0_u8; 4];
        reader.read_exact(&mut len_buf).await.unwrap();
        let len = u32::from_le_bytes(len_buf) as usize;
        let mut body = vec![0_u8; len];
        reader.read_exact(&mut body).await.unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    async fn session(control: Arc<FakeDesktop>) -> (
        tokio::io::ReadHalf<tokio::io::DuplexStream>,
        tokio::io::WriteHalf<tokio::io::DuplexStream>,
        watch::Sender<bool>,
        watch::Sender<bool>,
        JoinHandle<ControlStop>,
    ) {
        let (client, server) = duplex(64 * 1024);
        let (server_read, server_write) = tokio::io::split(server);
        let (parent_tx, parent_rx) = watch::channel(false);
        let (ready_tx, ready_rx) = watch::channel(false);
        let task = tokio::spawn(serve_desktop_control(
            server_read,
            server_write,
            control,
            "11111111-1111-4111-8111-111111111111".into(),
            parent_rx,
            ready_rx,
        ));
        let (read, write) = tokio::io::split(client);
        (read, write, parent_tx, ready_tx, task)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn ready_waits_for_the_desktop_runtime_and_reuses_windows() {
        let control = fake(false);
        let (mut read, mut write, parent_tx, ready_tx, task) = session(Arc::clone(&control)).await;
        let hello = encode_frame(
            br#"{"v":1,"type":"hello","instanceId":"11111111-1111-4111-8111-111111111111"}"#,
        )
        .unwrap();
        write.write_all(&hello).await.unwrap();
        let early = tokio::time::timeout(std::time::Duration::from_millis(80), read_json(&mut read)).await;
        assert!(early.is_err(), "ready was sent before the desktop runtime");
        ready_tx.send(true).unwrap();
        let ready = read_json(&mut read).await;
        assert_eq!(ready["type"], "ready");
        assert_eq!(ready["capabilities"][0], "status");
        assert!(ready["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .all(|cap| cap.as_str().unwrap().starts_with("desktop.") || cap == "status"));

        write
            .write_all(&request("main", "desktop.show_main", json!({})))
            .await
            .unwrap();
        write
            .write_all(&request("main-again", "desktop.show_main", json!({})))
            .await
            .unwrap();
        let first = read_json(&mut read).await;
        let second = read_json(&mut read).await;
        assert_eq!(first["result"]["opened"], true);
        assert_eq!(second["result"]["opened"], true);
        assert_eq!(control.opens.lock().unwrap().len(), 2);

        write
            .write_all(&request("panel", "desktop.open_panel", json!({"module_id": "sticky_note"})))
            .await
            .unwrap();
        let panel = read_json(&mut read).await;
        assert_eq!(panel["ok"], true);
        drop(parent_tx);
        assert_eq!(task.await.unwrap(), ControlStop::ParentExited);
        assert_eq!(control.shutdowns.load(Ordering::SeqCst), 1);
        assert_eq!(control.finishes.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn same_batch_cancel_and_rejected_shutdown_do_not_claim_success() {
        let control = fake(true);
        let (mut read, mut write, _parent_tx, ready_tx, task) = session(Arc::clone(&control)).await;
        ready_tx.send(true).unwrap();
        let hello = encode_frame(
            br#"{"v":1,"type":"hello","instanceId":"11111111-1111-4111-8111-111111111111"}"#,
        )
        .unwrap();
        let cancel = encode_frame(br#"{"v":1,"type":"cancel","id":"show"}"#).unwrap();
        let show = request("show", "desktop.show_main", json!({}));
        let mut coalesced = hello;
        coalesced.extend_from_slice(&show);
        coalesced.extend_from_slice(&cancel);
        write.write_all(&coalesced).await.unwrap();
        let ready = read_json(&mut read).await;
        assert_eq!(ready["type"], "ready");
        let cancelled = read_json(&mut read).await;
        assert_eq!(cancelled["error"]["code"], "CANCELLED");
        assert!(control.opens.lock().unwrap().is_empty());

        write
            .write_all(&request("stop", "desktop.shutdown", json!({})))
            .await
            .unwrap();
        let rejected = read_json(&mut read).await;
        assert_eq!(rejected["ok"], false);
        assert_eq!(rejected["error"]["code"], "INTERNAL");
        assert!(rejected.get("result").is_none());
        assert!(!shutdown_was_accepted(&Err(ControlError::new("INTERNAL", "no"))));
        assert_eq!(control.finishes.load(Ordering::SeqCst), 0);
        drop(task);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn parent_exit_does_not_finish_when_flush_is_rejected() {
        let control = fake(true);
        let (_read, _write, parent_tx, _ready_tx, task) = session(Arc::clone(&control)).await;
        drop(parent_tx);
        assert_eq!(task.await.unwrap(), ControlStop::ParentExited);
        assert_eq!(control.shutdowns.load(Ordering::SeqCst), 1);
        assert_eq!(control.finishes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn human_grant_command_is_not_a_control_method() {
        let control = fake(false);
        let error = call_method(
            control.as_ref(),
            "kernel_set_agent_access",
            &json!({"module_id": "clipboard", "allowed": true, "actor": "human"}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(error.code, "UNSUPPORTED");
        assert_eq!(control.opens.lock().unwrap().len(), 0);
    }
}
