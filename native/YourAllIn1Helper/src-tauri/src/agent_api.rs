//! Agent data methods on the same desktop kernel. Human IPC is not forwarded here.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use app_core::{agent_error_code, CoreError, MODULE_CATALOG};
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
        "agent.ink.clear" => {
            guard(host, "screen_ink")?;
            require_exact(params, &[])?;
            host.screen_ink
                .clear_canvas(host.kernel().context())
                .map_err(execution)?;
            Ok(json!({"cleared": true}))
        }
        "agent.ink.draw" => ink_draw(host, params),
        "agent.ink.snapshot" => ink_snapshot(host, params),
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
        "agent.notes.read" => notes_read(host, params),
        "agent.notes.create" => notes_create(host, params, cancel),
        "agent.notes.update" => notes_update(host, params, cancel),
        "agent.notes.open" => notes_open(host, params, cancel),
        _ => Err(ControlError::new(
            "UNSUPPORTED",
            "method is not an agent data method",
        )),
    }?;
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    Ok(result)
}

pub fn load_screenshot_artifact(host: &DesktopHost, artifact_id: &str) -> Result<Vec<u8>, ControlError> {
    guard(host, "screenshot")?;
    let path = artifact_path(host, artifact_id)?;
    std::fs::read(&path).map_err(|_| ControlError::new("UNAVAILABLE", "screenshot artifact is not available"))
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
    let meta = json!({
        "module": "screenshot",
        "revision": host.kernel().agent_revision(),
        "width": width,
        "height": height,
    });
    if std::fs::write(&sidecar, meta.to_string()).is_err() {
        let _ = std::fs::remove_file(&path);
        return Err(internal(std::io::Error::other("artifact metadata was not stored")));
    }
    guard(host, "screenshot")?;
    Ok(json!({
        "artifact_id": artifact_id,
        "mime_type": "image/png",
        "byte_length": png.len(),
        "width": width,
        "height": height,
        "relative_path": relative,
        "synthetic": host.mock_hal.is_some(),
        "revision": host.kernel().agent_revision(),
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
    if cancel.load(Ordering::Acquire) {
        return Err(ControlError::cancelled());
    }
    let record = host
        .clipboard
        .record_explicit_text(host.kernel().context(), &text)
        .map_err(execution)?;
    guard(host, "clipboard")?;
    Ok(json!({
        "id": record.id,
        "backend": backend,
        "recorded": true,
    }))
}

fn ink_draw(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    guard(host, "screen_ink")?;
    let _strokes = parse_strokes(host, params)?;
    Err(ControlError::new(
        "UNAVAILABLE",
        "shared canvas has no draw acknowledgment yet",
    ))
}

fn ink_snapshot(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    guard(host, "screen_ink")?;
    require_exact(params, &[])?;
    Err(ControlError::new(
        "UNAVAILABLE",
        "shared canvas pixels are not available to native",
    ))
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
    Ok(json!({ "notes": notes }))
}

fn notes_read(host: &DesktopHost, params: &Value) -> Result<Value, ControlError> {
    guard(host, "sticky_note")?;
    let map = require_exact(params, &["id"])?;
    let id = required_note_id(map)?;
    let note = host
        .sticky_note
        .get_note(host.kernel().context(), &id)
        .map_err(execution)?
        .ok_or_else(|| ControlError::new("INVALID_REQUEST", "note was not found"))?;
    if note.is_open || host.sticky_note.has_write_session(&id) {
        return Err(ControlError::new(
            "UNAVAILABLE",
            "open note editor is not synchronized yet",
        ));
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
    if existing.is_open || host.sticky_note.has_write_session(&id) {
        return Err(ControlError::new(
            "UNAVAILABLE",
            "open note editor is not synchronized yet",
        ));
    }
    if cancel.load(Ordering::Acquire) {
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
            return Err(ControlError::new("CONFLICT", "note changed before the update"));
        }
        mod_sticky_note::ClosedNoteSave::Missing => {
            return Err(ControlError::new("INVALID_REQUEST", "note was not found"));
        }
    };
    guard(host, "sticky_note")?;
    Ok(json!({
        "id": note.id,
        "title": note.title,
        "content_md": note.content_md,
        "updated_at": note.updated_at,
        "is_open": note.is_open,
        "write_session_id": session,
        "display_sync": "closed",
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

fn artifact_path(host: &DesktopHost, artifact_id: &str) -> Result<PathBuf, ControlError> {
    if artifact_id.len() != 32 || !artifact_id.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(ControlError::new("INVALID_REQUEST", "artifact id is invalid"));
    }
    let relative = Path::new("agent-artifacts").join("screenshot").join(format!("{artifact_id}.png"));
    let root = host
        .kernel()
        .context()
        .app_data_dir
        .join("agent-artifacts")
        .join("screenshot");
    let path = host.kernel().context().app_data_dir.join(&relative);
    let root = std::fs::canonicalize(&root).unwrap_or(root);
    let parent = path.parent().unwrap_or(Path::new(""));
    if parent != root && std::fs::canonicalize(parent).ok().as_ref() != Some(&root) {
        return Err(ControlError::new("INVALID_REQUEST", "artifact path is outside the artifact root"));
    }
    Ok(path)
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
        assert!(!snapshot["methods"]
            .as_array()
            .unwrap()
            .iter()
            .any(|method| method == "agent.ink.draw" || method == "agent.ink.snapshot" || method == "agent.artifacts.read"));
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
        assert_eq!(found["notes"][0]["id"], id);
        assert!(found["notes"][0].get("content_md").is_none());
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
        let stale = host
            .sticky_note
            .save_content(host.kernel().context(), id, None, "old-autosave", Some(1), None)
            .unwrap();
        assert!(!stale.applied);
        let current = host.sticky_note.get_note(host.kernel().context(), id).unwrap().unwrap();
        assert_eq!(current.content_md, "human-edit");
        let opened = dispatch(&host, "agent.notes.open", &json!({"id": id}), &AtomicBool::new(false)).unwrap();
        assert_eq!(opened["is_open"], true);
        assert_eq!(opened["window_label"], format!("sticky-note-{id}"));
        let unread = dispatch(&host, "agent.notes.read", &json!({"id": id}), &AtomicBool::new(false)).unwrap_err();
        assert_eq!(unread.code, "UNAVAILABLE");
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
}
