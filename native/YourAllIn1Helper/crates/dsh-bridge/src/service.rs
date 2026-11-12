//! Status and sticky-note operations on a real `AppKernel`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use app_core::{AppKernel, AppKernelBuilder, AppModule, CoreError, MODULE_CATALOG};
use mod_sticky_note::{StickyNoteModule, StickyNoteRecord};
use rusqlite::params;
use serde_json::{json, Map, Value};
use crate::protocol::{expected_pipe_name, PROTOCOL_VERSION};

const MAX_TITLE_CHARS: usize = 500;
const MAX_CONTENT_CHARS: usize = 1_048_576;
const MAX_QUERY_CHARS: usize = 200;
const MAX_ID_CHARS: usize = 80;
const MAX_SEARCH_LIMIT: u64 = 20;
const MAX_SEARCH_OFFSET: u64 = 10_000;
const DEFAULT_SEARCH_LIMIT: u64 = 20;
const DEFAULT_SEARCH_OFFSET: u64 = 0;
/// JavaScript `Number.MAX_SAFE_INTEGER`. Note tokens and other integers crossing the bridge stay inside it.
const JS_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Test hook that pauses a mutating call at one commit stage.
///
/// `before-commit` is immediately before the cancellation sample and the database write.
/// `after-commit` is after the write and the conflict token are durable.
#[cfg(test)]
#[derive(Clone)]
pub(crate) struct CommitBarrier {
    armed: Arc<std::sync::Mutex<Option<&'static str>>>,
    release: Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
    stage_tx: tokio::sync::watch::Sender<Option<&'static str>>,
    flag_tx: tokio::sync::watch::Sender<Option<CancelFlag>>,
    _stage_rx: tokio::sync::watch::Receiver<Option<&'static str>>,
    _flag_rx: tokio::sync::watch::Receiver<Option<CancelFlag>>,
}

#[cfg(test)]
impl CommitBarrier {
    pub(crate) fn new() -> Self {
        let (stage_tx, stage_rx) = tokio::sync::watch::channel(None);
        let (flag_tx, flag_rx) = tokio::sync::watch::channel(None);
        Self {
            armed: Arc::new(std::sync::Mutex::new(None)),
            release: Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new())),
            stage_tx,
            flag_tx,
            _stage_rx: stage_rx,
            _flag_rx: flag_rx,
        }
    }

    pub(crate) fn arm(&self, stage: &'static str) {
        *self.armed.lock().unwrap_or_else(|err| err.into_inner()) = Some(stage);
    }

    pub(crate) fn stage(&self) -> tokio::sync::watch::Receiver<Option<&'static str>> {
        self.stage_tx.subscribe()
    }

    pub(crate) fn flag(&self) -> tokio::sync::watch::Receiver<Option<CancelFlag>> {
        self.flag_tx.subscribe()
    }

    pub(crate) fn release(&self) {
        let (lock, condvar) = &*self.release;
        let mut released = lock.lock().unwrap_or_else(|err| err.into_inner());
        *released = true;
        condvar.notify_all();
    }

    fn checkpoint(&self, stage: &'static str, cancel: &CancelFlag) {
        if stage == "before-commit" {
            self.flag_tx.send_replace(Some(cancel.clone()));
        }
        let mut armed = self.armed.lock().unwrap_or_else(|err| err.into_inner());
        if *armed != Some(stage) {
            return;
        }
        *armed = None;
        drop(armed);
        self.stage_tx.send_replace(Some(stage));
        let (lock, condvar) = &*self.release;
        let mut released = lock.lock().unwrap_or_else(|err| err.into_inner());
        while !*released {
            released = condvar.wait(released).unwrap_or_else(|err| err.into_inner());
        }
        *released = false;
        self.stage_tx.send_replace(None);
    }
}

#[derive(Clone, Debug)]
pub struct CancelFlag {
    cancelled: Arc<AtomicBool>,
}

impl CancelFlag {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn as_atomic(&self) -> &AtomicBool {
        &self.cancelled
    }
}

#[derive(Debug)]
pub struct BridgeFailure {
    pub code: &'static str,
    pub message: String,
}

impl BridgeFailure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new("INVALID_REQUEST", message)
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self::new("UNSUPPORTED", message)
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new("INTERNAL", message)
    }

    pub fn cancelled() -> Self {
        Self::new(
            "CANCELLED",
            "request was cancelled before it changed any data",
        )
    }
}

#[derive(Debug)]
pub enum CallResult {
    Reply(Value),
    Failure(BridgeFailure),
    Stop(Value),
}

pub struct BridgeConfig {
    pub pipe_name: String,
    pub instance_id: String,
    pub data_dir: PathBuf,
    pub parent_pid: u32,
    #[allow(dead_code)]
    pub allow_read_roots: Vec<PathBuf>,
    #[allow(dead_code)]
    pub allow_write_roots: Vec<PathBuf>,
}

pub struct BridgeService {
    kernel: Option<AppKernel>,
    notes: Arc<StickyNoteModule>,
    gate: std::sync::Mutex<()>,
    read_roots: Vec<PathBuf>,
    write_roots: Vec<PathBuf>,
    #[cfg(test)]
    commit_barrier: Option<Arc<CommitBarrier>>,
}

impl BridgeService {
    #[cfg(test)]
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        Self::open_with_roots(data_dir, &[], &[])
    }

    pub(crate) fn open_with_roots(
        data_dir: &Path,
        read_roots: &[PathBuf],
        write_roots: &[PathBuf],
    ) -> Result<Self, String> {
        let data_dir = prepare_directory(data_dir, "data directory")?;
        let read_roots = canonicalize_roots(read_roots, "allow-read-root")?;
        let write_roots = canonicalize_roots(write_roots, "allow-write-root")?;
        let notes = Arc::new(StickyNoteModule::new());
        let module: Arc<dyn AppModule> = notes.clone();
        let kernel = AppKernelBuilder::new(data_dir)
            .register_module_arc(module)
            .and_then(|builder| builder.bootstrap())
            .map_err(|err| format!("kernel bootstrap failed: {}", safe_core_error(&err)))?;
        if kernel.context().window_pool.active_window_count() != 0 {
            return Err(
                "kernel opened a window during startup; the headless bridge refuses to continue"
                    .to_string(),
            );
        }
        Ok(Self {
            kernel: Some(kernel),
            notes,
            gate: std::sync::Mutex::new(()),
            read_roots,
            write_roots,
            #[cfg(test)]
            commit_barrier: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn set_commit_barrier(&mut self, barrier: Option<Arc<CommitBarrier>>) {
        self.commit_barrier = barrier;
    }

    /// Samples cancellation only at `before-commit`. A later cancel cannot turn a finished write into `CANCELLED`.
    fn checkpoint(&self, stage: &'static str, cancel: &CancelFlag) {
        #[cfg(test)]
        if let Some(barrier) = &self.commit_barrier {
            barrier.checkpoint(stage, cancel);
        }
        #[cfg(not(test))]
        {
            let _ = (stage, cancel);
        }
    }

    pub fn capabilities(&self) -> Vec<String> {
        let mut capabilities = vec!["status".to_string()];
        if self.notes_enabled() {
            capabilities.extend([
                "notes.create".to_string(),
                "notes.search".to_string(),
                "notes.update".to_string(),
            ]);
        }
        if self.image_conversion_available() {
            capabilities.push("media.convert_image".to_string());
        }
        capabilities.push("bridge.shutdown".to_string());
        capabilities
    }

    pub fn call(&mut self, method: &str, params: &Value, cancel: &CancelFlag) -> CallResult {
        if self.kernel.is_none() {
            return CallResult::Failure(BridgeFailure::internal("bridge is stopping"));
        }
        match method {
            "status" => self.status(params),
            "notes.create" => self.notes_create(params, cancel),
            "notes.search" => self.notes_search(params, cancel),
            "notes.update" => self.notes_update(params, cancel),
            "media.convert_image" => self.convert_image(params, cancel),
            "bridge.shutdown" => self.shutdown(params, cancel),
            _ => CallResult::Failure(BridgeFailure::unsupported("method is not supported")),
        }
    }

    fn status(&self, params: &Value) -> CallResult {
        if let Err(err) = require_empty_object(params) {
            return CallResult::Failure(err);
        }
        let modules = MODULE_CATALOG
            .iter()
            .map(|module| module_status(self, module.id))
            .collect::<Vec<_>>();
        CallResult::Reply(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "nativeVersion": env!("CARGO_PKG_VERSION"),
            "capabilities": self.capabilities(),
            "modules": modules,
        }))
    }

    fn notes_create(&mut self, params: &Value, cancel: &CancelFlag) -> CallResult {
        let map = match object(params) {
            Ok(map) => map,
            Err(err) => return CallResult::Failure(err),
        };
        if let Err(err) = reject_unknown(map, &["title", "content_md", "open"]) {
            return CallResult::Failure(err);
        }
        let title = match required_string(map, "title") {
            Ok(title) => title,
            Err(err) => return CallResult::Failure(err),
        };
        let content = match required_string(map, "content_md") {
            Ok(content) => content,
            Err(err) => return CallResult::Failure(err),
        };
        let open = match required_bool(map, "open") {
            Ok(open) => open,
            Err(err) => return CallResult::Failure(err),
        };
        if let Err(err) = validate_title(title) {
            return CallResult::Failure(err);
        }
        if let Err(err) = validate_text(content, MAX_CONTENT_CHARS, true) {
            return CallResult::Failure(err);
        }
        if open {
            return CallResult::Failure(BridgeFailure::unsupported(
                "opening a note window is not available in the headless bridge",
            ));
        }
        if !self.notes_enabled() {
            return CallResult::Failure(BridgeFailure::new(
                "DISABLED",
                "sticky note module is disabled",
            ));
        }
        self.checkpoint("before-commit", cancel);
        if cancel.is_cancelled() {
            return CallResult::Failure(BridgeFailure::cancelled());
        }
        match self.persist_closed_note(title, content) {
            Ok(record) => {
                self.checkpoint("after-commit", cancel);
                match serde_json::to_value(record) {
                    Ok(value) => CallResult::Reply(value),
                    Err(_) => CallResult::Failure(BridgeFailure::internal(
                        "note could not be serialized",
                    )),
                }
            }
            Err(err) => CallResult::Failure(err),
        }
    }

    fn notes_search(&mut self, params: &Value, cancel: &CancelFlag) -> CallResult {
        let map = match object(params) {
            Ok(map) => map,
            Err(err) => return CallResult::Failure(err),
        };
        if let Err(err) = reject_unknown(map, &["query", "limit", "offset"]) {
            return CallResult::Failure(err);
        }
        let query = match required_string(map, "query") {
            Ok(query) => query,
            Err(err) => return CallResult::Failure(err),
        };
        let query = match normalize_query(query) {
            Ok(query) => query,
            Err(err) => return CallResult::Failure(err),
        };
        let limit = match bounded_u64(map, "limit", DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT) {
            Ok(limit) => limit as usize,
            Err(err) => return CallResult::Failure(err),
        };
        let offset = match bounded_u64(map, "offset", DEFAULT_SEARCH_OFFSET, 0, MAX_SEARCH_OFFSET)
        {
            Ok(offset) => offset as usize,
            Err(err) => return CallResult::Failure(err),
        };
        if !self.notes_enabled() {
            return CallResult::Failure(BridgeFailure::new(
                "DISABLED",
                "sticky note module is disabled",
            ));
        }
        if cancel.is_cancelled() {
            return CallResult::Failure(BridgeFailure::cancelled());
        }
        let _gate = self.lock_gate();
        let notes = match self.with_notes(|notes, kernel| notes.list_notes(kernel.context(), false))
        {
            Ok(notes) => notes,
            Err(err) => return CallResult::Failure(err),
        };
        let needle = query.to_lowercase();
        let matched: Vec<StickyNoteRecord> = notes
            .into_iter()
            .filter(|note| {
                note.title.to_lowercase().contains(&needle)
                    || note.content_md.to_lowercase().contains(&needle)
            })
            .collect();
        let total = matched.len();
        let mut items = Vec::new();
        for note in matched.into_iter().skip(offset).take(limit) {
            match serde_json::to_value(note) {
                Ok(value) => items.push(value),
                Err(_) => {
                    return CallResult::Failure(BridgeFailure::internal(
                        "note could not be serialized",
                    ))
                }
            }
        }
        CallResult::Reply(json!({ "items": items, "total": total }))
    }

    fn notes_update(&mut self, params: &Value, cancel: &CancelFlag) -> CallResult {
        let map = match object(params) {
            Ok(map) => map,
            Err(err) => return CallResult::Failure(err),
        };
        if let Err(err) = reject_unknown(
            map,
            &["id", "title", "content_md", "expected_updated_at"],
        ) {
            return CallResult::Failure(err);
        }
        let id = match required_string(map, "id") {
            Ok(id) => id.to_string(),
            Err(err) => return CallResult::Failure(err),
        };
        if let Err(err) = validate_id(&id) {
            return CallResult::Failure(err);
        }
        let title = match optional_string(map, "title") {
            Ok(title) => title.map(str::to_string),
            Err(err) => return CallResult::Failure(err),
        };
        let content = match optional_string(map, "content_md") {
            Ok(content) => content.map(str::to_string),
            Err(err) => return CallResult::Failure(err),
        };
        if title.is_none() && content.is_none() {
            return CallResult::Failure(BridgeFailure::invalid(
                "title or content_md is required",
            ));
        }
        if let Some(title) = title.as_deref() {
            if let Err(err) = validate_title(title) {
                return CallResult::Failure(err);
            }
        }
        if let Some(content) = content.as_deref() {
            if let Err(err) = validate_text(content, MAX_CONTENT_CHARS, true) {
                return CallResult::Failure(err);
            }
        }
        let expected = match optional_safe_i64(map, "expected_updated_at") {
            Ok(expected) => expected,
            Err(err) => return CallResult::Failure(err),
        };
        if !self.notes_enabled() {
            return CallResult::Failure(BridgeFailure::new(
                "DISABLED",
                "sticky note module is disabled",
            ));
        }
        self.checkpoint("before-commit", cancel);
        if cancel.is_cancelled() {
            return CallResult::Failure(BridgeFailure::cancelled());
        }
        match self.update_note(&id, title.as_deref(), content.as_deref(), expected) {
            Ok(record) => {
                self.checkpoint("after-commit", cancel);
                match serde_json::to_value(record) {
                    Ok(value) => CallResult::Reply(value),
                    Err(_) => CallResult::Failure(BridgeFailure::internal(
                        "note could not be serialized",
                    )),
                }
            }
            Err(err) => CallResult::Failure(err),
        }
    }

    fn shutdown(&mut self, params: &Value, cancel: &CancelFlag) -> CallResult {
        if let Err(err) = require_empty_object(params) {
            return CallResult::Failure(err);
        }
        self.checkpoint("before-commit", cancel);
        if cancel.is_cancelled() {
            return CallResult::Failure(BridgeFailure::cancelled());
        }
        if let Err(err) = self.shutdown_kernel() {
            return CallResult::Failure(err);
        }
        self.checkpoint("after-commit", cancel);
        CallResult::Stop(json!({ "stopping": true }))
    }

    pub fn shutdown_kernel(&mut self) -> Result<(), BridgeFailure> {
        let Some(kernel) = self.kernel.take() else {
            return Ok(());
        };
        kernel.shutdown().map_err(|err| {
            BridgeFailure::internal(format!("shutdown failed: {}", safe_core_error(&err)))
        })
    }

    fn persist_closed_note(
        &mut self,
        title: &str,
        content: &str,
    ) -> Result<StickyNoteRecord, BridgeFailure> {
        let _gate = self.lock_gate();
        let created = self
            .with_notes(|notes, kernel| {
                notes.create_note(kernel.context(), Some(title), Some(content), None)
            })
            .map_err(|_| BridgeFailure::internal("note create failed"))?;
        let id = created.id.clone();
        if let Err(err) = self.with_notes(|notes, kernel| notes.close_note(kernel.context(), &id)) {
            let _ = self.with_notes(|notes, kernel| notes.delete_note(kernel.context(), &id));
            return Err(err);
        }
        let record = self
            .with_notes(|notes, kernel| notes.get_note(kernel.context(), &id))?
            .ok_or_else(|| BridgeFailure::internal("created note could not be read"))?;
        if record.is_open || self.active_window_count() != 0 {
            let _ = self.with_notes(|notes, kernel| notes.delete_note(kernel.context(), &id));
            return Err(BridgeFailure::internal(
                "note was stored with a desktop window still open",
            ));
        }
        Ok(record)
    }

    fn update_note(
        &mut self,
        id: &str,
        title: Option<&str>,
        content: Option<&str>,
        expected: Option<i64>,
    ) -> Result<StickyNoteRecord, BridgeFailure> {
        let _gate = self.lock_gate();
        let existing = self
            .with_notes(|notes, kernel| notes.get_note(kernel.context(), id))?
            .ok_or_else(|| BridgeFailure::new("NOT_FOUND", "note was not found"))?;
        if expected.is_some_and(|expected| expected != existing.updated_at) {
            return Err(BridgeFailure::new(
                "CONFLICT",
                "note was updated since it was read",
            ));
        }
        let content_to_store = content.unwrap_or(existing.content_md.as_str());
        let write = self.with_notes(|notes, kernel| {
            notes.save_content(
                kernel.context(),
                id,
                title,
                content_to_store,
                None,
                None,
            )
        })?;
        if !write.applied {
            return Err(BridgeFailure::internal("note update was not applied"));
        }
        self.ensure_timestamp_advanced(id, existing.updated_at)?;
        let record = self
            .with_notes(|notes, kernel| notes.get_note(kernel.context(), id))?
            .ok_or_else(|| BridgeFailure::internal("updated note could not be read"))?;
        if record.updated_at < 0 || record.updated_at > JS_MAX_SAFE_INTEGER {
            return Err(BridgeFailure::internal(
                "note timestamp is not a safe integer",
            ));
        }
        if existing.updated_at < JS_MAX_SAFE_INTEGER && record.updated_at <= existing.updated_at {
            return Err(BridgeFailure::internal(
                "note timestamp could not be advanced",
            ));
        }
        Ok(record)
    }

    /// `updated_at` is millisecond wall time. The bridge keeps the conflict token
    /// strictly increasing when the clock does not move, under the data-dir lock.
    fn ensure_timestamp_advanced(&self, id: &str, previous: i64) -> Result<(), BridgeFailure> {
        let current = self
            .with_notes(|notes, kernel| notes.get_note(kernel.context(), id))?
            .ok_or_else(|| BridgeFailure::internal("updated note could not be read"))?;
        if current.updated_at > previous && current.updated_at <= JS_MAX_SAFE_INTEGER {
            return Ok(());
        }
        if previous >= JS_MAX_SAFE_INTEGER || current.updated_at > JS_MAX_SAFE_INTEGER {
            return Err(BridgeFailure::internal(
                "note timestamp could not be advanced",
            ));
        }
        let next = previous + 1;
        let kernel = self
            .kernel
            .as_ref()
            .ok_or_else(|| BridgeFailure::internal("bridge is stopping"))?;
        let affected = kernel
            .context()
            .db
            .with_conn(|conn| {
                let affected = conn.execute(
                    "UPDATE sticky_notes SET updated_at = ?1 WHERE id = ?2 AND updated_at = ?3",
                    params![next, id, current.updated_at],
                )?;
                Ok(affected)
            })
            .map_err(|_| BridgeFailure::internal("note timestamp could not be advanced"))?;
        if affected != 1 {
            return Err(BridgeFailure::internal(
                "note timestamp could not be advanced",
            ));
        }
        Ok(())
    }

    fn with_notes<T>(
        &self,
        operation: impl FnOnce(&StickyNoteModule, &AppKernel) -> app_core::CoreResult<T>,
    ) -> Result<T, BridgeFailure> {
        let kernel = self
            .kernel
            .as_ref()
            .ok_or_else(|| BridgeFailure::internal("bridge is stopping"))?;
        let notes = Arc::clone(&self.notes);
        kernel
            .registry()
            .with_enabled("sticky_note", || operation(&notes, kernel))
            .map_err(core_to_failure)
    }

    fn notes_enabled(&self) -> bool {
        self.kernel
            .as_ref()
            .is_some_and(|kernel| kernel.registry().is_enabled("sticky_note"))
    }

    fn active_window_count(&self) -> usize {
        self.kernel
            .as_ref()
            .map(|kernel| kernel.context().window_pool.active_window_count())
            .unwrap_or(0)
    }

    fn lock_gate(&self) -> std::sync::MutexGuard<'_, ()> {
        self.gate.lock().unwrap_or_else(|err| err.into_inner())
    }

    fn image_conversion_available(&self) -> bool {
        !self.read_roots.is_empty() && !self.write_roots.is_empty()
    }

    fn convert_image(&self, params: &Value, cancel: &CancelFlag) -> CallResult {
        if !self.image_conversion_available() {
            return CallResult::Failure(BridgeFailure::new(
                "ACCESS_DENIED",
                "image conversion has no authorized read and write roots",
            ));
        }
        let map = match object(params) {
            Ok(map) => map,
            Err(err) => return CallResult::Failure(err),
        };
        if let Err(err) = reject_unknown(map, &["inputPath", "outputPath", "format"]) {
            return CallResult::Failure(err);
        }
        let input = match required_string(map, "inputPath") {
            Ok(input) => input,
            Err(err) => return CallResult::Failure(err),
        };
        let output = match required_string(map, "outputPath") {
            Ok(output) => output,
            Err(err) => return CallResult::Failure(err),
        };
        let format_name = match required_string(map, "format") {
            Ok(format) => format,
            Err(err) => return CallResult::Failure(err),
        };
        let format = match parse_image_format(format_name) {
            Ok(format) => format,
            Err(err) => return CallResult::Failure(err),
        };
        let input_path = match resolve_authorized_input(input, &self.read_roots) {
            Ok(path) => path,
            Err(err) => return CallResult::Failure(err),
        };
        let output_path = match resolve_authorized_output(output, &self.write_roots) {
            Ok(path) => path,
            Err(err) => return CallResult::Failure(err),
        };
        self.checkpoint("before-commit", cancel);
        if cancel.is_cancelled() {
            return CallResult::Failure(BridgeFailure::cancelled());
        }
        let request = mod_media_proc::ExactImageRequest {
            input_path,
            output_path: output_path.clone(),
            format,
        };
        match mod_media_proc::convert_image_exact_with(
            &request,
            cancel.as_atomic(),
            &|| self.checkpoint("before-publish", cancel),
            &|| self.checkpoint("after-commit", cancel),
        ) {
            Ok(mod_media_proc::ExactImageStatus::Completed) => {
                let Some(output_path) = output_path.to_str() else {
                    return CallResult::Failure(BridgeFailure::internal("image conversion failed"));
                };
                CallResult::Reply(json!({
                    "outputPath": output_path,
                    "format": format.as_str(),
                }))
            }
            Ok(mod_media_proc::ExactImageStatus::Cancelled) => {
                CallResult::Failure(BridgeFailure::cancelled())
            }
            Err(err) => CallResult::Failure(image_failure(&err)),
        }
    }
}

impl Drop for BridgeService {
    fn drop(&mut self) {
        let _ = self.shutdown_kernel();
    }
}

fn module_status(service: &BridgeService, id: &str) -> Value {
    if id == "sticky_note" {
        let enabled = service.notes_enabled();
        return json!({
            "id": id,
            "available": true,
            "enabled": enabled,
            "reason": if enabled {
                "Markdown notes are stored in the bridge database. Desktop note windows are not created."
            } else {
                "The sticky note module is mounted but disabled."
            },
        });
    }
    if id == "media_proc" {
        let available = service.image_conversion_available();
        return json!({
            "id": id,
            "available": available,
            "enabled": available,
            "reason": if available {
                "Exact-path conversion is available for png, jpeg, webp, bmp, and ico. Capture and FFmpeg jobs are not started."
            } else {
                "Image conversion is not advertised until both a read root and a write root are configured. Capture and FFmpeg jobs are not started."
            },
        });
    }
    json!({
        "id": id,
        "available": false,
        "enabled": false,
        "reason": module_unavailable_reason(id),
    })
}

fn module_unavailable_reason(id: &str) -> &'static str {
    match id {
        "media_proc" => "Image conversion is not advertised until both a read root and a write root are configured. Capture and FFmpeg jobs are not started.",
        "clipboard" => "Not started. Clipboard capture is outside this bridge.",
        "app_usage" => "Not started. Usage tracking is outside this bridge.",
        "password_vault" => "Not started. The password vault and authentication are outside this bridge.",
        "screenshot" => "Not started. Screenshot overlay and capture are outside this headless bridge.",
        "screen_ink" => "Not started. Screen annotation is outside this headless bridge.",
        "window_pin" => "Not started. Window pin is outside this headless bridge.",
        "script_runner" => "Not started. Script execution is outside this bridge.",
        "translator" => "Not started. Translation is outside this bridge.",
        _ => "Not started in this headless bridge.",
    }
}

fn core_to_failure(err: CoreError) -> BridgeFailure {
    match err {
        CoreError::ModuleDisabled(_) => {
            BridgeFailure::new("DISABLED", "sticky note module is disabled")
        }
        CoreError::ModuleNotFound(_) => {
            BridgeFailure::unsupported("sticky note module is not available")
        }
        _ => BridgeFailure::internal(safe_core_error(&err)),
    }
}

fn safe_core_error(err: &CoreError) -> String {
    match err {
        CoreError::Database(_) => "database operation failed".to_string(),
        CoreError::Io(_) => "storage operation failed".to_string(),
        CoreError::ModuleDisabled(_) => "module is disabled".to_string(),
        CoreError::ModuleNotFound(_) => "module was not found".to_string(),
        CoreError::ModuleLifecycle { hook, .. } => format!("module {hook} failed"),
        other => {
            let text = other.to_string();
            if text.len() > 180 {
                "kernel operation failed".to_string()
            } else {
                text
            }
        }
    }
}

pub fn parse_config(args: &[String]) -> Result<BridgeConfig, String> {
    let mut pipe_name = None;
    let mut instance_id = None;
    let mut data_dir = None;
    let mut parent_pid = None;
    let mut allow_read_roots = Vec::new();
    let mut allow_write_roots = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let mut value = || {
            iter.next()
                .cloned()
                .ok_or_else(|| format!("missing value for {arg}"))
        };
        match arg.as_str() {
            "--pipe-name" => pipe_name = Some(value()?),
            "--instance-id" => instance_id = Some(value()?),
            "--data-dir" => data_dir = Some(PathBuf::from(value()?)),
            "--parent-pid" => {
                let raw = value()?;
                let pid = raw
                    .parse::<u32>()
                    .map_err(|_| "parent pid must be an integer".to_string())?;
                if pid == 0 || pid == std::process::id() {
                    return Err("parent pid must be a running parent process".to_string());
                }
                parent_pid = Some(pid);
            }
            "--allow-read-root" => allow_read_roots.push(PathBuf::from(value()?)),
            "--allow-write-root" => allow_write_roots.push(PathBuf::from(value()?)),
            "--help" => return Err("help".to_string()),
            other => return Err(format!("unknown argument {other}")),
        }
    }
    let instance_id = instance_id.ok_or("missing --instance-id")?;
    uuid::Uuid::parse_str(&instance_id).map_err(|_| "instance id must be a UUID".to_string())?;
    let pipe_name = pipe_name.ok_or("missing --pipe-name")?;
    if pipe_name != expected_pipe_name(&instance_id) {
        return Err("pipe name must be \\\\.\\pipe\\dsh-toolbox-<instance-id>".to_string());
    }
    let data_dir = prepare_directory(&data_dir.ok_or("missing --data-dir")?, "data directory")?;
    let parent_pid = parent_pid.ok_or("missing --parent-pid")?;
    let allow_read_roots = canonicalize_roots(&allow_read_roots, "allow-read-root")?;
    let allow_write_roots = canonicalize_roots(&allow_write_roots, "allow-write-root")?;
    Ok(BridgeConfig {
        pipe_name,
        instance_id,
        data_dir,
        parent_pid,
        allow_read_roots,
        allow_write_roots,
    })
}

fn canonicalize_roots(paths: &[PathBuf], label: &str) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    for path in paths {
        roots.push(prepare_directory(path, label)?);
    }
    Ok(roots)
}

fn prepare_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    std::fs::create_dir_all(path).map_err(|_| format!("{label} could not be created"))?;
    let canonical = std::fs::canonicalize(path).map_err(|_| format!("{label} could not be resolved"))?;
    if !canonical.is_dir() {
        return Err(format!("{label} must be an existing directory"));
    }
    reject_profile_path(&canonical)?;
    Ok(strip_verbatim(&canonical))
}

fn reject_profile_path(path: &Path) -> Result<(), String> {
    let candidate = strip_verbatim(path);
    for variable in ["APPDATA", "LOCALAPPDATA"] {
        let Ok(value) = std::env::var(variable) else {
            continue;
        };
        let Ok(profile) = std::fs::canonicalize(value) else {
            continue;
        };
        if candidate.starts_with(strip_verbatim(&profile)) {
            return Err("data directory must not be inside the user profile".to_string());
        }
    }
    Ok(())
}

fn parse_image_format(value: &str) -> Result<mod_media_proc::ImageOutputFormat, BridgeFailure> {
    use mod_media_proc::ImageOutputFormat::{Bmp, Ico, Jpeg, Png, Webp};
    match value {
        "png" => Ok(Png),
        "jpeg" => Ok(Jpeg),
        "webp" => Ok(Webp),
        "bmp" => Ok(Bmp),
        "ico" => Ok(Ico),
        _ => Err(BridgeFailure::invalid("format is not supported")),
    }
}

fn resolve_authorized_input(raw: &str, roots: &[PathBuf]) -> Result<PathBuf, BridgeFailure> {
    let path = absolute_image_path(raw)?;
    let canonical = match std::fs::canonicalize(&path) {
        Ok(path) => strip_verbatim(&path),
        Err(_) => {
            return Err(BridgeFailure::new("NOT_FOUND", "input image was not found"));
        }
    };
    if !roots.iter().any(|root| is_within(&canonical, root)) {
        return Err(BridgeFailure::new(
            "ACCESS_DENIED",
            "input path is outside the authorized read roots",
        ));
    }
    if !canonical.is_file() {
        return Err(BridgeFailure::new("NOT_FOUND", "input image was not found"));
    }
    Ok(canonical)
}

fn resolve_authorized_output(raw: &str, roots: &[PathBuf]) -> Result<PathBuf, BridgeFailure> {
    let path = absolute_image_path(raw)?;
    let Some(name) = path.file_name() else {
        return Err(BridgeFailure::invalid("output path is invalid"));
    };
    let name_text = name.to_string_lossy();
    if name_text.is_empty()
        || name_text == "."
        || name_text == ".."
        || name_text.contains(':')
        || name_text.contains('\\')
        || name_text.contains('/')
    {
        return Err(BridgeFailure::invalid("output path is invalid"));
    }
    let Some(parent) = path.parent() else {
        return Err(BridgeFailure::invalid("output path is invalid"));
    };
    let parent = match std::fs::canonicalize(parent) {
        Ok(path) => strip_verbatim(&path),
        Err(_) => {
            return Err(BridgeFailure::invalid("output directory is not available"));
        }
    };
    if !roots.iter().any(|root| is_within(&parent, root)) {
        return Err(BridgeFailure::new(
            "ACCESS_DENIED",
            "output path is outside the authorized write roots",
        ));
    }
    let final_path = parent.join(name);
    if std::fs::symlink_metadata(&final_path).is_ok() {
        return Err(BridgeFailure::new("CONFLICT", "output already exists"));
    }
    Ok(final_path)
}

fn absolute_image_path(raw: &str) -> Result<PathBuf, BridgeFailure> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() || !path.is_absolute() {
        return Err(BridgeFailure::invalid("image path must be absolute"));
    }
    Ok(path)
}

fn is_within(candidate: &Path, root: &Path) -> bool {
    let candidate = path_key(candidate);
    let root = path_key(root);
    candidate == root || candidate.starts_with(&(root + "\\"))
}

fn path_key(path: &Path) -> String {
    strip_verbatim(path)
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn image_failure(err: &CoreError) -> BridgeFailure {
    let text = err.to_string();
    if text.contains("already exists") {
        BridgeFailure::new("CONFLICT", "output already exists")
    } else if text.contains("not found") {
        BridgeFailure::new("NOT_FOUND", "input image was not found")
    } else if text.contains("could not be decoded") {
        BridgeFailure::invalid("input image could not be decoded")
    } else {
        BridgeFailure::internal("image conversion failed")
    }
}

fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest.to_string());
    }
    path.to_path_buf()
}

fn object(params: &Value) -> Result<&Map<String, Value>, BridgeFailure> {
    params
        .as_object()
        .ok_or_else(|| BridgeFailure::invalid("params must be an object"))
}

fn require_empty_object(params: &Value) -> Result<(), BridgeFailure> {
    let map = object(params)?;
    if map.is_empty() {
        Ok(())
    } else {
        Err(BridgeFailure::invalid("params must be an empty object"))
    }
}

fn reject_unknown(map: &Map<String, Value>, allowed: &[&str]) -> Result<(), BridgeFailure> {
    if map.keys().any(|key| !allowed.contains(&key.as_str())) {
        Err(BridgeFailure::invalid(
            "params contains an unsupported field",
        ))
    } else {
        Ok(())
    }
}

fn required_string<'a>(
    map: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, BridgeFailure> {
    match map.get(key) {
        Some(Value::String(value)) => Ok(value),
        Some(_) => Err(BridgeFailure::invalid(format!("{key} must be a string"))),
        None => Err(BridgeFailure::invalid(format!("{key} is required"))),
    }
}

fn optional_string<'a>(
    map: &'a Map<String, Value>,
    key: &str,
) -> Result<Option<&'a str>, BridgeFailure> {
    match map.get(key) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(BridgeFailure::invalid(format!("{key} must be a string"))),
    }
}

fn required_bool(map: &Map<String, Value>, key: &str) -> Result<bool, BridgeFailure> {
    match map.get(key) {
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(BridgeFailure::invalid(format!("{key} must be a boolean"))),
        None => Err(BridgeFailure::invalid(format!("{key} is required"))),
    }
}

fn bounded_u64(
    map: &Map<String, Value>,
    key: &str,
    default: u64,
    min: u64,
    max: u64,
) -> Result<u64, BridgeFailure> {
    let Some(value) = map.get(key) else {
        return Ok(default);
    };
    let Some(number) = value.as_u64() else {
        return Err(BridgeFailure::invalid(format!("{key} must be an integer")));
    };
    if !(min..=max).contains(&number) {
        return Err(BridgeFailure::invalid(format!("{key} is out of range")));
    }
    Ok(number)
}

fn optional_safe_i64(map: &Map<String, Value>, key: &str) -> Result<Option<i64>, BridgeFailure> {
    match map.get(key) {
        None => Ok(None),
        Some(value) => {
            let Some(number) = value.as_i64() else {
                return Err(BridgeFailure::invalid(format!(
                    "{key} must be a non-negative safe integer"
                )));
            };
            if !(0..=JS_MAX_SAFE_INTEGER).contains(&number) {
                return Err(BridgeFailure::invalid(format!(
                    "{key} must be a non-negative safe integer"
                )));
            }
            Ok(Some(number))
        }
    }
}

fn validate_id(id: &str) -> Result<(), BridgeFailure> {
    if id.is_empty() || id.chars().count() > MAX_ID_CHARS || has_forbidden_control(id, false) {
        Err(BridgeFailure::invalid("note id is invalid"))
    } else {
        Ok(())
    }
}

fn validate_title(value: &str) -> Result<(), BridgeFailure> {
    let count = value.chars().count();
    if !(1..=MAX_TITLE_CHARS).contains(&count)
        || value.chars().all(char::is_whitespace)
        || has_forbidden_control(value, false)
    {
        Err(BridgeFailure::invalid(
            "title must contain 1 to 500 characters and non-whitespace text",
        ))
    } else {
        Ok(())
    }
}

fn normalize_query(value: &str) -> Result<&str, BridgeFailure> {
    if value.chars().count() > MAX_QUERY_CHARS || has_forbidden_control(value, false) {
        return Err(BridgeFailure::invalid(
            "query must contain 1 to 200 characters and non-whitespace text",
        ));
    }
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(BridgeFailure::invalid(
            "query must contain 1 to 200 characters and non-whitespace text",
        ));
    }
    Ok(trimmed)
}

fn validate_text(value: &str, max_chars: usize, multiline: bool) -> Result<(), BridgeFailure> {
    if value.chars().count() > max_chars || has_forbidden_control(value, multiline) {
        Err(BridgeFailure::invalid(
            "text is too long or contains unsupported control characters",
        ))
    } else {
        Ok(())
    }
}

fn has_forbidden_control(value: &str, multiline: bool) -> bool {
    value.chars().any(|ch| match ch {
        '\n' | '\r' | '\t' => !multiline,
        other => (other as u32) < 0x20,
    })
}

pub fn usage_text() -> &'static str {
    "dsh-toolbox-native --pipe-name \\\\.\\pipe\\dsh-toolbox-<uuid> --instance-id <uuid> --data-dir <absolute path> --parent-pid <pid> [--allow-read-root <absolute directory>] [--allow-write-root <absolute directory>]"
}

pub fn run_from_env() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help") {
        println!("{}", usage_text());
        return 0;
    }
    let config = match parse_config(&args) {
        Ok(config) => config,
        Err(err) => {
            eprintln!("dsh-toolbox-native: {err}");
            return 1;
        }
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            eprintln!("dsh-toolbox-native: tokio runtime could not start");
            return 1;
        }
    };
    match runtime.block_on(crate::winutil::serve(config)) {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("dsh-toolbox-native: {err}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(name: &str) -> PathBuf {
        crate::test_fixture::scoped_fixture("dsh-bridge-tests", name)
    }

    fn call(service: &mut BridgeService, method: &str, params: Value) -> CallResult {
        service.call(method, &params, &CancelFlag::new())
    }

    #[test]
    fn notes_survive_kernel_restart_and_do_not_open_windows() {
        let dir = fixture("restart");
        let mut service = BridgeService::open(&dir).unwrap();
        let created = match call(
            &mut service,
            "notes.create",
            json!({"title": "Bridge note", "content_md": "cursor-bridge-token", "open": false}),
        ) {
            CallResult::Reply(value) => value,
            other => panic!("create failed: {other:?}"),
        };
        assert_eq!(created["is_open"], false);
        assert_eq!(created["title"], "Bridge note");
        assert_eq!(service.active_window_count(), 0);
        let id = created["id"].as_str().unwrap().to_string();
        let updated_at = created["updated_at"].as_i64().unwrap();
        assert!(matches!(
            call(
                &mut service,
                "notes.update",
                json!({"id": id, "content_md": "replaced-token", "expected_updated_at": updated_at - 1})
            ),
            CallResult::Failure(BridgeFailure { code: "CONFLICT", .. })
        ));
        let updated = match call(
            &mut service,
            "notes.update",
            json!({"id": id, "content_md": "replaced-token", "expected_updated_at": updated_at}),
        ) {
            CallResult::Reply(value) => value,
            other => panic!("update failed: {other:?}"),
        };
        assert!(updated["updated_at"].as_i64().unwrap() > updated_at);
        assert!(matches!(
            call(&mut service, "notes.create", json!({"title": "No", "content_md": "nope", "open": true})),
            CallResult::Failure(BridgeFailure { code: "UNSUPPORTED", .. })
        ));
        service.shutdown_kernel().unwrap();
        drop(service);

        let mut reopened = BridgeService::open(&dir).unwrap();
        assert_eq!(reopened.active_window_count(), 0);
        let found = match call(
            &mut reopened,
            "notes.search",
            json!({"query": "replaced-token", "limit": 10, "offset": 0}),
        ) {
            CallResult::Reply(value) => value,
            other => panic!("search failed: {other:?}"),
        };
        assert_eq!(found["total"], 1);
        assert_eq!(found["items"][0]["id"], id);
        assert_eq!(found["items"][0]["is_open"], false);
        assert!(matches!(
            call(&mut reopened, "notes.search", json!({"query": "   ", "limit": 10, "offset": 0})),
            CallResult::Failure(BridgeFailure { code: "INVALID_REQUEST", .. })
        ));
        assert!(matches!(
            call(&mut reopened, "media.convert_image", json!({})),
            CallResult::Failure(BridgeFailure { code: "ACCESS_DENIED", .. })
        ));
        let caps = reopened.capabilities();
        assert!(caps.contains(&"status".to_string()));
        assert!(caps.contains(&"notes.update".to_string()));
        assert!(!caps.iter().any(|cap| cap.contains("media")));
        let status = match call(&mut reopened, "status", json!({})) {
            CallResult::Reply(value) => value,
            other => panic!("status failed: {other:?}"),
        };
        let modules = status["modules"].as_array().unwrap();
        assert!(modules.iter().any(|module| module["id"] == "sticky_note" && module["available"] == true));
        assert!(modules.iter().any(|module| {
            module["id"] == "media_proc" && module["available"] == false && module["enabled"] == false
        }));
        assert!(modules.iter().any(|module| module["id"] == "clipboard" && module["available"] == false));
        assert!(dir.join("app.db").is_file());
    }

    #[test]
    fn disabled_sticky_note_is_not_advertised() {
        let dir = fixture("disabled");
        let service = BridgeService::open(&dir).unwrap();
        drop(service);
        let config_path = dir.join("config.json");
        let mut config: Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        config["modules"]["enabled"]["sticky_note"] = json!(false);
        std::fs::write(&config_path, serde_json::to_vec_pretty(&config).unwrap()).unwrap();
        let mut service = BridgeService::open(&dir).unwrap();
        assert!(!service.capabilities().iter().any(|cap| cap.starts_with("notes.")));
        assert!(matches!(
            call(&mut service, "notes.create", json!({"title": "x", "content_md": "y", "open": false})),
            CallResult::Failure(BridgeFailure { code: "DISABLED", .. })
        ));
    }

    #[test]
    fn relative_data_dir_is_rejected() {
        let err = prepare_directory(Path::new("relative-data"), "data directory").unwrap_err();
        assert!(err.contains("absolute"));
    }

    #[test]
    fn pipe_name_must_match_instance_id() {
        let dir = fixture("parse");
        let args = vec![
            "--pipe-name".to_string(),
            r"\\.\pipe\dsh-toolbox-not-the-id".to_string(),
            "--instance-id".to_string(),
            "11111111-1111-4111-8111-111111111111".to_string(),
            "--data-dir".to_string(),
            dir.display().to_string(),
            "--parent-pid".to_string(),
            "4".to_string(),
        ];
        match parse_config(&args) {
            Ok(_) => panic!("mismatched pipe name was accepted"),
            Err(err) => assert!(err.contains("pipe name")),
        }
    }

    #[test]
    fn note_tokens_advance_and_text_limits_match_the_contract() {
        let dir = fixture("tokens");
        let mut service = BridgeService::open(&dir).unwrap();
        let created = match call(
            &mut service,
            "notes.create",
            json!({"title": "  padded  ", "content_md": "token-body", "open": false}),
        ) {
            CallResult::Reply(value) => value,
            other => panic!("create failed: {other:?}"),
        };
        assert_eq!(created["title"], "  padded  ");
        let id = created["id"].as_str().unwrap().to_string();
        let mut token = created["updated_at"].as_i64().unwrap();
        assert!((0..=JS_MAX_SAFE_INTEGER).contains(&token));
        for revision in 0..3 {
            let content = format!("rev-{revision}");
            let updated = match call(
                &mut service,
                "notes.update",
                json!({"id": id, "content_md": content, "expected_updated_at": token}),
            ) {
                CallResult::Reply(value) => value,
                other => panic!("update failed: {other:?}"),
            };
            let next = updated["updated_at"].as_i64().unwrap();
            assert!(next > token);
            assert!(next <= JS_MAX_SAFE_INTEGER);
            assert_eq!(updated["content_md"], format!("rev-{revision}"));
            token = next;
        }
        assert!(matches!(
            call(
                &mut service,
                "notes.update",
                json!({"id": id, "content_md": "stale", "expected_updated_at": token - 1})
            ),
            CallResult::Failure(BridgeFailure { code: "CONFLICT", .. })
        ));
        assert!(matches!(
            call(
                &mut service,
                "notes.update",
                json!({"id": id, "content_md": "negative", "expected_updated_at": -1})
            ),
            CallResult::Failure(BridgeFailure { code: "INVALID_REQUEST", .. })
        ));
        assert!(matches!(
            call(
                &mut service,
                "notes.update",
                json!({"id": id, "title": "   ", "content_md": "blank-title"})
            ),
            CallResult::Failure(BridgeFailure { code: "INVALID_REQUEST", .. })
        ));
        let found = match call(&mut service, "notes.search", json!({"query": "  rev-2  "})) {
            CallResult::Reply(value) => value,
            other => panic!("search failed: {other:?}"),
        };
        assert_eq!(found["total"], 1);
        assert_eq!(found["items"][0]["content_md"], "rev-2");
        assert_eq!(found["items"][0]["title"], "  padded  ");
        let cancelled = CancelFlag::new();
        cancelled.cancel();
        assert!(matches!(
            service.call(
                "notes.create",
                &json!({"title": "No", "content_md": "should-not-persist", "open": false}),
                &cancelled
            ),
            CallResult::Failure(BridgeFailure { code: "CANCELLED", .. })
        ));
        let after = match call(
            &mut service,
            "notes.search",
            json!({"query": "should-not-persist", "limit": 5, "offset": 0}),
        ) {
            CallResult::Reply(value) => value,
            other => panic!("search failed: {other:?}"),
        };
        assert_eq!(after["total"], 0);
    }

    fn write_sample_png(path: &std::path::Path) {
        let image = image::RgbImage::from_fn(8, 6, |x, y| {
            image::Rgb([(x * 20) as u8, (y * 30) as u8, 90])
        });
        image.save(path).unwrap();
    }

    fn assert_converted(path: &std::path::Path, format: &str) {
        let bytes = std::fs::read(path).unwrap();
        match format {
            "png" => assert!(bytes.starts_with(b"\x89PNG")),
            "jpeg" => assert!(bytes.starts_with(&[0xFF, 0xD8, 0xFF])),
            "webp" => {
                assert!(bytes.starts_with(b"RIFF"));
                assert_eq!(&bytes[8..12], b"WEBP");
            }
            "bmp" => assert!(bytes.starts_with(b"BM")),
            "ico" => assert!(bytes.starts_with(&[0, 0, 1, 0])),
            other => panic!("unexpected format {other}"),
        }
        let decoded = image::open(path).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (8, 6));
    }

    fn make_junction(link: &std::path::Path, target: &std::path::Path) {
        let status = std::process::Command::new("cmd")
            .args([
                "/c",
                "mklink",
                "/J",
                link.to_str().unwrap(),
                target.to_str().unwrap(),
            ])
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn image_conversion_checks_formats_roots_and_reparse_points() {
        let dir = fixture("images");
        let read = dir.join("read");
        let write = dir.join("write");
        let outside = dir.join("outside");
        std::fs::create_dir_all(&read).unwrap();
        std::fs::create_dir_all(&write).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let mut service =
            BridgeService::open_with_roots(&dir, &[read.clone()], &[write.clone()]).unwrap();
        assert!(service
            .capabilities()
            .iter()
            .any(|cap| cap == "media.convert_image"));
        let source = read.join("source.png");
        write_sample_png(&source);
        for (format, name) in [
            ("png", "out.png"),
            ("jpeg", "out.jpg"),
            ("webp", "out.webp"),
            ("bmp", "out.bmp"),
            ("ico", "out.ico"),
        ] {
            let output = write.join(name);
            let converted = match call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": source.display().to_string(),
                    "outputPath": output.display().to_string(),
                    "format": format
                }),
            ) {
                CallResult::Reply(value) => value,
                other => panic!("{format} conversion failed: {other:?}"),
            };
            assert_eq!(converted["format"], format);
            assert_eq!(converted["outputPath"], output.display().to_string());
            assert_converted(&output, format);
        }
        assert!(std::fs::read_dir(&write).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".dsh-")
        }));

        let bad = read.join("bad.png");
        std::fs::write(&bad, b"not an image").unwrap();
        let bad_out = write.join("bad-out.png");
        assert!(matches!(
            call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": bad.display().to_string(),
                    "outputPath": bad_out.display().to_string(),
                    "format": "png"
                }),
            ),
            CallResult::Failure(BridgeFailure { code: "INVALID_REQUEST", .. })
        ));
        assert!(!bad_out.exists());

        let existing = write.join("existing.png");
        std::fs::write(&existing, b"keep-these-bytes").unwrap();
        assert!(matches!(
            call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": source.display().to_string(),
                    "outputPath": existing.display().to_string(),
                    "format": "png"
                }),
            ),
            CallResult::Failure(BridgeFailure { code: "CONFLICT", .. })
        ));
        assert_eq!(std::fs::read(&existing).unwrap(), b"keep-these-bytes");

        let outside_file = outside.join("secret.png");
        write_sample_png(&outside_file);
        let outside_bytes = std::fs::read(&outside_file).unwrap();
        assert!(matches!(
            call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": outside_file.display().to_string(),
                    "outputPath": write.join("from-outside.png").display().to_string(),
                    "format": "png"
                }),
            ),
            CallResult::Failure(BridgeFailure { code: "ACCESS_DENIED", .. })
        ));
        assert_eq!(std::fs::read(&outside_file).unwrap(), outside_bytes);

        let read_junction = read.join("via-junction");
        make_junction(&read_junction, &outside);
        assert!(matches!(
            call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": read_junction.join("secret.png").display().to_string(),
                    "outputPath": write.join("from-junction.png").display().to_string(),
                    "format": "png"
                }),
            ),
            CallResult::Failure(BridgeFailure { code: "ACCESS_DENIED", .. })
        ));
        assert_eq!(std::fs::read(&outside_file).unwrap(), outside_bytes);
        assert!(!write.join("from-junction.png").exists());
        std::fs::remove_dir(&read_junction).unwrap();

        let write_junction = write.join("via-junction");
        make_junction(&write_junction, &outside);
        assert!(matches!(
            call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": source.display().to_string(),
                    "outputPath": write_junction.join("leak.png").display().to_string(),
                    "format": "png"
                }),
            ),
            CallResult::Failure(BridgeFailure { code: "ACCESS_DENIED", .. })
        ));
        assert!(!outside.join("leak.png").exists());
        std::fs::remove_dir(&write_junction).unwrap();

        let symlink = read.join("secret-link.png");
        match std::os::windows::fs::symlink_file(&outside_file, &symlink) {
            Ok(()) => {
                assert!(matches!(
                    call(
                        &mut service,
                        "media.convert_image",
                        json!({
                            "inputPath": symlink.display().to_string(),
                            "outputPath": write.join("from-symlink.png").display().to_string(),
                            "format": "png"
                        }),
                    ),
                    CallResult::Failure(BridgeFailure { code: "ACCESS_DENIED", .. })
                ));
                assert_eq!(std::fs::read(&outside_file).unwrap(), outside_bytes);
                assert!(!write.join("from-symlink.png").exists());
                std::fs::remove_file(&symlink).unwrap();
            }
            Err(error) => {
                assert_eq!(
                    error.raw_os_error(),
                    Some(1314),
                    "symlink creation failed unexpectedly: {error}"
                );
            }
        }

        assert!(matches!(
            call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": "relative.png",
                    "outputPath": write.join("relative-out.png").display().to_string(),
                    "format": "png"
                }),
            ),
            CallResult::Failure(BridgeFailure { code: "INVALID_REQUEST", .. })
        ));
        assert!(matches!(
            call(
                &mut service,
                "media.convert_image",
                json!({
                    "inputPath": source.display().to_string(),
                    "outputPath": write.join("nope.png").display().to_string(),
                    "format": "gif"
                }),
            ),
            CallResult::Failure(BridgeFailure { code: "INVALID_REQUEST", .. })
        ));
    }
}
