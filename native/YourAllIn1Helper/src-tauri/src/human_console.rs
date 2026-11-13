//! Closed, parent-owned human console transport. Not an Agent gateway.
use crate::{desktop_control::ControlError, plugin_host::TauriDesktopControl, DesktopHost, IpcResponse};
use app_core::TargetOs;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Toggle { module_id: String, enabled: bool }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Grant { module_id: String, allowed: bool }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Shortcut { action_id: String, hotkey: Option<String> }
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct General { language: Option<String>, theme: Option<String> }
#[derive(Debug, Deserialize)]
#[serde(tag = "action", content = "args", rename_all = "camelCase", deny_unknown_fields)]
enum Operation {
    Snapshot(Empty), SetModuleEnabled(Toggle), SetAgentAccess(Grant),
    GetShortcutPreferences(Empty), CheckShortcut(Shortcut), CheckAllShortcuts(Empty),
    UpdateShortcut(Shortcut), UpdateGeneral(General), OpenManual(Empty),
}

fn invalid() -> ControlError { ControlError::new("INVALID_REQUEST", "invalid toolbox console request") }
fn parse(params: &Value) -> Result<Operation, ControlError> {
    let op: Operation = serde_json::from_value(params.clone()).map_err(|_| invalid())?;
    let known = |id: &str| app_core::MODULE_CATALOG.iter().any(|m| m.id == id);
    match &op {
        Operation::SetModuleEnabled(value) if !known(&value.module_id) => return Err(invalid()),
        Operation::SetAgentAccess(value) if !matches!(value.module_id.as_str(), "screenshot" | "clipboard" | "screen_ink" | "app_usage" | "sticky_note") => return Err(invalid()),
        Operation::CheckShortcut(value) | Operation::UpdateShortcut(value) => {
            if !params["args"].as_object().is_some_and(|obj| obj.contains_key("hotkey"))
                || value.action_id.is_empty() || value.action_id.len() > 640 || value.action_id.chars().any(char::is_control)
                || value.hotkey.as_ref().is_some_and(|s| s.len() > 512 || s.chars().any(char::is_control)) { return Err(invalid()); }
        }
        Operation::UpdateGeneral(value) => {
            if value.language.is_none() && value.theme.is_none()
                || value.language.as_ref().is_some_and(|s| !matches!(s.as_str(), "zh-CN" | "en-US" | "ja-JP"))
                || value.theme.as_ref().is_some_and(|s| !matches!(s.as_str(), "light" | "dark" | "system")) { return Err(invalid()); }
        }
        _ => {}
    }
    Ok(op)
}

pub(crate) fn snapshot(host: &DesktopHost) -> Value {
    let general = host.kernel().context().config.read().general.clone();
    json!({"target_os": TargetOs::current(), "module_catalog": host.module_catalog(),
        "config": {"general": {"language": general.language, "theme": general.theme}}})
}
fn result(response: IpcResponse) -> Result<Value, ControlError> {
    if response.ok { Ok(response.data.unwrap_or(Value::Null)) }
    else { Err(ControlError::new("INTERNAL", response.error.unwrap_or_else(|| "console operation failed".into()))) }
}

pub(crate) fn call(control: &TauriDesktopControl, params: &Value, cancel: Arc<AtomicBool>) -> Result<Value, ControlError> {
    let op = parse(params)?;
    if cancel.load(Ordering::Acquire) { return Err(ControlError::cancelled()); }
    // Drain open note editors off the Tauri main thread, exactly as native IPC does.
    if matches!(&op, Operation::SetModuleEnabled(value) if value.module_id == "sticky_note" && !value.enabled) {
        let host = control.on_main(|app| app.state::<Arc<DesktopHost>>().inner().clone())?;
        host.sticky_note.flush_open_windows(host.kernel().context())
            .map_err(|_| ControlError::new("INTERNAL", "note edits could not be saved; module remains enabled"))?;
    }
    control.on_main(move |app| {
        if cancel.load(Ordering::Acquire) { return Err(ControlError::cancelled()); }
        let host = app.state::<Arc<DesktopHost>>().inner().clone();
        let core = |error: app_core::CoreError| ControlError::new("INVALID_REQUEST", error.to_string());
        match op {
            Operation::Snapshot(_) => Ok(snapshot(&host)),
            Operation::SetModuleEnabled(value) => {
                let previous = Some(host.kernel().registry().is_enabled(&value.module_id));
                let response = host.invoke_ipc("kernel_set_module_enabled", json!({"module_id": value.module_id, "enabled": value.enabled}));
                result(crate::tauri_app::finish_module_toggle(app, &host, Some(&value.module_id), previous, response))
            }
            Operation::SetAgentAccess(value) => {
                let response = host.invoke_ipc("kernel_set_agent_access", json!({"module_id": value.module_id, "allowed": value.allowed}));
                if response.ok { crate::tauri_app::emit_update(app); }
                result(response)
            }
            Operation::GetShortcutPreferences(_) => host.shortcut_preferences().map_err(core),
            Operation::CheckShortcut(value) => host.check_shortcut(&value.action_id, value.hotkey.as_deref(), |key| crate::shortcut_conflicts::probe_native(app, key)).map_err(core),
            Operation::CheckAllShortcuts(_) => host.check_all_shortcuts(|key| crate::shortcut_conflicts::probe_native(app, key)).map_err(core),
            Operation::UpdateShortcut(value) => {
                let result = host.update_shortcut_preference(&value.action_id, value.hotkey.as_deref(), || {
                    let failures = crate::tauri_app::register_global_shortcuts(app).map_err(|e| app_core::CoreError::Config(e.to_string()))?;
                    if let Some(failure) = failures.iter().find(|f| f.action_id == value.action_id) {
                        return Err(app_core::CoreError::Config(format!("{}: {}", failure.accelerator, failure.error)));
                    }
                    Ok(())
                }).map_err(core);
                let _ = crate::tauri_app::update_tray_menu(app);
                crate::tauri_app::emit_update(app);
                result
            }
            Operation::UpdateGeneral(value) => {
                host.kernel().update_config(|cfg| {
                    if let Some(language) = value.language { cfg.general.language = language; }
                    if let Some(theme) = value.theme { cfg.general.theme = theme; }
                }).map_err(core)?;
                let _ = crate::tauri_app::update_tray_menu(app);
                crate::tauri_app::emit_update(app);
                Ok(snapshot(&host)["config"].clone())
            }
            Operation::OpenManual(_) => crate::user_manual::open(app).map(|_| json!({"opened": true}))
                .map_err(|_| ControlError::new("INTERNAL", "manual could not be opened")),
        }
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_arbitrary_commands_extra_identity_and_unsupported_grants() {
        for value in [
            json!({"action":"invoke", "args":{"cmd":"vault_list"}}),
            json!({"action":"snapshot", "args":{"actor":"human"}}),
            json!({"action":"snapshot", "args":{}, "actor":"human"}),
            json!({"action":"setAgentAccess", "args":{"moduleId":"password_vault","allowed":true}}),
            json!({"action":"updateGeneral", "args":{"launch_at_login":true}}),
            json!({"action":"updateShortcut", "args":{"actionId":"screenshot:capture"}}),
        ] { assert!(parse(&value).is_err(), "{value}"); }
        assert!(parse(&json!({"action":"snapshot","args":{}})).is_ok());
        assert!(parse(&json!({"action":"setAgentAccess","args":{"moduleId":"sticky_note","allowed":true}})).is_ok());
    }
    #[test]
    fn snapshot_is_a_minimal_projection_and_never_grants_access() {
        let dir = tempfile::tempdir().unwrap();
        let host = DesktopHost::bootstrap(dir.path(), true).unwrap();
        let value = snapshot(&host);
        assert_eq!(value.as_object().unwrap().len(), 3);
        assert_eq!(value["config"].as_object().unwrap().len(), 1);
        assert_eq!(value["config"]["general"].as_object().unwrap().len(), 2);
        assert_eq!(value["module_catalog"].as_array().unwrap().len(), 10);
        assert!(value["module_catalog"].as_array().unwrap().iter().all(|row| row["agent_allowed"] == false));
        for key in ["foreground_external_window", "active_windows", "env_tools", "clipboard"] { assert!(value.get(key).is_none()); }
    }
}
