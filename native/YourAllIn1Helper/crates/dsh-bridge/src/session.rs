//! One client session over a byte stream. The named-pipe server and in-process tests share this.
//!
//! Resource bounds for one connection:
//! - 1 request runs at a time, so a mutation commits or returns `CANCELLED` before the next one starts.
//! - 16 requests may wait behind the running request. A further request gets `INVALID_REQUEST` and is not started.
//! - 32 unmatched cancellation ids are remembered. Older unmatched ids are dropped. Cancels for a running or queued request are kept.
//!
//! `CANCELLED` is sent only when no mutation has committed. After the database write, the terminal response is success even if cancel arrives while that write finishes. Parent exit, disconnect, and `bridge.shutdown` wait for the running call to finish before the session returns; the process then flushes the kernel. Requests still queued when shutdown or parent exit begins are rejected with `CANCELLED` and are not started.

use std::collections::{HashSet, VecDeque};

use serde::Serialize;
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, watch, Mutex};
use tokio::task::JoinHandle;

use crate::protocol::{encode_frame, parse_message, ClientMessage, FrameDecoder, ProtocolFault};
use crate::service::{BridgeFailure, BridgeService, CallResult, CancelFlag};

const READ_CHUNK: usize = 64 * 1024;
const MAX_QUEUED_REQUESTS: usize = 16;
const MAX_UNMATCHED_CANCELS: usize = 32;

struct CancelTable {
    unmatched_order: VecDeque<String>,
    unmatched: HashSet<String>,
    queued: HashSet<String>,
}

impl CancelTable {
    fn new() -> Self {
        Self {
            unmatched_order: VecDeque::new(),
            unmatched: HashSet::new(),
            queued: HashSet::new(),
        }
    }

    fn remember(&mut self, id: String, matches_queued_request: bool) {
        if self.queued.contains(&id) || self.unmatched.contains(&id) {
            if matches_queued_request {
                self.unmatched.remove(&id);
                self.unmatched_order.retain(|item| item != &id);
                self.queued.insert(id);
            }
            return;
        }
        if matches_queued_request {
            self.queued.insert(id);
            return;
        }
        while self.unmatched_order.len() >= MAX_UNMATCHED_CANCELS {
            if let Some(old) = self.unmatched_order.pop_front() {
                self.unmatched.remove(&old);
            }
        }
        self.unmatched.insert(id.clone());
        self.unmatched_order.push_back(id);
    }

    fn take(&mut self, id: &str) -> bool {
        let queued = self.queued.remove(id);
        let unmatched = self.unmatched.remove(id);
        if unmatched {
            self.unmatched_order.retain(|item| item != id);
        }
        queued || unmatched
    }
}

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
    let mut early_cancels = CancelTable::new();
    let mut handshake = false;

    loop {
        if *parent_exit.borrow() {
            return settle_parent(&mut active, &mut pending, &mut writer).await;
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
            drain_active(&mut active).await;
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
                    return settle_parent(&mut active, &mut pending, &mut writer).await;
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
                        drain_active(&mut active).await;
                        return SessionStop::ProtocolFault;
                    }
                    Some(ReaderEvent::Eof) | None => {
                        drain_active(&mut active).await;
                        return SessionStop::Disconnected;
                    }
                }
            }
            result = &mut finished, if busy => {
                let job = active.take().expect("active request");
                let result = result.unwrap_or_else(|_| {
                    CallResult::Failure(BridgeFailure::internal("request task stopped"))
                });
                if matches!(result, CallResult::Stop(_)) {
                    if let Some(stop) = reject_unstarted(&mut pending, &mut writer).await {
                        return stop;
                    }
                }
                if let Some(stop) = write_call_result(&mut writer, &job.id, result).await {
                    return stop;
                }
            }
        }
    }
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
    early_cancels: &mut CancelTable,
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
    early_cancels: &mut CancelTable,
    service: &std::sync::Arc<Mutex<BridgeService>>,
    instance_id: &str,
    handshake: &mut bool,
    outgoing: &mut Vec<Vec<u8>>,
) -> Option<SessionStop> {
    loop {
        if let Some(job) = active.as_ref() {
            if let Some(position) = pending.iter().position(|message| {
                matches!(message, ClientMessage::Cancel { id } if id == &job.id)
            }) {
                pending.remove(position);
                job.cancel.cancel();
            }
        }
        if duplicate_request(pending, active) {
            return Some(SessionStop::ProtocolFault);
        }
        if reject_queue_overflow(pending, active, outgoing).is_err() {
            return Some(SessionStop::ProtocolFault);
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
                    let matches_queued = pending.iter().any(|message| {
                        matches!(message, ClientMessage::Request { id: queued, .. } if queued == &id)
                    });
                    early_cancels.remember(id, matches_queued);
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
                if early_cancels.take(&id)
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

fn duplicate_request(pending: &VecDeque<ClientMessage>, active: &Option<ActiveRequest>) -> bool {
    let mut seen = HashSet::new();
    if let Some(job) = active {
        seen.insert(job.id.as_str());
    }
    for message in pending {
        if let ClientMessage::Request { id, .. } = message {
            if !seen.insert(id.as_str()) {
                return true;
            }
        }
    }
    false
}

fn reject_queue_overflow(
    pending: &mut VecDeque<ClientMessage>,
    active: &Option<ActiveRequest>,
    outgoing: &mut Vec<Vec<u8>>,
) -> Result<(), ()> {
    let allowance = if active.is_some() {
        MAX_QUEUED_REQUESTS
    } else {
        MAX_QUEUED_REQUESTS + 1
    };
    loop {
        let positions: Vec<usize> = pending
            .iter()
            .enumerate()
            .filter_map(|(index, message)| {
                matches!(message, ClientMessage::Request { .. }).then_some(index)
            })
            .collect();
        if positions.len() <= allowance {
            return Ok(());
        }
        let Some(ClientMessage::Request { id, .. }) = pending.remove(positions[positions.len() - 1])
        else {
            continue;
        };
        push_failure(
            outgoing,
            &id,
            &BridgeFailure::invalid("too many requests are already queued"),
        )?;
    }
}

async fn drain_active(active: &mut Option<ActiveRequest>) {
    if let Some(job) = active.take() {
        job.cancel.cancel();
        let _ = job.handle.await;
    }
}

async fn settle_parent<W>(
    active: &mut Option<ActiveRequest>,
    pending: &mut VecDeque<ClientMessage>,
    writer: &mut W,
) -> SessionStop
where
    W: AsyncWrite + Unpin,
{
    if let Some(job) = active.take() {
        job.cancel.cancel();
        let result = match job.handle.await {
            Ok(result) => result,
            Err(_) => CallResult::Failure(BridgeFailure::internal("request task stopped")),
        };
        let stopping = matches!(result, CallResult::Stop(_));
        if stopping {
            if reject_unstarted(pending, writer).await.is_some() {
                return SessionStop::Disconnected;
            }
        }
        if write_call_result(writer, &job.id, result).await.is_some() {
            return SessionStop::Disconnected;
        }
        if !stopping && reject_unstarted(pending, writer).await.is_some() {
            return SessionStop::Disconnected;
        }
        return SessionStop::ParentExited;
    }
    if reject_unstarted(pending, writer).await.is_some() {
        return SessionStop::Disconnected;
    }
    SessionStop::ParentExited
}

async fn reject_unstarted<W>(pending: &mut VecDeque<ClientMessage>, writer: &mut W) -> Option<SessionStop>
where
    W: AsyncWrite + Unpin,
{
    while let Some(message) = pending.pop_front() {
        let ClientMessage::Request { id, .. } = message else {
            continue;
        };
        let frame = match encode_json(&json!({
            "v": 1,
            "type": "response",
            "id": id,
            "ok": false,
            "error": {
                "code": "CANCELLED",
                "message": "request was cancelled before it changed any data"
            }
        })) {
            Ok(frame) => frame,
            Err(_) => return Some(SessionStop::ProtocolFault),
        };
        if writer.write_all(&frame).await.is_err() {
            return Some(SessionStop::Disconnected);
        }
    }
    if writer.flush().await.is_err() {
        return Some(SessionStop::Disconnected);
    }
    None
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

    struct SessionFixture {
        dir: std::path::PathBuf,
        service: std::sync::Arc<Mutex<BridgeService>>,
        barrier: std::sync::Arc<crate::service::CommitBarrier>,
        client_read: tokio::io::ReadHalf<tokio::io::DuplexStream>,
        client_write: tokio::io::WriteHalf<tokio::io::DuplexStream>,
        parent_tx: watch::Sender<bool>,
        server_task: tokio::task::JoinHandle<SessionStop>,
    }

    async fn start_session(name: &str) -> SessionFixture {
        let dir = fixture(name);
        let barrier = std::sync::Arc::new(crate::service::CommitBarrier::new());
        let service = std::sync::Arc::new(Mutex::new(BridgeService::open(&dir).unwrap()));
        service
            .try_lock()
            .expect("service lock")
            .set_commit_barrier(Some(std::sync::Arc::clone(&barrier)));
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
        client_write
            .write_all(
                &encode_json(&json!({"v": 1, "type": "hello", "instanceId": instance})).unwrap(),
            )
            .await
            .unwrap();
        let ready = read_frame(&mut client_read).await;
        assert_eq!(ready["type"], "ready");
        SessionFixture {
            dir,
            service,
            barrier,
            client_read,
            client_write,
            parent_tx,
            server_task,
        }
    }

    async fn wait_stage(
        barrier: &crate::service::CommitBarrier,
        stage: &'static str,
    ) -> crate::service::CancelFlag {
        let mut stages = barrier.stage();
        loop {
            if stages.borrow().as_deref() == Some(stage) {
                break;
            }
            stages.changed().await.expect("commit stage closed");
        }
        barrier
            .flag()
            .borrow()
            .clone()
            .expect("cancel flag published")
    }

    async fn wait_until_cancelled(flag: &crate::service::CancelFlag) {
        for _ in 0..100 {
            if flag.is_cancelled() {
                return;
            }
            tokio::task::yield_now().await;
        }
        panic!("cancellation was not applied to the running request");
    }

    fn request(id: &str, method: &str, params: serde_json::Value) -> Vec<u8> {
        encode_json(&json!({
            "v": 1,
            "type": "request",
            "id": id,
            "method": method,
            "params": params
        }))
        .unwrap()
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cancel_before_commit_does_not_persist() {
        let mut session = start_session("cancel-before").await;
        session.barrier.arm("before-commit");
        session
            .client_write
            .write_all(&request(
                "create-late-cancel",
                "notes.create",
                json!({"title": "Late", "content_md": "before-commit", "open": false}),
            ))
            .await
            .unwrap();
        let flag = wait_stage(&session.barrier, "before-commit").await;
        session
            .client_write
            .write_all(&encode_json(&json!({"v": 1, "type": "cancel", "id": "create-late-cancel"})).unwrap())
            .await
            .unwrap();
        wait_until_cancelled(&flag).await;
        session.barrier.release();
        let response = read_frame(&mut session.client_read).await;
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "CANCELLED");
        session
            .client_write
            .write_all(&request(
                "search-before",
                "notes.search",
                json!({"query": "before-commit"}),
            ))
            .await
            .unwrap();
        let found = read_frame(&mut session.client_read).await;
        assert_eq!(found["result"]["total"], 0);
        drop(session.parent_tx);
        let _ = session.server_task.await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cancel_after_commit_returns_the_write() {
        let mut session = start_session("cancel-after").await;
        session.barrier.arm("after-commit");
        session
            .client_write
            .write_all(&request(
                "create-committed",
                "notes.create",
                json!({"title": "Kept", "content_md": "after-commit", "open": false}),
            ))
            .await
            .unwrap();
        let flag = wait_stage(&session.barrier, "after-commit").await;
        session
            .client_write
            .write_all(&encode_json(&json!({"v": 1, "type": "cancel", "id": "create-committed"})).unwrap())
            .await
            .unwrap();
        wait_until_cancelled(&flag).await;
        session.barrier.release();
        let response = read_frame(&mut session.client_read).await;
        assert_eq!(response["ok"], true);
        assert_eq!(response["result"]["content_md"], "after-commit");
        session
            .client_write
            .write_all(&request(
                "search-after",
                "notes.search",
                json!({"query": "after-commit"}),
            ))
            .await
            .unwrap();
        let found = read_frame(&mut session.client_read).await;
        assert_eq!(found["result"]["total"], 1);
        drop(session.parent_tx);
        let _ = session.server_task.await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn parent_exit_reports_the_commit_outcome() {
        let mut session = start_session("parent-before").await;
        session.barrier.arm("before-commit");
        session
            .client_write
            .write_all(&request(
                "create-parent",
                "notes.create",
                json!({"title": "Parent", "content_md": "parent-before", "open": false}),
            ))
            .await
            .unwrap();
        let flag = wait_stage(&session.barrier, "before-commit").await;
        session.parent_tx.send(true).unwrap();
        wait_until_cancelled(&flag).await;
        session.barrier.release();
        let response = read_frame(&mut session.client_read).await;
        assert_eq!(response["error"]["code"], "CANCELLED");
        assert_eq!(session.server_task.await.unwrap(), SessionStop::ParentExited);
        let mut guard = session.service.try_lock().expect("service lock");
        let found = match guard.call(
            "notes.search",
            &json!({"query": "parent-before"}),
            &crate::service::CancelFlag::new(),
        ) {
            CallResult::Reply(value) => value,
            other => panic!("search failed: {other:?}"),
        };
        assert_eq!(found["total"], 0);
        drop(guard);

        let mut session = start_session("parent-after").await;
        session.barrier.arm("after-commit");
        session
            .client_write
            .write_all(&request(
                "create-parent-after",
                "notes.create",
                json!({"title": "Parent", "content_md": "parent-after", "open": false}),
            ))
            .await
            .unwrap();
        let flag = wait_stage(&session.barrier, "after-commit").await;
        session.parent_tx.send(true).unwrap();
        wait_until_cancelled(&flag).await;
        session.barrier.release();
        let response = read_frame(&mut session.client_read).await;
        assert_eq!(response["ok"], true);
        assert_eq!(response["result"]["content_md"], "parent-after");
        assert_eq!(session.server_task.await.unwrap(), SessionStop::ParentExited);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn request_queue_and_unmatched_cancels_are_bounded() {
        let mut session = start_session("bounds").await;
        session.barrier.arm("before-commit");
        session
            .client_write
            .write_all(&request(
                "held",
                "notes.create",
                json!({"title": "Held", "content_md": "held-note", "open": false}),
            ))
            .await
            .unwrap();
        let _flag = wait_stage(&session.barrier, "before-commit").await;
        let mut burst = Vec::new();
        for index in 1..=17 {
            burst.extend(request(
                &format!("bulk-{index}"),
                "notes.search",
                json!({"query": "missing-bulk"}),
            ));
        }
        session.client_write.write_all(&burst).await.unwrap();
        let rejected = read_frame(&mut session.client_read).await;
        assert_eq!(rejected["id"], "bulk-17");
        assert_eq!(rejected["error"]["code"], "INVALID_REQUEST");
        session.barrier.release();
        let created = read_frame(&mut session.client_read).await;
        assert_eq!(created["id"], "held");
        assert_eq!(created["ok"], true);
        for index in 1..=16 {
            let response = read_frame(&mut session.client_read).await;
            assert_eq!(response["id"], format!("bulk-{index}"));
            assert_eq!(response["ok"], true);
        }

        let mut cancels = Vec::new();
        for index in 0..=32 {
            cancels.extend(
                encode_json(&json!({"v": 1, "type": "cancel", "id": format!("old-{index}")})).unwrap(),
            );
        }
        cancels.extend(request("marker", "status", json!({})));
        session.client_write.write_all(&cancels).await.unwrap();
        let marker = read_frame(&mut session.client_read).await;
        assert_eq!(marker["id"], "marker");
        assert_eq!(marker["ok"], true);
        session
            .client_write
            .write_all(&request("old-0", "status", json!({})))
            .await
            .unwrap();
        let kept = read_frame(&mut session.client_read).await;
        assert_eq!(kept["id"], "old-0");
        assert_eq!(kept["ok"], true, "{kept}");
        session
            .client_write
            .write_all(&request("old-32", "status", json!({})))
            .await
            .unwrap();
        let dropped = read_frame(&mut session.client_read).await;
        assert_eq!(dropped["id"], "old-32");
        assert_eq!(dropped["error"]["code"], "CANCELLED");
        drop(session.parent_tx);
        let _ = session.server_task.await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn shutdown_finishes_the_committed_write_and_rejects_later_work() {
        let mut session = start_session("shutdown-drain").await;
        session
            .client_write
            .write_all(&request(
                "seed",
                "notes.create",
                json!({"title": "Seed", "content_md": "seed-note", "open": false}),
            ))
            .await
            .unwrap();
        let seeded = read_frame(&mut session.client_read).await;
        assert_eq!(seeded["ok"], true);
        let id = seeded["result"]["id"].as_str().unwrap().to_string();
        let token = seeded["result"]["updated_at"].as_i64().unwrap();
        session.barrier.arm("before-commit");
        session
            .client_write
            .write_all(&request(
                "update-1",
                "notes.update",
                json!({"id": id, "content_md": "drained", "expected_updated_at": token}),
            ))
            .await
            .unwrap();
        let _flag = wait_stage(&session.barrier, "before-commit").await;
        let mut tail = request("stop", "bridge.shutdown", json!({}));
        tail.extend(request(
            "too-late",
            "notes.create",
            json!({"title": "Late", "content_md": "too-late", "open": false}),
        ));
        session.client_write.write_all(&tail).await.unwrap();
        session.barrier.release();
        let updated = read_frame(&mut session.client_read).await;
        assert_eq!(updated["ok"], true);
        assert_eq!(updated["result"]["content_md"], "drained");
        let rejected = read_frame(&mut session.client_read).await;
        assert_eq!(rejected["id"], "too-late");
        assert_eq!(rejected["error"]["code"], "CANCELLED");
        let stopping = read_frame(&mut session.client_read).await;
        assert_eq!(stopping["result"]["stopping"], true);
        assert_eq!(session.server_task.await.unwrap(), SessionStop::Shutdown);
        let conn = rusqlite::Connection::open(session.dir.join("app.db")).unwrap();
        let drained: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sticky_notes WHERE content_md = 'drained'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let late: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sticky_notes WHERE content_md = 'too-late'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(drained, 1);
        assert_eq!(late, 0);
    }
}
