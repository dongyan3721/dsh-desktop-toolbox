//! Human-window handshake for Agent note and ink calls. The pipe never accepts these commands.

use std::collections::HashMap;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::desktop_control::ControlError;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RESULT_BYTES: usize = 24 * 1024 * 1024;

#[derive(Clone)]
struct Session {
    id: String,
    kind: String,
    label: String,
    note_id: Option<String>,
}

struct Pending {
    session_id: String,
    operation: String,
    label: String,
    done: Option<Ack>,
}

#[derive(Clone)]
pub(crate) struct Ack {
    pub ok: bool,
    pub code: String,
    pub result: Value,
}

struct State {
    sessions: HashMap<String, Session>,
    pending: HashMap<String, Pending>,
}

pub(crate) struct AgentUi {
    state: Mutex<State>,
    wake: Condvar,
    timeout: Mutex<Duration>,
    emitter: Mutex<Option<std::sync::Arc<dyn Fn(&str, &str, Value) + Send + Sync>>>,
    pointer_active: std::sync::atomic::AtomicBool,
}

impl Default for AgentUi {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                sessions: HashMap::new(),
                pending: HashMap::new(),
            }),
            wake: Condvar::new(),
            timeout: Mutex::new(DEFAULT_TIMEOUT),
            emitter: Mutex::new(None),
            pointer_active: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl AgentUi {
    pub(crate) fn set_timeout_for_test(&self, timeout: Duration) {
        *self.timeout.lock().unwrap_or_else(|err| err.into_inner()) = timeout;
    }

    pub(crate) fn set_emitter(
        &self,
        emitter: std::sync::Arc<dyn Fn(&str, &str, Value) + Send + Sync>,
    ) {
        *self.emitter.lock().unwrap_or_else(|err| err.into_inner()) = Some(emitter);
    }

    pub(crate) fn set_pointer_active(&self, active: bool) {
        self.pointer_active
            .store(active, std::sync::atomic::Ordering::Release);
    }

    pub(crate) fn pointer_active(&self) -> bool {
        self.pointer_active
            .load(std::sync::atomic::Ordering::Acquire)
    }

    pub(crate) fn drop_label(&self, label: &str) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        state.sessions.retain(|_, session| session.label != label);
        for pending in state.pending.values_mut() {
            if pending.label == label && pending.done.is_none() {
                pending.done = Some(Ack {
                    ok: false,
                    code: "UNAVAILABLE".to_string(),
                    result: Value::Null,
                });
            }
        }
        self.wake.notify_all();
    }

    pub(crate) fn handle(
        &self,
        window_label: &str,
        cmd: &str,
        args: &Value,
    ) -> Result<Value, ControlError> {
        match cmd {
            "toolbox_agent_ui_ready" => self.ready(window_label, args),
            "toolbox_agent_ui_result" => self.finish(window_label, args),
            _ => Err(ControlError::new("UNSUPPORTED", "unknown agent ui command")),
        }
    }

    pub(crate) fn session_for_note(&self, note_id: &str) -> Option<String> {
        let state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        let label = format!("sticky-note-{note_id}");
        state.sessions.get(&label).and_then(|session| {
            if session.kind == "notes" && session.note_id.as_deref() == Some(note_id) {
                Some(session.id.clone())
            } else {
                None
            }
        })
    }

    pub(crate) fn session_for_ink(&self) -> Option<String> {
        let state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        state
            .sessions
            .get("screen-ink-canvas")
            .filter(|session| session.kind == "ink")
            .map(|session| session.id.clone())
    }

    pub(crate) fn roundtrip(
        &self,
        label: &str,
        session_id: &str,
        event: &str,
        operation: &str,
        fields: Map<String, Value>,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<Ack, ControlError> {
        let request_id = Uuid::new_v4().to_string();
        {
            let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
            let session = state.sessions.get(label).ok_or_else(|| {
                ControlError::new("UNAVAILABLE", "original window session is not ready")
            })?;
            if session.id != session_id {
                return Err(ControlError::new(
                    "UNAVAILABLE",
                    "original window session is not ready",
                ));
            }
            state.pending.insert(
                request_id.clone(),
                Pending {
                    session_id: session_id.to_string(),
                    operation: operation.to_string(),
                    label: label.to_string(),
                    done: None,
                },
            );
        }
        let mut payload = Map::new();
        payload.insert("request_id".to_string(), Value::String(request_id.clone()));
        payload.insert("session_id".to_string(), Value::String(session_id.to_string()));
        payload.insert("operation".to_string(), Value::String(operation.to_string()));
        for (key, value) in fields {
            payload.insert(key, value);
        }
        let emitter = self.emitter.lock().unwrap_or_else(|err| err.into_inner()).clone();
        let Some(emitter) = emitter else {
            self.fail_pending(&request_id);
            return Err(ControlError::new(
                "UNAVAILABLE",
                "original window is not connected",
            ));
        };
        emitter(label, event, Value::Object(payload));
        self.wait(&request_id, cancel)
    }

    fn ready(&self, window_label: &str, args: &Value) -> Result<Value, ControlError> {
        let map = object_exact(args, &["kind", "note_id"])?;
        let kind = match map.get("kind").and_then(Value::as_str) {
            Some("notes") => "notes",
            Some("ink") => "ink",
            _ => return Err(ControlError::new("INVALID_REQUEST", "kind is invalid")),
        };
        if kind == "ink" && map.contains_key("note_id") {
            return Err(ControlError::new("INVALID_REQUEST", "unexpected arguments"));
        }
        let note_id = if kind == "notes" {
            let note_id = match map.get("note_id").and_then(Value::as_str) {
                Some(id) if !id.is_empty() && id.chars().all(|ch| !ch.is_control()) => id.to_string(),
                _ => return Err(ControlError::new("INVALID_REQUEST", "note_id is invalid")),
            };
            let expected = format!("sticky-note-{note_id}");
            if window_label != expected {
                return Err(ControlError::new(
                    "INVALID_REQUEST",
                    "ready window does not match the note",
                ));
            }
            Some(note_id)
        } else if window_label != "screen-ink-canvas" {
            return Err(ControlError::new(
                "INVALID_REQUEST",
                "ready window is not the ink canvas",
            ));
        } else {
            None
        };
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        let session = Session {
            id: Uuid::new_v4().to_string(),
            kind: kind.to_string(),
            label: window_label.to_string(),
            note_id,
        };
        let id = session.id.clone();
        state.sessions.insert(window_label.to_string(), session);
        for pending in state.pending.values_mut() {
            if pending.label == window_label && pending.done.is_none() {
                pending.done = Some(Ack {
                    ok: false,
                    code: "UNAVAILABLE".to_string(),
                    result: Value::Null,
                });
            }
        }
        self.wake.notify_all();
        Ok(json!({ "session_id": id }))
    }

    fn finish(&self, window_label: &str, args: &Value) -> Result<Value, ControlError> {
        let map = object_exact(
            args,
            &["kind", "request_id", "session_id", "operation", "ok", "result", "error"],
        )?;
        let request_id = match map.get("request_id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => return Err(ControlError::new("INVALID_REQUEST", "request_id is invalid")),
        };
        let session_id = match map.get("session_id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => return Err(ControlError::new("INVALID_REQUEST", "session_id is invalid")),
        };
        let operation = match map.get("operation").and_then(Value::as_str) {
            Some(operation) if !operation.is_empty() && operation.len() <= 32 => operation.to_string(),
            _ => return Err(ControlError::new("INVALID_REQUEST", "operation is invalid")),
        };
        let ok = match map.get("ok").and_then(Value::as_bool) {
            Some(ok) => ok,
            None => return Err(ControlError::new("INVALID_REQUEST", "ok must be a boolean")),
        };
        let kind = match map.get("kind").and_then(Value::as_str) {
            Some("notes" | "ink") => map["kind"].as_str().unwrap().to_string(),
            _ => return Err(ControlError::new("INVALID_REQUEST", "kind is invalid")),
        };
        let code = match map.get("error") {
            None => String::new(),
            Some(Value::String(value)) if value == "BUSY" || value == "CONFLICT" => value.clone(),
            Some(_) => return Err(ControlError::new("INVALID_REQUEST", "error is invalid")),
        };
        let result = match map.get("result") {
            None => Value::Null,
            Some(value) => value.clone(),
        };
        if serde_json::to_vec(&result).map(|bytes| bytes.len()).unwrap_or(usize::MAX) > MAX_RESULT_BYTES {
            return Ok(json!({ "acknowledged": false }));
        }
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        let Some(session) = state.sessions.get(window_label) else {
            return Ok(json!({ "acknowledged": false }));
        };
        if session.kind != kind || session.id != session_id {
            return Ok(json!({ "acknowledged": false }));
        }
        let Some(pending) = state.pending.get_mut(&request_id) else {
            return Ok(json!({ "acknowledged": false }));
        };
        if pending.done.is_some()
            || pending.session_id != session_id
            || pending.operation != operation
            || pending.label != window_label
        {
            return Ok(json!({ "acknowledged": false }));
        }
        pending.done = Some(Ack { ok, code, result });
        self.wake.notify_all();
        Ok(json!({ "acknowledged": true }))
    }

    fn wait(
        &self,
        request_id: &str,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<Ack, ControlError> {
        let timeout = *self.timeout.lock().unwrap_or_else(|err| err.into_inner());
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        loop {
            if let Some(pending) = state.pending.get(request_id) {
                if pending.done.is_some() {
                    let pending = state.pending.remove(request_id).unwrap();
                    return Ok(pending.done.unwrap());
                }
            } else {
                return Err(ControlError::new("UNAVAILABLE", "handshake is no longer pending"));
            }
            if cancel.load(std::sync::atomic::Ordering::Acquire) {
                state.pending.remove(request_id);
                return Err(ControlError::cancelled());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                state.pending.remove(request_id);
                return Err(ControlError::new("UNAVAILABLE", "original window did not acknowledge in time"));
            }
            let slice = remaining.min(Duration::from_millis(50));
            let (guard, wait) = self
                .wake
                .wait_timeout(state, slice)
                .unwrap_or_else(|err| err.into_inner());
            state = guard;
            if wait.timed_out() && Instant::now() >= deadline {
                state.pending.remove(request_id);
                return Err(ControlError::new(
                    "UNAVAILABLE",
                    "original window did not acknowledge in time",
                ));
            }
        }
    }

    fn fail_pending(&self, request_id: &str) {
        let mut state = self.state.lock().unwrap_or_else(|err| err.into_inner());
        state.pending.remove(request_id);
    }
}

fn object_exact<'a>(params: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, ControlError> {
    let map = params
        .as_object()
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "params must be an object"))?;
    if map.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(ControlError::new("INVALID_REQUEST", "unexpected arguments"));
    }
    Ok(map)
}
