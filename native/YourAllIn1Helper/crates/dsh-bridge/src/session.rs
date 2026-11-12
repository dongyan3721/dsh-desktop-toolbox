//! One client session over a byte stream. The named-pipe server and in-process tests share this.

use std::collections::{HashSet, VecDeque};

use serde::Serialize;
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, watch, Mutex};
use tokio::task::JoinHandle;

use crate::protocol::{encode_frame, parse_message, ClientMessage, FrameDecoder, ProtocolFault};
use crate::service::{BridgeFailure, BridgeService, CallResult, CancelFlag};

const READ_CHUNK: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStop {
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

struct ActiveRequest {
    id: String,
    cancel: CancelFlag,
    handle: JoinHandle<CallResult>,
}

pub async fn serve_connection<R, W>(
    reader: R,
    mut writer: W,
    service: std::sync::Arc<Mutex<BridgeService>>,
    instance_id: String,
    mut parent_exit: watch::Receiver<bool>,
) -> SessionStop
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin,
{
    let (tx, mut rx) = mpsc::unbounded_channel();
    tokio::spawn(read_frames(reader, tx));
    let mut pending: VecDeque<ClientMessage> = VecDeque::new();
    let mut active: Option<ActiveRequest> = None;
    let mut early_cancels: HashSet<String> = HashSet::new();
    let mut handshake = false;

    loop {
        if *parent_exit.borrow() {
            finish_active(&mut active).await;
            return SessionStop::ParentExited;
        }
        if let Some(stop) = pump(
            &mut pending,
            &mut active,
            &mut early_cancels,
            &mut writer,
            &service,
            &instance_id,
            &mut handshake,
        )
        .await
        {
            finish_active(&mut active).await;
            return stop;
        }

        let exit_cancel = active.as_ref().map(|job| job.cancel.clone());
        let busy = active.is_some();
        let finished = async {
            match active.as_mut() {
                Some(job) => (&mut job.handle).await,
                None => std::future::pending().await,
            }
        };
        tokio::pin!(finished);
        tokio::select! {
            biased;
            changed = parent_exit.changed() => {
                if changed.is_err() || *parent_exit.borrow() {
                    if let Some(flag) = exit_cancel {
                        flag.cancel();
                    }
                    break;
                }
            }
            incoming = rx.recv() => {
                match incoming {
                    Some(ReaderEvent::Batch(messages)) => pending.extend(messages),
                    Some(ReaderEvent::Fault(fault)) => {
                        eprintln!(
                            "dsh-toolbox-native: closing connection after a protocol fault ({})",
                            protocol_fault_name(&fault)
                        );
                        finish_active(&mut active).await;
                        return SessionStop::ProtocolFault;
                    }
                    Some(ReaderEvent::Eof) | None => {
                        finish_active(&mut active).await;
                        return SessionStop::Disconnected;
                    }
                }
            }
            result = &mut finished, if busy => {
                let job = active.take().expect("active request");
                let result = result.unwrap_or_else(|_| {
                    CallResult::Failure(BridgeFailure::internal("request task stopped"))
                });
                if let Some(stop) = write_call_result(&mut writer, &job.id, result).await {
                    return stop;
                }
            }
        }
    }
    finish_active(&mut active).await;
    SessionStop::ParentExited
}

async fn read_frames<R>(mut reader: R, tx: mpsc::UnboundedSender<ReaderEvent>)
where
    R: AsyncRead + Unpin,
{
    let mut decoder = FrameDecoder::default();
    let mut buf = vec![0_u8; READ_CHUNK];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => {
                let _ = tx.send(ReaderEvent::Eof);
                return;
            }
            Ok(size) => match decoder.push(&buf[..size]) {
                Err(fault) => {
                    let _ = tx.send(ReaderEvent::Fault(fault));
                    return;
                }
                Ok(frames) => {
                    let mut batch = Vec::with_capacity(frames.len());
                    for frame in frames {
                        match parse_message(&frame) {
                            Ok(message) => batch.push(message),
                            Err(fault) => {
                                if !batch.is_empty() {
                                    let _ = tx.send(ReaderEvent::Batch(batch));
                                }
                                let _ = tx.send(ReaderEvent::Fault(fault));
                                return;
                            }
                        }
                    }
                    if !batch.is_empty() && tx.send(ReaderEvent::Batch(batch)).is_err() {
                        return;
                    }
                }
            },
        }
    }
}

async fn pump<W>(
    pending: &mut VecDeque<ClientMessage>,
    active: &mut Option<ActiveRequest>,
    early_cancels: &mut HashSet<String>,
    writer: &mut W,
    service: &std::sync::Arc<Mutex<BridgeService>>,
    instance_id: &str,
    handshake: &mut bool,
) -> Option<SessionStop>
where
    W: AsyncWrite + Unpin,
{
    let mut outgoing: Vec<Vec<u8>> = Vec::new();
    let stop = collect_outgoing(
        pending,
        active,
        early_cancels,
        service,
        instance_id,
        handshake,
        &mut outgoing,
    );
    for frame in outgoing {
        if writer.write_all(&frame).await.is_err() {
            return Some(SessionStop::Disconnected);
        }
    }
    if writer.flush().await.is_err() {
        return Some(SessionStop::Disconnected);
    }
    stop
}

fn collect_outgoing(
    pending: &mut VecDeque<ClientMessage>,
    active: &mut Option<ActiveRequest>,
    early_cancels: &mut HashSet<String>,
    service: &std::sync::Arc<Mutex<BridgeService>>,
    instance_id: &str,
    handshake: &mut bool,
    outgoing: &mut Vec<Vec<u8>>,
) -> Option<SessionStop> {
    loop {
        if let Some(job) = active.as_ref() {
            if let Some(position) = pending
                .iter()
                .position(|message| matches!(message, ClientMessage::Cancel { id } if id == &job.id))
            {
                pending.remove(position);
                job.cancel.cancel();
            }
        }
        let Some(front) = pending.front() else {
            return None;
        };
        match front {
            ClientMessage::Hello { .. } if *handshake => {
                return Some(SessionStop::ProtocolFault);
            }
            ClientMessage::Hello { instance_id: hello_id } => {
                let hello_id = hello_id.clone();
                pending.pop_front();
                if hello_id != instance_id {
                    return Some(SessionStop::ProtocolFault);
                }
                *handshake = true;
                let Ok(guard) = service.try_lock() else {
                    return Some(SessionStop::ProtocolFault);
                };
                let capabilities = guard.capabilities();
                drop(guard);
                if push_json(
                    outgoing,
                    &json!({
                        "v": 1,
                        "type": "ready",
                        "instanceId": instance_id,
                        "capabilities": capabilities,
                    }),
                )
                .is_err()
                {
                    return Some(SessionStop::ProtocolFault);
                }
            }
            ClientMessage::Cancel { id } => {
                let id = id.clone();
                pending.pop_front();
                if active.as_ref().is_some_and(|job| job.id == id) {
                    if let Some(job) = active.as_ref() {
                        job.cancel.cancel();
                    }
                } else {
                    early_cancels.insert(id);
                }
            }
            ClientMessage::Request { .. } if !*handshake => {
                return Some(SessionStop::ProtocolFault);
            }
            ClientMessage::Request { id, .. } if active.as_ref().is_some_and(|job| job.id == *id) => {
                return Some(SessionStop::ProtocolFault);
            }
            ClientMessage::Request { .. } if active.is_some() => return None,
            ClientMessage::Request { id, method, params } => {
                let id = id.clone();
                let method = method.clone();
                let params = params.clone();
                pending.pop_front();
                if id.is_empty() || id.chars().count() > 128 || id.chars().any(|ch| (ch as u32) < 0x20)
                {
                    if push_failure(
                        outgoing,
                        &id,
                        &BridgeFailure::new("INVALID_REQUEST", "request id is invalid"),
                    )
                    .is_err()
                    {
                        return Some(SessionStop::ProtocolFault);
                    }
                    continue;
                }
                if early_cancels.remove(&id)
                    || pending.iter().any(|message| {
                        matches!(message, ClientMessage::Cancel { id: cancel_id } if cancel_id == &id)
                    })
                {
                    pending.retain(|message| {
                        !matches!(message, ClientMessage::Cancel { id: cancel_id } if cancel_id == &id)
                    });
                    if push_failure(outgoing, &id, &BridgeFailure::cancelled()).is_err() {
                        return Some(SessionStop::ProtocolFault);
                    }
                    continue;
                }
                let cancel = CancelFlag::new();
                let task_cancel = cancel.clone();
                let task_service = std::sync::Arc::clone(service);
                let handle = tokio::spawn(async move {
                    if task_cancel.is_cancelled() {
                        return CallResult::Failure(BridgeFailure::cancelled());
                    }
                    let result = tokio::task::spawn_blocking(move || {
                        let mut guard = task_service.blocking_lock();
                        if task_cancel.is_cancelled() {
                            return CallResult::Failure(BridgeFailure::cancelled());
                        }
                        guard.call(&method, &params, &task_cancel)
                    })
                    .await;
                    result.unwrap_or_else(|_| {
                        CallResult::Failure(BridgeFailure::internal("request task stopped"))
                    })
                });
                *active = Some(ActiveRequest { id, cancel, handle });
            }
        }
    }
}

async fn write_call_result<W>(writer: &mut W, id: &str, result: CallResult) -> Option<SessionStop>
where
    W: AsyncWrite + Unpin,
{
    let (payload, stop) = match result {
        CallResult::Reply(value) => (
            json!({"v": 1, "type": "response", "id": id, "ok": true, "result": value}),
            None,
        ),
        CallResult::Failure(failure) => (
            json!({
                "v": 1,
                "type": "response",
                "id": id,
                "ok": false,
                "error": {"code": failure.code, "message": failure.message}
            }),
            None,
        ),
        CallResult::Stop(value) => (
            json!({"v": 1, "type": "response", "id": id, "ok": true, "result": value}),
            Some(SessionStop::Shutdown),
        ),
    };
    let frame = match encode_json(&payload) {
        Ok(frame) => frame,
        Err(_) => return Some(SessionStop::ProtocolFault),
    };
    if writer.write_all(&frame).await.is_err() {
        return Some(SessionStop::Disconnected);
    }
    if stop.is_some() {
        let _ = writer.shutdown().await;
        return stop;
    }
    let _ = writer.flush().await;
    None
}

async fn finish_active(active: &mut Option<ActiveRequest>) {
    if let Some(job) = active.take() {
        job.cancel.cancel();
        let _ = job.handle.await;
    }
}

fn push_failure(outgoing: &mut Vec<Vec<u8>>, id: &str, failure: &BridgeFailure) -> Result<(), ()> {
    push_json(
        outgoing,
        &json!({
            "v": 1,
            "type": "response",
            "id": id,
            "ok": false,
            "error": {"code": failure.code, "message": failure.message}
        }),
    )
}

fn push_json(outgoing: &mut Vec<Vec<u8>>, value: &impl Serialize) -> Result<(), ()> {
    outgoing.push(encode_json(value)?);
    Ok(())
}

fn encode_json(value: &impl Serialize) -> Result<Vec<u8>, ()> {
    let bytes = serde_json::to_vec(value).map_err(|_| ())?;
    encode_frame(&bytes).map_err(|_| ())
}

fn protocol_fault_name(fault: &ProtocolFault) -> &'static str {
    match fault {
        ProtocolFault::EmptyFrame => "empty-frame",
        ProtocolFault::OversizeFrame => "oversize-frame",
        ProtocolFault::BadUtf8 => "bad-utf8",
        ProtocolFault::BadJson => "bad-json",
        ProtocolFault::VersionMismatch => "version-mismatch",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::BridgeService;
    use serde_json::json;
    use tokio::io::duplex;

    fn fixture(name: &str) -> std::path::PathBuf {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(4)
            .unwrap()
            .join(".tmp")
            .join("dsh-bridge-tests")
            .join(name);
        if root.exists() {
            std::fs::remove_dir_all(&root).unwrap();
        }
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    async fn read_frame(reader: &mut (impl AsyncRead + Unpin)) -> serde_json::Value {
        let mut len_buf = [0_u8; 4];
        reader.read_exact(&mut len_buf).await.unwrap();
        let len = u32::from_le_bytes(len_buf) as usize;
        let mut body = vec![0_u8; len];
        reader.read_exact(&mut body).await.unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    #[tokio::test(flavor = "current_thread")]
    async fn coalesced_cancel_does_not_persist_a_note() {
        let dir = fixture("cancel");
        let service = std::sync::Arc::new(Mutex::new(BridgeService::open(&dir).unwrap()));
        let (client, server) = duplex(64 * 1024);
        let (server_read, server_write) = tokio::io::split(server);
        let (parent_tx, parent_rx) = watch::channel(false);
        let instance = "11111111-1111-4111-8111-111111111111".to_string();
        let server_task = tokio::spawn(serve_connection(
            server_read,
            server_write,
            std::sync::Arc::clone(&service),
            instance.clone(),
            parent_rx,
        ));
        let (mut client_read, mut client_write) = tokio::io::split(client);
        let hello = encode_json(&json!({"v": 1, "type": "hello", "instanceId": instance})).unwrap();
        client_write.write_all(&hello).await.unwrap();
        let ready = read_frame(&mut client_read).await;
        assert_eq!(ready["type"], "ready");
        assert!(!ready["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|cap| cap == "media.convert_image"));

        let request = encode_json(&json!({
            "v": 1,
            "type": "request",
            "id": "create-1",
            "method": "notes.create",
            "params": {"title": "Cancelled", "content_md": "should-not-persist", "open": false}
        }))
        .unwrap();
        let cancel = encode_json(&json!({"v": 1, "type": "cancel", "id": "create-1"})).unwrap();
        let mut coalesced = request;
        coalesced.extend_from_slice(&cancel);
        client_write.write_all(&coalesced).await.unwrap();
        let response = read_frame(&mut client_read).await;
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "CANCELLED");

        let search = encode_json(&json!({
            "v": 1,
            "type": "request",
            "id": "search-1",
            "method": "notes.search",
            "params": {"query": "should-not-persist", "limit": 5, "offset": 0}
        }))
        .unwrap();
        client_write.write_all(&search).await.unwrap();
        let found = read_frame(&mut client_read).await;
        assert_eq!(found["ok"], true);
        assert_eq!(found["result"]["total"], 0);
        drop(parent_tx);
        let _ = server_task.await;
    }
}
