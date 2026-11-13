//! Agent data methods on the same desktop kernel. Human IPC is not forwarded here.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use app_core::{agent_error_code, CoreError, MODULE_CATALOG};
use base64::Engine;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde_json::{json, Map, Value};

use crate::desktop_control::ControlError;
use crate::plugin_launch::AGENT_DATA_METHODS;
use crate::DesktopHost;

const MAX_TEXT_BYTES: usize = 64 * 1024;
const PREVIEW_CHARS: usize = 120;
const MAX_LIST: i64 = 100;
const DEFAULT_LIST: i64 = 20;
const MAX_RANGE_DAYS: usize = 31;
const MAX_PIXELS: u64 = 16_000_000;
const MAX_PNG_BYTES: usize = 16 * 1024 * 1024;
const MAX_STROKES: usize = 128;
const MAX_POINTS: usize = 8192;
const MAX_NOTE_BODY: usize = 256 * 1024;
const MAX_TITLE_SCALARS: usize = 500;
const MAX_QUERY_SCALARS: usize = 200;
const MAX_NOTE_ID_SCALARS: usize = 80;
const NOTE_LIST_LIMIT: i64 = 20;
const MAX_NOTE_OFFSET: i64 = 10_000;
const JS_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn dispatch(
    host: &DesktopHost,
    method: &str,
    params: &Value,
    cancel: &AtomicBool,
) -> Result<Value, ControlError> {
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    let result = match method {
        "agent.get_access" => {
            require_exact(params, &[])?;
            Ok(access_snapshot(host))
        }
        "agent.screenshot.monitors" => {
            guard(host, "screenshot")?;
            require_exact(params, &[])?;
            monitors(host)
        }
        "agent.screenshot.capture" => {
            guard(host, "screenshot")?;
            capture(host, params, cancel)
        }
        "agent.clipboard.list" => {
            guard(host, "clipboard")?;
            clipboard_list(host, params)
        }
        "agent.clipboard.read_text" => {
            guard(host, "clipboard")?;
            clipboard_read(host, params)
        }
        "agent.clipboard.write_text" => {
            guard(host, "clipboard")?;
            clipboard_write(host, params, cancel)
        }
        "agent.ink.status" => {
            guard(host, "screen_ink")?;
            require_exact(params, &[])?;
            Ok(serde_json::to_value(host.screen_ink.get_status()).map_err(internal)?)
        }
        "agent.ink.start" => {
            guard(host, "screen_ink")?;
            require_exact(params, &[])?;
            let snapshot = host
                .screen_ink
                .start_session(host.kernel().context())
                .map_err(execution)?;
            guard(host, "screen_ink")?;
            Ok(serde_json::to_value(snapshot).map_err(internal)?)
        }
        "agent.ink.stop" => {
            guard(host, "screen_ink")?;
            require_exact(params, &[])?;
            host.screen_ink
                .exit_session(host.kernel().context())
                .map_err(execution)?;
            Ok(json!({"stopped": true}))
        }
        "agent.ink.passthrough" => {
            guard(host, "screen_ink")?;
            let enabled = required_bool(params, "enabled", &["enabled"])?;
            let snapshot = host
                .screen_ink
                .set_passthrough(host.kernel().context(), enabled)
                .map_err(execution)?;
            Ok(serde_json::to_value(snapshot).map_err(internal)?)
        }
        "agent.ink.clear" => ink_clear(host, params, cancel),
        "agent.ink.draw" => ink_draw(host, params, cancel),
        "agent.ink.snapshot" => ink_snapshot(host, params, cancel),
        "agent.usage.status" => {
            guard(host, "app_usage")?;
            require_exact(params, &[])?;
            let status = host.app_usage.status();
            Ok(json!({
                "tracking": status.tracking,
                "sample_interval_ms": status.sample_interval_ms,
            }))
        }
        "agent.usage.overview" => usage_overview(host, params),
        "agent.usage.apps" => usage_apps(host, params),
        "agent.usage.hourly" => usage_hourly(host, params),
        "agent.notes.search" => notes_search(host, params),
        "agent.notes.read" => notes_read(host, params, cancel),
        "agent.notes.create" => notes_create(host, params, cancel),
        "agent.notes.update" => notes_update(host, params, cancel),
        "agent.notes.open" => notes_open(host, params, cancel),
        "agent.artifacts.read" => artifacts_read(host, params, cancel),
        _ => Err(ControlError::new(
            "UNSUPPORTED",
            "method is not an agent data method",
        )),
    }?;
    Ok(result)
}

pub fn load_screenshot_artifact(host: &DesktopHost, artifact_id: &str) -> Result<Vec<u8>, ControlError> {
    host.agent_artifacts
        .lock()
        .bytes(host, artifact_id, "screenshot")
}

fn access_snapshot(host: &DesktopHost) -> Value {
    let modules: Vec<_> = MODULE_CATALOG
        .iter()
        .map(|module| host.kernel().agent_access_view(module.id))
        .collect();
    json!({
        "revision": host.kernel().agent_revision(),
        "modules": modules,
        "methods": AGENT_DATA_METHODS,
    })
}

fn monitors(host: &DesktopHost) -> Result<Value, ControlError> {
    guard(host, "screenshot")?;
    let listed = host
        .os_hal
        .screen_capturer
        .list_monitors()
        .map_err(|_| ControlError::new("UNAVAILABLE", "display list is not available"))?;
    Ok(json!({
        "synthetic": host.mock_hal.is_some(),
        "monitors": listed,
    }))
}

fn capture(host: &DesktopHost, params: &Value, cancel: &AtomicBool) -> Result<Value, ControlError> {
    let map = require_exact(params, &["monitor_id", "region"])?;
    let monitor_id = required_u32(map, "monitor_id")?;
    let region = match map.get("region") {
        None => None,
        Some(value) => Some(parse_region(value)?),
    };
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    let listed = host
        .os_hal
        .screen_capturer
        .list_monitors()
        .map_err(|_| ControlError::new("UNAVAILABLE", "display list is not available"))?;
    let monitor = listed
        .iter()
        .find(|monitor| monitor.id == monitor_id)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "monitor_id is not a connected display"))?;
    let pixels = u64::from(monitor.width) * u64::from(monitor.height);
    if monitor.width == 0 || monitor.height == 0 || pixels > MAX_PIXELS {
        return Err(ControlError::new(
            "INVALID_REQUEST",
            "monitor is outside the capture pixel cap",
        ));
    }
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    guard(host, "screenshot")?;
    let frame = host
        .os_hal
        .screen_capturer
        .capture_monitor(Some(monitor_id))
        .map_err(|_| ControlError::new("UNAVAILABLE", "monitor capture failed"))?;
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    let (width, height, pixels) = crop_frame(&frame.rgba_bytes, frame.width, frame.height, region)?;
    let png = encode_png(&pixels, width, height)?;
    if png.len() > MAX_PNG_BYTES {
        return Err(ControlError::new("INVALID_REQUEST", "png exceeds 16MiB"));
    }
    guard(host, "screenshot")?;
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    let artifact_id = uuid::Uuid::new_v4().simple().to_string();
    let relative = format!("agent-artifacts/screenshot/{artifact_id}.png");
    let path = host.kernel().context().app_data_dir.join(&relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(internal)?;
    }
    std::fs::write(&path, &png).map_err(internal)?;
    let sidecar = path.with_extension("json");
    let epoch = host.kernel().agent_grant_epoch("screenshot");
    let meta = json!({
        "module": "screenshot",
        "module_id": "screenshot",
        "revision": epoch,
        "width": width,
        "height": height,
    });
    if std::fs::write(&sidecar, meta.to_string()).is_err() {
        let _ = std::fs::remove_file(&path);
        return Err(internal(std::io::Error::other("artifact metadata was not stored")));
    }
    guard(host, "screenshot")?;
    if host
        .agent_artifacts
        .lock()
        .insert(artifact_id.clone(), "screenshot", png.clone(), width, height, epoch)
        .is_err()
    {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&sidecar);
        return Err(ControlError::new("UNAVAILABLE", "artifact was not stored"));
    }
    remember_commit(host, cancel);
    Ok(json!({
        "artifact_id": artifact_id,
        "module_id": "screenshot",
        "mime_type": "image/png",
        "byte_length": png.len(),
        "width": width,
        "height": height,
        "relative_path": relative,
        "synthetic": host.mock_hal.is_some(),
        "revision": epoch,
    }))
}

fn clipboard_list(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    let map = require_exact(params, &["keyword", "limit"])?;
    let keyword = match map.get("keyword") {
        None => None,
        Some(Value::String(value)) if !value.contains('\0') => Some(value.as_str()),
        _ => return Err(ControlError::new("INVALID_REQUEST", "keyword must be a string")),
    };
    let limit = match map.get("limit") {
        None => DEFAULT_LIST,
        Some(value) => bounded_limit(value)?,
    };
    guard(host, "clipboard")?;
    let items = host
        .clipboard
        .list_items(host.kernel().context(), keyword, limit as usize)
        .map_err(execution)?;
    guard(host, "clipboard")?;
    let summaries: Vec<_> = items
        .into_iter()
        .map(|item| {
            json!({
                "id": item.id,
                "item_type": item.item_type.as_str(),
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "preview": item.content_text.as_deref().map(preview),
            })
        })
        .collect();
    Ok(json!({"items": summaries}))
}

fn clipboard_read(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    let map = require_exact(params, &["id"])?;
    let id = required_positive_i64(map, "id")?;
    guard(host, "clipboard")?;
    let item = host
        .clipboard
        .get_item_by_id(host.kernel().context(), id)
        .map_err(execution)?
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "clipboard item was not found"))?;
    if item.item_type.as_str() != "text" {
        return Err(ControlError::new(
            "INVALID_REQUEST",
            "clipboard item is not text",
        ));
    }
    let text = item.content_text.unwrap_or_default();
    if text.len() > MAX_TEXT_BYTES {
        return Err(ControlError::new("INVALID_REQUEST", "clipboard text exceeds 64KiB"));
    }
    guard(host, "clipboard")?;
    Ok(json!({"id": id, "text": text}))
}

fn clipboard_write(
    host: &DesktopHost,
    params: &Value,
    cancel: &AtomicBool,
) -> Result<Value, ControlError> {
    let map = require_exact(params, &["text"])?;
    let text = match map.get("text") {
        Some(Value::String(text)) => text.clone(),
        _ => return Err(ControlError::new("INVALID_REQUEST", "text must be a string")),
    };
    if text.is_empty() || text.len() > MAX_TEXT_BYTES {
        return Err(ControlError::new(
            "INVALID_REQUEST",
            "text must be 1 to 65536 bytes",
        ));
    }
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    guard(host, "clipboard")?;
    let _lease = host.kernel().context().event_bus.acquire_clipboard_suppression(
        "clipboard",
        "agent_write",
        Duration::from_secs(5),
    );
    let backend = if host.mock_hal.is_some() {
        host.agent_clipboard_writes.lock().push(text.clone());
        "mock"
    } else {
        let mut clipboard = arboard::Clipboard::new().map_err(|_| {
            ControlError::new("UNAVAILABLE", "system clipboard could not be opened")
        })?;
        clipboard.set_text(text.clone()).map_err(|_| {
            ControlError::new("UNAVAILABLE", "system clipboard rejected the text")
        })?;
        "os"
    };
    let record = host
        .clipboard
        .record_explicit_text(host.kernel().context(), &text)
        .map_err(execution)?;
    guard(host, "clipboard")?;
    remember_commit(host, cancel);
    Ok(json!({
        "id": record.id,
        "backend": backend,
        "recorded": true,
    }))
}

fn ink_clear(host: &DesktopHost, params: &Value, cancel: &AtomicBool) -> Result<Value, ControlError> {
    guard(host, "screen_ink")?;
    require_exact(params, &[])?;
    let Some(session) = host.agent_ui.session_for_ink() else {
        return Err(ControlError::new(
            "UNAVAILABLE",
            "shared canvas has no draw acknowledgment yet",
        ));
    };
    let bounds = canvas_bounds(host)?;
    let ack = host.agent_ui.roundtrip(
        "screen-ink-canvas",
        &session,
        "screen-ink://agent-command",
        "clear",
        ink_fields(None, &bounds),
        cancel,
    )?;
    if !ack.ok {
        return Err(ui_failure(&ack));
    }
    guard(host, "screen_ink")?;
    Ok(json!({"cleared": true}))
}

fn ink_draw(host: &DesktopHost, params: &Value, cancel: &AtomicBool) -> Result<Value, ControlError> {
    guard(host, "screen_ink")?;
    let count = parse_strokes(host, params)?;
    if host.agent_ui.pointer_active() {
        return Err(ControlError::new("BUSY", "a pointer stroke is active"));
    }
    let Some(session) = host.agent_ui.session_for_ink() else {
        return Err(ControlError::new(
            "UNAVAILABLE",
            "shared canvas has no draw acknowledgment yet",
        ));
    };
    let bounds = canvas_bounds(host)?;
    let strokes = logical_strokes(params, &bounds)?;
    let ack = host.agent_ui.roundtrip(
        "screen-ink-canvas",
        &session,
        "screen-ink://agent-command",
        "draw",
        ink_fields(Some(strokes), &bounds),
        cancel,
    )?;
    if !ack.ok {
        return Err(ui_failure(&ack));
    }
    let applied = ack
        .result
        .get("applied")
        .and_then(Value::as_u64)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "canvas acknowledgment is incomplete"))?;
    if applied > count as u64 {
        return Err(ControlError::new("INVALID_REQUEST", "canvas acknowledgment is incomplete"));
    }
    guard(host, "screen_ink")?;
    Ok(json!({"applied": applied, "revision": host.kernel().agent_revision()}))
}

fn ink_snapshot(host: &DesktopHost, params: &Value, cancel: &AtomicBool) -> Result<Value, ControlError> {
    guard(host, "screen_ink")?;
    require_exact(params, &[])?;
    let Some(session) = host.agent_ui.session_for_ink() else {
        return Err(ControlError::new(
            "UNAVAILABLE",
            "shared canvas pixels are not available to native",
        ));
    };
    let bounds = canvas_bounds(host)?;
    let ack = host.agent_ui.roundtrip(
        "screen-ink-canvas",
        &session,
        "screen-ink://agent-command",
        "snapshot",
        ink_fields(None, &bounds),
        cancel,
    )?;
    if !ack.ok {
        return Err(ui_failure(&ack));
    }
    let claimed_width = ack
        .result
        .get("width")
        .and_then(Value::as_u64)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "canvas acknowledgment is incomplete"))?;
    let claimed_height = ack
        .result
        .get("height")
        .and_then(Value::as_u64)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "canvas acknowledgment is incomplete"))?;
    let encoded = ack
        .result
        .get("png_base64")
        .and_then(Value::as_str)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "canvas acknowledgment is incomplete"))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)
        .map_err(|_| ControlError::new("INVALID_REQUEST", "png is not valid"))?;
    let (width, height) = crate::agent_artifacts::validate_png(&bytes)?;
    if u64::from(width) != claimed_width || u64::from(height) != claimed_height {
        return Err(ControlError::new("INVALID_REQUEST", "png metadata does not match"));
    }
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    guard(host, "screen_ink")?;
    let epoch = host.kernel().agent_grant_epoch("screen_ink");
    let artifact_id = uuid::Uuid::new_v4().simple().to_string();
    host.agent_artifacts.lock().insert(
        artifact_id.clone(),
        "screen_ink",
        bytes.clone(),
        width,
        height,
        epoch,
    )?;
    remember_commit(host, cancel);
    Ok(json!({
        "artifact_id": artifact_id,
        "module_id": "screen_ink",
        "mime_type": "image/png",
        "byte_length": bytes.len(),
        "width": width,
        "height": height,
        "synthetic": host.mock_hal.is_some(),
        "revision": epoch,
    }))
}

fn usage_overview(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    guard(host, "app_usage")?;
    let (start, end) = date_range(params, &["start_date", "end_date"])?;
    let overview = host
        .app_usage
        .overview(host.kernel().context(), &start, &end)
        .map_err(execution)?;
    guard(host, "app_usage")?;
    Ok(serde_json::to_value(overview).map_err(internal)?)
}

fn usage_apps(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    guard(host, "app_usage")?;
    let map = require_exact(params, &["start_date", "end_date", "limit"])?;
    let (start, end) = date_pair(map)?;
    let limit = match map.get("limit") {
        None => DEFAULT_LIST,
        Some(value) => bounded_limit(value)?,
    } as usize;
    let mut overview = host
        .app_usage
        .overview(host.kernel().context(), &start, &end)
        .map_err(execution)?;
    overview.apps.truncate(limit);
    guard(host, "app_usage")?;
    Ok(json!({
        "start_date": overview.start_date,
        "end_date": overview.end_date,
        "apps": overview.apps,
    }))
}

fn usage_hourly(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    guard(host, "app_usage")?;
    let map = require_exact(params, &["date"])?;
    let date = match map.get("date") {
        Some(Value::String(value)) => value.clone(),
        _ => return Err(ControlError::new("INVALID_REQUEST", "date must be YYYY-MM-DD")),
    };
    mod_app_usage::store::ensure_bounded_range(&date, &date, 1).map_err(|_| {
        ControlError::new("INVALID_REQUEST", "date must be YYYY-MM-DD")
    })?;
    let hourly = host
        .app_usage
        .hourly(host.kernel().context(), &date)
        .map_err(execution)?;
    guard(host, "app_usage")?;
    Ok(serde_json::to_value(hourly).map_err(internal)?)
}

fn notes_search(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    guard(host, "sticky_note")?;
    let map = require_exact(params, &["query", "limit", "offset"])?;
    let query = match map.get("query") {
        None => None,
        Some(Value::String(value))
            if !value.contains('\0') && value.chars().count() <= MAX_QUERY_SCALARS =>
        {
            if value.is_empty() {
                None
            } else {
                Some(value.as_str())
            }
        }
        _ => return Err(ControlError::new("INVALID_REQUEST", "query is invalid")),
    };
    let limit = match map.get("limit") {
        None => NOTE_LIST_LIMIT,
        Some(value) => note_limit(value)?,
    };
    let offset = match map.get("offset") {
        None => 0,
        Some(value) => {
            let offset = value
                .as_i64()
                .filter(|offset| (0..=MAX_NOTE_OFFSET).contains(offset))
                .ok_or_else(|| ControlError::new("INVALID_REQUEST", "offset is out of range"))?;
            offset
        }
    };
    let notes = host
        .sticky_note
        .search_summaries(
            host.kernel().context(),
            query,
            limit as usize,
            offset as usize,
        )
        .map_err(execution)?;
    guard(host, "sticky_note")?;
    Ok(json!({ "items": notes }))
}

fn notes_read(host: &DesktopHost, params: &Value, cancel: &AtomicBool) -> Result<Value, ControlError> {
    guard(host, "sticky_note")?;
    let map = require_exact(params, &["id"])?;
    let id = required_note_id(map)?;
    let mut note = host
        .sticky_note
        .get_note(host.kernel().context(), &id)
        .map_err(execution)?
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "note was not found"))?;
    // A write cursor left by commit_agent_update is only an autosave fence.
    // Handshake is required for an open window, and only after that window
    // has registered with toolbox_agent_ui_ready.
    if note.is_open {
        if host.agent_ui.session_for_note(&id).is_none() {
            return Err(ControlError::new(
                "UNAVAILABLE",
                "open note editor is not synchronized yet",
            ));
        }
        sync_open_editor(host, &id, cancel)?;
        note = host
            .sticky_note
            .get_note(host.kernel().context(), &id)
            .map_err(execution)?
            .ok_or_else(|| ControlError::new("INVALID_REQUEST", "note was not found"))?;
    }
    if note.content_md.len() > MAX_NOTE_BODY {
        return Err(ControlError::new(
            "INVALID_REQUEST",
            "note body exceeds 256KiB",
        ));
    }
    guard(host, "sticky_note")?;
    Ok(json!({
        "id": note.id,
        "title": note.title,
        "content_md": note.content_md,
        "updated_at": note.updated_at,
        "is_open": note.is_open,
    }))
}

fn notes_create(
    host: &DesktopHost,
    params: &Value,
    cancel: &AtomicBool,
) -> Result<Value, ControlError> {
    guard(host, "sticky_note")?;
    let map = require_exact(params, &["title", "content_md"])?;
    let title = required_title(map)?;
    let content = optional_body(map)?;
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    guard(host, "sticky_note")?;
    let note = host
        .sticky_note
        .create_closed_note(host.kernel().context(), Some(&title), Some(&content))
        .map_err(execution)?;
    guard(host, "sticky_note")?;
    remember_commit(host, cancel);
    Ok(json!({
        "id": note.id,
        "title": note.title,
        "content_md": note.content_md,
        "updated_at": note.updated_at,
        "is_open": note.is_open,
    }))
}

fn notes_update(
    host: &DesktopHost,
    params: &Value,
    cancel: &AtomicBool,
) -> Result<Value, ControlError> {
    guard(host, "sticky_note")?;
    let map = require_exact(params, &["id", "expected_updated_at", "title", "content_md"])?;
    let id = required_note_id(map)?;
    let expected = required_safe_integer(map, "expected_updated_at")?;
    let title = match map.get("title") {
        None => None,
        Some(_) => Some(required_title(map)?),
    };
    let content = match map.get("content_md") {
        None => None,
        Some(_) => Some(optional_body(map)?),
    };
    if title.is_none() && content.is_none() {
        return Err(ControlError::new(
            "INVALID_REQUEST",
            "title or content_md is required",
        ));
    }
    let existing = host
        .sticky_note
        .get_note(host.kernel().context(), &id)
        .map_err(execution)?
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "note was not found"))?;
    let open = existing.is_open;
    if open {
        if host.agent_ui.session_for_note(&id).is_none() {
            return Err(ControlError::new(
                "UNAVAILABLE",
                "open note editor is not synchronized yet",
            ));
        }
        sync_open_editor(host, &id, cancel)?;
    }
    if cancel.load(Ordering::Acquire) {
        if open {
            release_note(host, &id);
        }
        return Err(ControlError::cancelled());
    }
    guard(host, "sticky_note")?;
    let (outcome, session) = host
        .sticky_note
        .commit_agent_update(
            host.kernel().context(),
            &id,
            title.as_deref(),
            content.as_deref(),
            expected,
        )
        .map_err(execution)?;
    let note = match outcome {
        mod_sticky_note::ClosedNoteSave::Applied(note) => note,
        mod_sticky_note::ClosedNoteSave::Conflict(_) => {
            if open {
                release_note(host, &id);
            }
            return Err(ControlError::new("CONFLICT", "note changed before the update"));
        }
        mod_sticky_note::ClosedNoteSave::Missing => {
            if open {
                release_note(host, &id);
            }
            return Err(ControlError::new("INVALID_REQUEST", "note was not found"));
        }
    };
    remember_commit(host, cancel);
    guard(host, "sticky_note")?;
    let display_sync = if !open {
        "closed"
    } else if cancel.load(Ordering::Acquire) {
        release_note(host, &id);
        "pending"
    } else {
        let applied = apply_open_editor(host, &id, &note, session.unwrap_or(0));
        release_note(host, &id);
        if applied { "applied" } else { "pending" }
    };
    Ok(json!({
        "id": note.id,
        "title": note.title,
        "content_md": note.content_md,
        "updated_at": note.updated_at,
        "is_open": note.is_open,
        "write_session_id": session,
        "display_sync": display_sync,
    }))
}

fn notes_open(
    host: &DesktopHost,
    params: &Value,
    cancel: &AtomicBool,
) -> Result<Value, ControlError> {
    guard(host, "sticky_note")?;
    let map = require_exact(params, &["id"])?;
    let id = required_note_id(map)?;
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    guard(host, "sticky_note")?;
    let note = host
        .sticky_note
        .show_note(host.kernel().context(), &id)
        .map_err(|error| {
            if error.to_string().contains("not found") || error.to_string().contains("未找到") {
                ControlError::new("INVALID_REQUEST", "note was not found")
            } else {
                execution(error)
            }
        })?;
    guard(host, "sticky_note")?;
    Ok(json!({
        "id": note.id,
        "title": note.title,
        "updated_at": note.updated_at,
        "is_open": note.is_open,
        "window_label": mod_sticky_note::StickyNoteModule::window_label_for(&note.id),
    }))
}

fn required_note_id(map: &Map<String, Value>) -> Result<String, ControlError> {
    match map.get("id") {
        Some(Value::String(id))
            if (1..=MAX_NOTE_ID_SCALARS).contains(&id.chars().count())
                && id.chars().all(|ch| !ch.is_control()) =>
        {
            Ok(id.clone())
        }
        _ => Err(ControlError::new("INVALID_REQUEST", "id is invalid")),
    }
}

fn required_title(map: &Map<String, Value>) -> Result<String, ControlError> {
    match map.get("title") {
        Some(Value::String(title))
            if !title.contains('\0')
                && (1..=MAX_TITLE_SCALARS).contains(&title.chars().count()) =>
        {
            Ok(title.clone())
        }
        _ => Err(ControlError::new("INVALID_REQUEST", "title is invalid")),
    }
}

fn optional_body(map: &Map<String, Value>) -> Result<String, ControlError> {
    match map.get("content_md") {
        None => Ok(String::new()),
        Some(Value::String(body)) if !body.contains('\0') && body.len() <= MAX_NOTE_BODY => {
            Ok(body.clone())
        }
        _ => Err(ControlError::new("INVALID_REQUEST", "content_md is invalid")),
    }
}

fn required_safe_integer(map: &Map<String, Value>, key: &str) -> Result<i64, ControlError> {
    let value = map
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| (0..=JS_MAX_SAFE_INTEGER).contains(value))
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "expected a safe integer"))?;
    Ok(value)
}

fn note_limit(value: &Value) -> Result<i64, ControlError> {
    value
        .as_i64()
        .filter(|limit| (1..=NOTE_LIST_LIMIT).contains(limit))
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "limit must be 1 to 20"))
}

fn artifacts_read(host: &DesktopHost, params: &Value, cancel: &AtomicBool) -> Result<Value, ControlError> {
    let map = require_exact(params, &["artifact_id", "module_id", "offset", "length"])?;
    let artifact_id = match map.get("artifact_id").and_then(Value::as_str) {
        Some(id) if id.len() == 32 && id.chars().all(|ch| ch.is_ascii_hexdigit()) => id.to_string(),
        _ => return Err(ControlError::new("INVALID_REQUEST", "artifact id is invalid")),
    };
    let module_id = match map.get("module_id").and_then(Value::as_str) {
        Some(id) => id.to_string(),
        _ => return Err(ControlError::new("INVALID_REQUEST", "module_id is invalid")),
    };
    let offset = map
        .get("offset")
        .and_then(Value::as_u64)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "offset must be an unsigned integer"))?;
    let length = map
        .get("length")
        .and_then(Value::as_u64)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "length must be an unsigned integer"))?;
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    host.agent_artifacts
        .lock()
        .read(host, &artifact_id, &module_id, offset, length)
}

fn remember_commit(host: &DesktopHost, cancel: &AtomicBool) {
    if host
        .agent_flip_cancel_on_commit
        .swap(false, Ordering::AcqRel)
    {
        cancel.store(true, Ordering::Release);
    }
}

fn sync_open_editor(host: &DesktopHost, note_id: &str, cancel: &AtomicBool) -> Result<(), ControlError> {
    let session = host.agent_ui.session_for_note(note_id).ok_or_else(|| {
        ControlError::new("UNAVAILABLE", "open note editor is not synchronized yet")
    })?;
    let label = format!("sticky-note-{note_id}");
    let mut fields = Map::new();
    fields.insert("note_id".to_string(), json!(note_id));
    let ack = match host.agent_ui.roundtrip(
        &label,
        &session,
        "sticky://agent-command",
        "prepare",
        fields,
        cancel,
    ) {
        Ok(ack) => ack,
        Err(error) => {
            release_note(host, note_id);
            return Err(error);
        }
    };
    if !ack.ok {
        release_note(host, note_id);
        return Err(ui_failure(&ack));
    }
    Ok(())
}

fn apply_open_editor(host: &DesktopHost, note_id: &str, note: &mod_sticky_note::StickyNoteRecord, write_session_id: u64) -> bool {
    let Some(session) = host.agent_ui.session_for_note(note_id) else {
        return false;
    };
    let label = format!("sticky-note-{note_id}");
    let mut fields = Map::new();
    fields.insert("note_id".to_string(), json!(note_id));
    fields.insert("write_session_id".to_string(), json!(write_session_id));
    fields.insert(
        "record".to_string(),
        json!({
            "id": note.id,
            "title": note.title,
            "content_md": note.content_md,
            "updated_at": note.updated_at,
            "is_open": note.is_open,
        }),
    );
    matches!(
        host.agent_ui.roundtrip(
            &label,
            &session,
            "sticky://agent-command",
            "apply",
            fields,
            &AtomicBool::new(false),
        ),
        Ok(ack) if ack.ok
    )
}

fn release_note(host: &DesktopHost, note_id: &str) {
    let Some(session) = host.agent_ui.session_for_note(note_id) else {
        return;
    };
    let label = format!("sticky-note-{note_id}");
    let mut fields = Map::new();
    fields.insert("note_id".to_string(), json!(note_id));
    let _ = host.agent_ui.roundtrip(
        &label,
        &session,
        "sticky://agent-command",
        "release",
        fields,
        &AtomicBool::new(false),
    );
}

fn ui_failure(ack: &crate::agent_ui::Ack) -> ControlError {
    if ack.code == "BUSY" {
        ControlError::new("BUSY", "the original window is busy")
    } else if ack.code == "CONFLICT" {
        ControlError::new("CONFLICT", "the original window kept its draft")
    } else {
        ControlError::new("UNAVAILABLE", "original window did not apply the request")
    }
}

struct CanvasBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

fn canvas_bounds(host: &DesktopHost) -> Result<CanvasBounds, ControlError> {
    let window = host
        .kernel()
        .context()
        .window_pool
        .get_active_window("screen-ink-canvas")
        .ok_or_else(|| ControlError::new("UNAVAILABLE", "shared canvas has no draw acknowledgment yet"))?;
    let monitors = host
        .os_hal
        .screen_capturer
        .list_monitors()
        .map_err(|_| ControlError::new("UNAVAILABLE", "display list is not available"))?;
    let primary = monitors
        .iter()
        .find(|monitor| monitor.is_primary)
        .or_else(|| monitors.first())
        .ok_or_else(|| ControlError::new("UNAVAILABLE", "display list is not available"))?;
    let scale = if primary.scale_factor > 0.1 { primary.scale_factor } else { 1.0 };
    let logical_x = window.spec.x.unwrap_or(0.0);
    let logical_y = window.spec.y.unwrap_or(0.0);
    Ok(CanvasBounds {
        x: f64::from(primary.x) + logical_x * scale,
        y: f64::from(primary.y) + logical_y * scale,
        width: window.spec.width * scale,
        height: window.spec.height * scale,
        scale,
    })
}

fn canvas_local(px: f64, py: f64, bounds: &CanvasBounds) -> Result<(f64, f64), ControlError> {
    if !px.is_finite() || !py.is_finite() || bounds.scale <= 0.0 {
        return Err(ControlError::new("INVALID_REQUEST", "point is not finite"));
    }
    let x = (px - bounds.x) / bounds.scale;
    let y = (py - bounds.y) / bounds.scale;
    let logical_w = bounds.width / bounds.scale;
    let logical_h = bounds.height / bounds.scale;
    if x < 0.0 || y < 0.0 || x >= logical_w || y >= logical_h {
        return Err(ControlError::new("INVALID_REQUEST", "point is outside the canvas"));
    }
    Ok((x, y))
}

fn logical_strokes(params: &Value, bounds: &CanvasBounds) -> Result<Value, ControlError> {
    let strokes = params
        .get("strokes")
        .and_then(Value::as_array)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "strokes must be an array"))?;
    let mut out = Vec::new();
    for stroke in strokes {
        let points = stroke
            .get("points")
            .and_then(Value::as_array)
            .ok_or_else(|| ControlError::new("INVALID_REQUEST", "points must be an array"))?;
        let mut logical = Vec::new();
        for point in points {
            let x = point.get("x").and_then(Value::as_f64).unwrap_or(f64::NAN);
            let y = point.get("y").and_then(Value::as_f64).unwrap_or(f64::NAN);
            let (x, y) = canvas_local(x, y, bounds)?;
            logical.push(json!({"x": x, "y": y}));
        }
        out.push(json!({
            "points": logical,
            "color": stroke.get("color").cloned().unwrap_or(Value::Null),
            "width": stroke.get("width").cloned().unwrap_or(Value::Null),
        }));
    }
    Ok(Value::Array(out))
}

fn ink_fields(strokes: Option<Value>, bounds: &CanvasBounds) -> Map<String, Value> {
    let mut fields = Map::new();
    if let Some(strokes) = strokes {
        fields.insert("strokes".to_string(), strokes);
    }
    fields.insert(
        "canvas_bounds".to_string(),
        json!({
            "x": bounds.x,
            "y": bounds.y,
            "width": bounds.width,
            "height": bounds.height,
            "scale_factor": bounds.scale,
        }),
    );
    fields
}

fn guard(host: &DesktopHost, module_id: &str) -> Result<(), ControlError> {
    host.kernel()
        .authorize_agent(module_id)
        .map_err(agent_control)
}

fn agent_control(error: CoreError) -> ControlError {
    let code = agent_error_code(&error).unwrap_or("INTERNAL");
    ControlError::new(code, error.to_string())
}

fn execution(error: CoreError) -> ControlError {
    if let Some(code) = agent_error_code(&error) {
        return ControlError::new(code, error.to_string());
    }
    ControlError::new("INTERNAL", "agent request failed")
}

fn internal(error: impl std::fmt::Display) -> ControlError {
    let _ = error;
    ControlError::new("INTERNAL", "agent request failed")
}

fn require_exact<'a>(
    params: &'a Value,
    keys: &[&str],
) -> Result<&'a Map<String, Value>, ControlError> {
    let map = params
        .as_object()
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "params must be an object"))?;
    if map.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(ControlError::new("INVALID_REQUEST", "unexpected arguments"));
    }
    Ok(map)
}

fn required_bool(params: &Value, key: &str, keys: &[&str]) -> Result<bool, ControlError> {
    let map = require_exact(params, keys)?;
    map.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "expected a boolean"))
}

fn required_u32(map: &Map<String, Value>, key: &str) -> Result<u32, ControlError> {
    let value = map
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "expected an unsigned integer"))?;
    u32::try_from(value).map_err(|_| ControlError::new("INVALID_REQUEST", "integer is out of range"))
}

fn required_positive_i64(map: &Map<String, Value>, key: &str) -> Result<i64, ControlError> {
    let value = map
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "expected a positive integer"))?;
    Ok(value)
}

fn bounded_limit(value: &Value) -> Result<i64, ControlError> {
    let limit = value
        .as_i64()
        .filter(|limit| (1..=MAX_LIST).contains(limit))
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "limit must be 1 to 100"))?;
    Ok(limit)
}

fn date_range(params: &Value, keys: &[&str]) -> Result<(String, String), ControlError> {
    let map = require_exact(params, keys)?;
    date_pair(map)
}

fn date_pair(map: &Map<String, Value>) -> Result<(String, String), ControlError> {
    let start = match map.get("start_date") {
        Some(Value::String(value)) => value.clone(),
        _ => return Err(ControlError::new("INVALID_REQUEST", "start_date must be YYYY-MM-DD")),
    };
    let end = match map.get("end_date") {
        Some(Value::String(value)) => value.clone(),
        _ => return Err(ControlError::new("INVALID_REQUEST", "end_date must be YYYY-MM-DD")),
    };
    mod_app_usage::store::ensure_bounded_range(&start, &end, MAX_RANGE_DAYS).map_err(|_| {
        ControlError::new("INVALID_REQUEST", "date range must be ordered and at most 31 days")
    })?;
    Ok((start, end))
}

struct Region {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

fn parse_region(value: &Value) -> Result<Region, ControlError> {
    let map = value
        .as_object()
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "region must be an object"))?;
    if map.len() != 4 {
        return Err(ControlError::new("INVALID_REQUEST", "region accepts only x,y,width,height"));
    }
    Ok(Region {
        x: required_u32(map, "x")?,
        y: required_u32(map, "y")?,
        width: required_u32(map, "width")?,
        height: required_u32(map, "height")?,
    })
}

fn crop_frame(
    rgba: &[u8],
    frame_width: u32,
    frame_height: u32,
    region: Option<Region>,
) -> Result<(u32, u32, Vec<u8>), ControlError> {
    let pixels = u64::from(frame_width) * u64::from(frame_height);
    if frame_width == 0
        || frame_height == 0
        || pixels > MAX_PIXELS
        || rgba.len() != pixels as usize * 4
    {
        return Err(ControlError::new("UNAVAILABLE", "captured frame is not usable"));
    }
    let region = region.unwrap_or(Region {
        x: 0,
        y: 0,
        width: frame_width,
        height: frame_height,
    });
    if region.width == 0
        || region.height == 0
        || region.x.saturating_add(region.width) > frame_width
        || region.y.saturating_add(region.height) > frame_height
    {
        return Err(ControlError::new(
            "INVALID_REQUEST",
            "region is outside the monitor frame",
        ));
    }
    let cropped_pixels = u64::from(region.width) * u64::from(region.height);
    if cropped_pixels > MAX_PIXELS {
        return Err(ControlError::new("INVALID_REQUEST", "region exceeds the pixel cap"));
    }
    let mut out = vec![0_u8; cropped_pixels as usize * 4];
    for row in 0..region.height {
        let src = (((region.y + row) as usize * frame_width as usize) + region.x as usize) * 4;
        let dst = row as usize * region.width as usize * 4;
        let len = region.width as usize * 4;
        out[dst..dst + len].copy_from_slice(&rgba[src..src + len]);
    }
    Ok((region.width, region.height, out))
}

fn encode_png(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, ControlError> {
    let mut png = Vec::new();
    PngEncoder::new(Cursor::new(&mut png))
        .write_image(pixels, width, height, ExtendedColorType::Rgba8)
        .map_err(|_| ControlError::new("INTERNAL", "png encoding failed"))?;
    Ok(png)
}

fn preview(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars().take(PREVIEW_CHARS) {
        out.push(ch);
    }
    out
}

fn parse_strokes(host: &DesktopHost, params: &Value) -> Result<usize, ControlError> {
    let map = require_exact(params, &["strokes"])?;
    let strokes = map
        .get("strokes")
        .and_then(Value::as_array)
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "strokes must be an array"))?;
    if strokes.is_empty() || strokes.len() > MAX_STROKES {
        return Err(ControlError::new("INVALID_REQUEST", "stroke count is out of range"));
    }
    let monitors = host
        .os_hal
        .screen_capturer
        .list_monitors()
        .map_err(|_| ControlError::new("UNAVAILABLE", "display list is not available"))?;
    let mut points = 0_usize;
    for stroke in strokes {
        let stroke = stroke
            .as_object()
            .ok_or_else(|| ControlError::new("INVALID_REQUEST", "stroke must be an object"))?;
        if stroke.len() != 3 {
            return Err(ControlError::new("INVALID_REQUEST", "stroke has unexpected fields"));
        }
        let color = stroke
            .get("color")
            .and_then(Value::as_str)
            .ok_or_else(|| ControlError::new("INVALID_REQUEST", "color must be #RRGGBB"))?;
        if !is_hex_color(color) {
            return Err(ControlError::new("INVALID_REQUEST", "color must be #RRGGBB"));
        }
        let width = stroke
            .get("width")
            .and_then(Value::as_f64)
            .filter(|width| width.is_finite() && *width > 0.0 && *width <= 64.0)
            .ok_or_else(|| ControlError::new("INVALID_REQUEST", "stroke width is invalid"))?;
        let _ = width;
        let pts = stroke
            .get("points")
            .and_then(Value::as_array)
            .ok_or_else(|| ControlError::new("INVALID_REQUEST", "points must be an array"))?;
        if pts.is_empty() {
            return Err(ControlError::new("INVALID_REQUEST", "stroke has no points"));
        }
        points += pts.len();
        if points > MAX_POINTS {
            return Err(ControlError::new("INVALID_REQUEST", "too many points"));
        }
        for point in pts {
            let point = point
                .as_object()
                .ok_or_else(|| ControlError::new("INVALID_REQUEST", "point must be an object"))?;
            if point.len() != 2 {
                return Err(ControlError::new("INVALID_REQUEST", "point has unexpected fields"));
            }
            let x = point
                .get("x")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
                .ok_or_else(|| ControlError::new("INVALID_REQUEST", "point is not finite"))?;
            let y = point
                .get("y")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
                .ok_or_else(|| ControlError::new("INVALID_REQUEST", "point is not finite"))?;
            if !monitors.iter().any(|monitor| {
                x >= f64::from(monitor.x)
                    && y >= f64::from(monitor.y)
                    && x < f64::from(monitor.x) + f64::from(monitor.width)
                    && y < f64::from(monitor.y) + f64::from(monitor.height)
            }) {
                return Err(ControlError::new("INVALID_REQUEST", "point is outside the displays"));
            }
        }
    }
    Ok(strokes.len())
}

fn is_hex_color(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next() == Some('#')
        && chars.clone().count() == 6
        && chars.all(|ch| ch.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use serde_json::json;

    fn host() -> (tempfile::TempDir, DesktopHost) {
        let dir = tempfile::tempdir().unwrap();
        let host = DesktopHost::bootstrap(dir.path(), true).unwrap();
        (dir, host)
    }

    fn grant(host: &DesktopHost, module_id: &str) {
        host.kernel().set_agent_access(module_id, true).unwrap();
    }

    #[test]
    fn access_snapshot_lists_only_implemented_methods_and_no_content() {
        let (_dir, host) = host();
        let snapshot = dispatch(&host, "agent.get_access", &json!({}), &AtomicBool::new(false)).unwrap();
        assert!(snapshot.get("config").is_none());
        assert!(snapshot["methods"]
            .as_array()
            .unwrap()
            .iter()
            .all(|method| method.as_str().unwrap().starts_with("agent.")));
        let methods = snapshot["methods"].as_array().unwrap();
        assert!(methods.iter().any(|method| method == "agent.ink.draw"));
        assert!(methods.iter().any(|method| method == "agent.ink.snapshot"));
        assert!(!methods.iter().any(|method| method == "agent.artifacts.read"));
        assert!(snapshot["methods"]
            .as_array()
            .unwrap()
            .iter()
            .any(|method| method == "agent.notes.search"));
        let notes = snapshot["modules"]
            .as_array()
            .unwrap()
            .iter()
            .find(|module| module["id"] == "sticky_note")
            .unwrap();
        assert_eq!(notes["agent_supported"], true);
        assert_eq!(notes["agent_allowed"], false);
        let clipboard = snapshot["modules"]
            .as_array()
            .unwrap()
            .iter()
            .find(|module| module["id"] == "clipboard")
            .unwrap();
        assert_eq!(clipboard["agent_effective"], false);
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn clipboard_write_uses_the_mock_sink_and_the_same_history() {
        let (_dir, host) = host();
        grant(&host, "clipboard");
        let denied = dispatch(
            &host,
            "agent.clipboard.write_text",
            &json!({"text": "synthetic-agent-clip", "actor": "human"}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(denied.code, "INVALID_REQUEST");
        let written = dispatch(
            &host,
            "agent.clipboard.write_text",
            &json!({"text": "synthetic-agent-clip"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(written["backend"], "mock");
        assert_eq!(
            host.agent_clipboard_writes.lock().as_slice(),
            ["synthetic-agent-clip"]
        );
        let listed = dispatch(
            &host,
            "agent.clipboard.list",
            &json!({"limit": 20}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(listed["items"][0]["preview"], "synthetic-agent-clip");
        let id = written["id"].as_i64().unwrap();
        let read = dispatch(
            &host,
            "agent.clipboard.read_text",
            &json!({"id": id}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(read["text"], "synthetic-agent-clip");
        host.kernel().set_agent_access("clipboard", false).unwrap();
        let revoked = dispatch(&host, "agent.clipboard.list", &json!({}), &AtomicBool::new(false)).unwrap_err();
        assert_eq!(revoked.code, "AGENT_ACCESS_DENIED");
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn cancelled_clipboard_write_does_not_record() {
        let (_dir, host) = host();
        grant(&host, "clipboard");
        let error = dispatch(
            &host,
            "agent.clipboard.write_text",
            &json!({"text": "do-not-record"}),
            &AtomicBool::new(true),
        )
        .unwrap_err();
        assert_eq!(error.code, "CANCELLED");
        assert!(host.agent_clipboard_writes.lock().is_empty());
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn screenshot_artifact_is_synthetic_and_unreadable_after_revoke() {
        let (_dir, host) = host();
        grant(&host, "screenshot");
        let monitors = dispatch(&host, "agent.screenshot.monitors", &json!({}), &AtomicBool::new(false)).unwrap();
        assert_eq!(monitors["synthetic"], true);
        let captured = dispatch(
            &host,
            "agent.screenshot.capture",
            &json!({"monitor_id": 1, "region": {"x": 0, "y": 0, "width": 8, "height": 8}}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(captured["mime_type"], "image/png");
        assert_eq!(captured["synthetic"], true);
        assert_eq!(captured["width"], 8);
        let bytes = load_screenshot_artifact(&host, captured["artifact_id"].as_str().unwrap()).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        host.kernel().set_agent_access("screenshot", false).unwrap();
        let denied = load_screenshot_artifact(&host, captured["artifact_id"].as_str().unwrap()).unwrap_err();
        assert_eq!(denied.code, "AGENT_ACCESS_DENIED");
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn ink_draw_and_snapshot_do_not_pretend_the_canvas_moved() {
        let (_dir, host) = host();
        grant(&host, "screen_ink");
        let started = dispatch(&host, "agent.ink.start", &json!({}), &AtomicBool::new(false)).unwrap();
        assert_eq!(started["is_active"], true);
        let bad = dispatch(
            &host,
            "agent.ink.draw",
            &json!({"strokes": [{"points": [{"x": 1e20, "y": 0.0}], "color": "#ff0000", "width": 2.0}]}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(bad.code, "INVALID_REQUEST");
        let pending = dispatch(
            &host,
            "agent.ink.draw",
            &json!({"strokes": [{"points": [{"x": 10.0, "y": 12.0}], "color": "#112233", "width": 2.0}]}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(pending.code, "UNAVAILABLE");
        assert!(pending.message.contains("acknowledgment"));
        let snapshot = dispatch(&host, "agent.ink.snapshot", &json!({}), &AtomicBool::new(false)).unwrap_err();
        assert_eq!(snapshot.code, "UNAVAILABLE");
        assert!(snapshot.message.contains("pixels"));
        let media = dispatch(&host, "agent.media.transcribe", &json!({}), &AtomicBool::new(false)).unwrap_err();
        assert_eq!(media.code, "UNSUPPORTED");
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn usage_query_matches_the_human_overview_and_does_not_enable_tracking() {
        let (_dir, host) = host();
        assert!(host.app_usage.is_tracking());
        host.kernel().set_module_enabled("app_usage", false).unwrap();
        assert!(!host.app_usage.is_tracking());
        let disabled = dispatch(
            &host,
            "agent.usage.overview",
            &json!({"start_date": "2026-11-01", "end_date": "2026-11-13"}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(disabled.code, "MODULE_DISABLED");
        host.kernel().set_module_enabled("app_usage", true).unwrap();
        assert!(host.app_usage.is_tracking());
        grant(&host, "app_usage");
        let agent = dispatch(
            &host,
            "agent.usage.overview",
            &json!({"start_date": "2026-11-01", "end_date": "2026-11-13"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        let human = host
            .invoke_ipc(
                "usage_get_overview",
                json!({"start_date": "2026-11-01", "end_date": "2026-11-13"}),
            )
            .data
            .unwrap();
        assert_eq!(agent["total_seconds"], human["total_seconds"]);
        let too_long = dispatch(
            &host,
            "agent.usage.overview",
            &json!({"start_date": "2026-01-01", "end_date": "2026-03-01"}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(too_long.code, "INVALID_REQUEST");
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn closed_notes_share_the_database_and_reject_stale_or_open_edits() {
        let (_dir, host) = host();
        let denied = dispatch(
            &host,
            "agent.notes.create",
            &json!({"title": "synthetic"}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(denied.code, "AGENT_ACCESS_DENIED");
        grant(&host, "sticky_note");
        let invalid = dispatch(&host, "agent.notes.create", &json!({}), &AtomicBool::new(false)).unwrap_err();
        assert_eq!(invalid.code, "INVALID_REQUEST");
        let created = dispatch(
            &host,
            "agent.notes.create",
            &json!({"title": "synthetic", "content_md": "alpha"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(created["is_open"], false);
        let id = created["id"].as_str().unwrap();
        let found = dispatch(
            &host,
            "agent.notes.search",
            &json!({"query": "alpha", "limit": 20, "offset": 0}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(found.get("total").is_none());
        assert_eq!(found["items"][0]["id"], id);
        assert!(found["items"][0].get("content_md").is_none());
        let read = dispatch(&host, "agent.notes.read", &json!({"id": id}), &AtomicBool::new(false)).unwrap();
        assert_eq!(read["content_md"], "alpha");
        let human = host
            .sticky_note
            .save_closed_content(
                host.kernel().context(),
                id,
                None,
                Some("human-edit"),
                Some(read["updated_at"].as_i64().unwrap()),
            )
            .unwrap();
        let mod_sticky_note::ClosedNoteSave::Applied(human_note) = human else {
            panic!("human edit was not stored");
        };
        let conflict = dispatch(
            &host,
            "agent.notes.update",
            &json!({"id": id, "expected_updated_at": read["updated_at"], "content_md": "lost"}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(conflict.code, "CONFLICT");
        assert_eq!(
            host.sticky_note.get_note(host.kernel().context(), id).unwrap().unwrap().content_md,
            "human-edit"
        );
        let updated = dispatch(
            &host,
            "agent.notes.update",
            &json!({"id": id, "expected_updated_at": human_note.updated_at, "title": "synthetic-2"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(updated["title"], "synthetic-2");
        assert_eq!(updated["content_md"], "human-edit");
        assert_eq!(updated["display_sync"], "closed");
        assert!(host.sticky_note.has_write_session(id));
        let reread = dispatch(&host, "agent.notes.read", &json!({"id": id}), &AtomicBool::new(false)).unwrap();
        assert_eq!(reread["content_md"], "human-edit");
        assert_eq!(reread["title"], "synthetic-2");
        let again = dispatch(
            &host,
            "agent.notes.update",
            &json!({"id": id, "expected_updated_at": reread["updated_at"], "content_md": "second"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(again["content_md"], "second");
        assert_eq!(again["display_sync"], "closed");
        let stale = host
            .sticky_note
            .save_content(host.kernel().context(), id, None, "old-autosave", Some(1), None)
            .unwrap();
        assert!(!stale.applied);
        let current = host.sticky_note.get_note(host.kernel().context(), id).unwrap().unwrap();
        assert_eq!(current.content_md, "second");
        let opened = dispatch(&host, "agent.notes.open", &json!({"id": id}), &AtomicBool::new(false)).unwrap();
        assert_eq!(opened["is_open"], true);
        assert_eq!(opened["window_label"], format!("sticky-note-{id}"));
        let unread = dispatch(&host, "agent.notes.read", &json!({"id": id}), &AtomicBool::new(false)).unwrap_err();
        assert_eq!(unread.code, "UNAVAILABLE");
        host.sticky_note.close_note(host.kernel().context(), id).unwrap();
        let after_close = dispatch(&host, "agent.notes.read", &json!({"id": id}), &AtomicBool::new(false)).unwrap();
        assert_eq!(after_close["content_md"], "second");
        assert_eq!(after_close["is_open"], false);
        let closed_edit = dispatch(
            &host,
            "agent.notes.update",
            &json!({"id": id, "expected_updated_at": after_close["updated_at"], "title": "after-close"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(closed_edit["title"], "after-close");
        assert_eq!(closed_edit["display_sync"], "closed");
        assert!(host.sticky_note.has_write_session(id));
        let huge = "x".repeat(256 * 1024 + 1);
        let oversized = dispatch(
            &host,
            "agent.notes.create",
            &json!({"title": "big", "content_md": huge}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(oversized.code, "INVALID_REQUEST");
        let _ = host.kernel().shutdown();
    }

    struct SyncPtr(*const DesktopHost);
    unsafe impl Send for SyncPtr {}
    unsafe impl Sync for SyncPtr {}
    impl SyncPtr {
        fn host(&self) -> &DesktopHost {
            unsafe { &*self.0 }
        }
    }

    #[test]
    fn open_editor_flushes_before_cas_and_blocks_the_old_autosave() {
        let (_dir, host) = host();
        grant(&host, "sticky_note");
        let created = dispatch(
            &host,
            "agent.notes.create",
            &json!({"title": "synthetic", "content_md": "alpha"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        let id = created["id"].as_str().unwrap().to_string();
        let original = created["updated_at"].as_i64().unwrap();
        dispatch(&host, "agent.notes.open", &json!({"id": id}), &AtomicBool::new(false)).unwrap();
        let page = host.sticky_note.begin_write_session(host.kernel().context(), &id).unwrap();
        let ready = host.invoke_agent_ui(
            &format!("sticky-note-{id}"),
            "toolbox_agent_ui_ready",
            json!({"kind": "notes", "note_id": id}),
        );
        assert!(ready.ok, "{:?}", ready.error);
        let flushed = AtomicBool::new(false);
        let ui = std::sync::Arc::downgrade(&host.agent_ui);
        let ptr = SyncPtr(&host as *const DesktopHost);
        let note_id = id.clone();
        host.agent_ui.set_emitter(std::sync::Arc::new(move |label, _event, payload| {
            let host = ptr.host();
            let operation = payload["operation"].as_str().unwrap_or("");
            if operation == "prepare" && !flushed.swap(true, Ordering::AcqRel) {
                host.sticky_note
                    .save_content(
                        host.kernel().context(),
                        &note_id,
                        None,
                        "user-draft",
                        Some(1),
                        Some(page),
                    )
                    .unwrap();
            }
            let Some(ui) = ui.upgrade() else { return };
            let _ = ui.handle(
                label,
                "toolbox_agent_ui_result",
                &json!({
                    "kind": "notes",
                    "request_id": payload["request_id"],
                    "session_id": payload["session_id"],
                    "operation": operation,
                    "ok": true,
                    "result": {}
                }),
            );
        }));
        let conflict = dispatch(
            &host,
            "agent.notes.update",
            &json!({"id": id, "expected_updated_at": original, "content_md": "agent-text"}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(conflict.code, "CONFLICT");
        assert_eq!(
            host.sticky_note.get_note(host.kernel().context(), &id).unwrap().unwrap().content_md,
            "user-draft"
        );
        let current = host.sticky_note.get_note(host.kernel().context(), &id).unwrap().unwrap();
        let updated = dispatch(
            &host,
            "agent.notes.update",
            &json!({"id": id, "expected_updated_at": current.updated_at, "content_md": "agent-text"}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(updated["display_sync"], "applied");
        assert_eq!(updated["content_md"], "agent-text");
        assert_ne!(updated["write_session_id"].as_u64().unwrap(), page);
        let stale = host
            .sticky_note
            .save_content(
                host.kernel().context(),
                &id,
                None,
                "old-autosave",
                Some(2),
                Some(page),
            )
            .unwrap();
        assert!(!stale.applied);
        assert_eq!(
            host.sticky_note.get_note(host.kernel().context(), &id).unwrap().unwrap().content_md,
            "agent-text"
        );
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn canvas_ack_transforms_points_and_late_replies_do_not_apply() {
        let (x, y) = canvas_local(
            -1916.0,
            4.0,
            &CanvasBounds { x: -1920.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 2.0 },
        )
        .unwrap();
        assert_eq!((x, y), (2.0, 2.0));
        let (_dir, host) = host();
        grant(&host, "screen_ink");
        dispatch(&host, "agent.ink.start", &json!({}), &AtomicBool::new(false)).unwrap();
        let wrong = host.invoke_agent_ui("dashboard", "toolbox_agent_ui_ready", json!({"kind": "ink"}));
        assert!(!wrong.ok);
        let ready = host.invoke_agent_ui("screen-ink-canvas", "toolbox_agent_ui_ready", json!({"kind": "ink"}));
        assert!(ready.ok, "{:?}", ready.error);
        host.agent_ui.set_pointer_active(true);
        let busy = dispatch(
            &host,
            "agent.ink.draw",
            &json!({"strokes": [{"points": [{"x": 4.0, "y": 6.0}], "color": "#112233", "width": 2.0}]}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(busy.code, "BUSY");
        host.agent_ui.set_pointer_active(false);
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen_emit = seen.clone();
        let ui = std::sync::Arc::downgrade(&host.agent_ui);
        host.agent_ui.set_emitter(std::sync::Arc::new(move |label, _event, payload| {
            seen_emit.lock().unwrap().push(payload.clone());
            let Some(ui) = ui.upgrade() else { return };
            let operation = payload["operation"].as_str().unwrap_or("");
            let result = if operation == "draw" {
                json!({"applied": 1})
            } else {
                json!({})
            };
            let _ = ui.handle(
                label,
                "toolbox_agent_ui_result",
                &json!({
                    "kind": "ink",
                    "request_id": payload["request_id"],
                    "session_id": payload["session_id"],
                    "operation": operation,
                    "ok": true,
                    "result": result
                }),
            );
        }));
        let drawn = dispatch(
            &host,
            "agent.ink.draw",
            &json!({"strokes": [{"points": [{"x": 4.0, "y": 6.0}], "color": "#112233", "width": 2.0}]}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(drawn["applied"], 1);
        let payload = seen.lock().unwrap().last().cloned().unwrap();
        assert_eq!(payload["strokes"][0]["points"][0]["x"], 2.0);
        assert_eq!(payload["strokes"][0]["points"][0]["y"], 3.0);
        assert_eq!(payload["canvas_bounds"]["scale_factor"], 2.0);
        let duplicate = host.invoke_agent_ui(
            "screen-ink-canvas",
            "toolbox_agent_ui_result",
            json!({
                "kind": "ink",
                "request_id": payload["request_id"],
                "session_id": payload["session_id"],
                "operation": "draw",
                "ok": true,
                "result": {"applied": 1}
            }),
        );
        assert_eq!(duplicate.data.unwrap()["acknowledged"], false);
        host.agent_ui.set_timeout_for_test(std::time::Duration::from_millis(40));
        host.agent_ui.set_emitter(std::sync::Arc::new(|_label, _event, _payload| {}));
        let late = dispatch(&host, "agent.ink.clear", &json!({}), &AtomicBool::new(false)).unwrap_err();
        assert_eq!(late.code, "UNAVAILABLE");
        let _ = host.kernel().shutdown();
    }

    #[test]
    fn artifact_chunks_follow_the_grant_epoch_and_late_cancel_keeps_commits() {
        let (_dir, host) = host();
        grant(&host, "screenshot");
        grant(&host, "clipboard");
        host.agent_flip_cancel_on_commit.store(true, Ordering::Release);
        let cancel = AtomicBool::new(false);
        let written = dispatch(
            &host,
            "agent.clipboard.write_text",
            &json!({"text": "committed-after-cancel"}),
            &cancel,
        )
        .unwrap();
        assert_eq!(written["recorded"], true);
        assert!(cancel.load(Ordering::Acquire));
        assert_eq!(host.agent_clipboard_writes.lock().len(), 1);
        let captured = dispatch(
            &host,
            "agent.screenshot.capture",
            &json!({"monitor_id": 1, "region": {"x": 0, "y": 0, "width": 8, "height": 8}}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(captured["module_id"], "screenshot");
        let revision = captured["revision"].as_u64().unwrap();
        let id = captured["artifact_id"].as_str().unwrap();
        let chunk = dispatch(
            &host,
            "agent.artifacts.read",
            &json!({"artifact_id": id, "module_id": "screenshot", "offset": 0, "length": 8}),
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(chunk["revision"], revision);
        assert_eq!(chunk["mime_type"], "image/png");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(chunk["data_base64"].as_str().unwrap())
        .unwrap();
        assert_eq!(bytes.len(), 8);
        assert_eq!(chunk["eof"], false);
        host.kernel().set_agent_access("screenshot", false).unwrap();
        host.kernel().set_agent_access("screenshot", true).unwrap();
        let revived = dispatch(
            &host,
            "agent.artifacts.read",
            &json!({"artifact_id": id, "module_id": "screenshot", "offset": 0, "length": 8}),
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert_eq!(revived.code, "UNAVAILABLE");
        let _ = host.kernel().shutdown();
    }
}
