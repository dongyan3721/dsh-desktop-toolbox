//! 主程序状态、配置及功能开关的 IPC 适配。
use super::*;

impl DesktopHost {
    pub(super) fn dispatch_kernel(&self, cmd: &str, args: Value) -> CoreResult<Value> {
        let ctx = self.kernel.context();
        match cmd {
            "kernel_get_status" => {
                let active_windows = ctx.window_pool.list_active_windows();
                let shortcuts = ctx.shortcut_registry.list_all();
                let modules = self.kernel.registry().list_modules();
                let config = ctx.config.read().clone();
                let fg_window = self.window_pin.current_foreground_window().ok();
                let env_tools = vec![
                    ctx.env_probe.probe(ExternalToolKind::Python3, false),
                    ctx.env_probe.probe(ExternalToolKind::Osascript, false),
                    ctx.env_probe.probe(ExternalToolKind::Zsh, false),
                    ctx.env_probe.probe(ExternalToolKind::Node, false),
                    ctx.env_probe.probe(ExternalToolKind::Ffmpeg, false),
                ];

                Ok(json!({
                    "target_os": TargetOs::current(),
                    "active_window_count": active_windows.len(),
                    "active_windows": active_windows,
                    "modules": modules,
                    "module_catalog": self.module_catalog(),
                    "shortcuts": shortcuts,
                    "config": config,
                    "clipboard_suppressed": ctx.event_bus.is_clipboard_suppressed(),
                    "clipboard_suppression_holders": ctx.event_bus.clipboard_suppression_holders(),
                    "paste_trigger_count": self.os_hal.input_simulator.paste_trigger_count(),
                    "foreground_external_window": fg_window,
                    "env_tools": env_tools,
                }))
            }

            "kernel_set_shortcut_recording" => {
                let recording = args
                    .get("recording")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| CoreError::Config("Missing recording boolean".into()))?;
                // Headless transport has no native callbacks to suppress.
                Ok(json!({"recording":recording,"native":false}))
            }
            "kernel_get_shortcut_preferences" => self.shortcut_preferences(),
            "kernel_check_shortcuts" => {
                self.check_all_shortcuts(|_| crate::shortcut_conflicts::NativeCheck::NotChecked)
            }
            "kernel_check_shortcut" => {
                let action = args
                    .get("action_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| CoreError::Config("Missing action_id".into()))?;
                let hotkey = match args.get("hotkey") {
                    Some(Value::Null) => None,
                    Some(Value::String(value)) => Some(value.as_str()),
                    _ => return Err(CoreError::Config("hotkey must be a string or null".into())),
                };
                self.check_shortcut(action, hotkey, |_| {
                    crate::shortcut_conflicts::NativeCheck::NotChecked
                })
            }
            "kernel_update_shortcut" => {
                let action = args
                    .get("action_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| CoreError::Config("Missing action_id".into()))?;
                let hotkey = match args.get("hotkey") {
                    Some(Value::Null) => None,
                    Some(Value::String(value)) => Some(value.as_str()),
                    _ => return Err(CoreError::Config("hotkey must be a string or null".into())),
                };
                self.update_shortcut_preference(action, hotkey, || Ok(()))
            }
            "kernel_open_feature" => {
                let module_id = args
                    .get("module_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| CoreError::Config("Missing module_id".into()))?;
                self.open_feature_panel(module_id)
            }

            "kernel_trigger_shortcut" => {
                if let Some(action_id) = args.get("action_id").and_then(Value::as_str) {
                    self.trigger_desktop_action(action_id)?;
                } else if let Some(accel) = args.get("accelerator").and_then(Value::as_str) {
                    if let Some((_, action)) = ctx.shortcut_registry.resolve_accelerator(accel) {
                        self.trigger_desktop_action(&action)?;
                    } else {
                        self.kernel.trigger_accelerator(accel)?;
                    }
                } else {
                    return Err(app_core::CoreError::Config(
                        "Missing 'action_id' or 'accelerator'".to_string(),
                    ));
                }
                Ok(json!({
                    "active_window_count": ctx.window_pool.active_window_count(),
                    "active_windows": ctx.window_pool.list_active_windows(),
                }))
            }

            "kernel_open_dashboard" => {
                let route = args
                    .get("route")
                    .and_then(Value::as_str)
                    .unwrap_or("/overview");
                if let Some(module_id) = crate::preferences::feature_for_legacy_route(route) {
                    return self.open_feature_panel(module_id);
                }
                ctx.window_pool.open_window(WindowSpec::dashboard(route))?;
                Ok(json!({
                    "active_window_count": ctx.window_pool.active_window_count(),
                    "active_windows": ctx.window_pool.list_active_windows(),
                }))
            }

            "kernel_destroy_window" => {
                let label = args.get("label").and_then(Value::as_str).unwrap_or("");
                if label == "feature-password_vault" {
                    self.password_vault.notify_page_close();
                }
                let destroyed = ctx.window_pool.destroy_window(label)?;
                Ok(json!({
                    "destroyed": destroyed,
                    "active_window_count": ctx.window_pool.active_window_count(),
                    "active_windows": ctx.window_pool.list_active_windows(),
                }))
            }

            "kernel_blur_window" => {
                let label = args.get("label").and_then(Value::as_str).unwrap_or("");
                let auto_destroyed = ctx.window_pool.on_window_blur(label)?;
                Ok(json!({
                    "auto_destroyed": auto_destroyed,
                    "active_window_count": ctx.window_pool.active_window_count(),
                    "active_windows": ctx.window_pool.list_active_windows(),
                }))
            }

            "kernel_update_clipboard_config" => {
                let max_items = args
                    .get("max_history_items")
                    .and_then(Value::as_u64)
                    .unwrap_or(100) as usize;
                let enabled = args.get("enabled").and_then(Value::as_bool).unwrap_or(true);
                self.kernel.update_config(|cfg| {
                    cfg.clipboard.max_history_items = max_items.clamp(1, 500);
                    cfg.clipboard.enabled = enabled;
                })?;
                Ok(serde_json::to_value(ctx.config.read().clone())?)
            }

            "kernel_update_general_config" => {
                let language = args
                    .get("language")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned);
                let theme = args
                    .get("theme")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned);
                let launch_at_login = args.get("launch_at_login").and_then(Value::as_bool);
                let show_tray_icon = args.get("show_tray_icon").and_then(Value::as_bool);

                self.kernel.update_config(|cfg| {
                    if let Some(lang) = language {
                        cfg.general.language = lang;
                    }
                    if let Some(th) = theme {
                        cfg.general.theme = th;
                    }
                    if let Some(launch) = launch_at_login {
                        cfg.general.launch_at_login = launch;
                    }
                    if let Some(tray) = show_tray_icon {
                        cfg.general.show_tray_icon = tray;
                    }
                })?;
                Ok(serde_json::to_value(ctx.config.read().clone())?)
            }

            "kernel_shutdown" => {
                self.kernel.shutdown()?;
                Ok(json!({
                    "active_window_count": ctx.window_pool.active_window_count(),
                    "pinned_external_windows": self.window_pin.list_pinned_windows(),
                }))
            }

            "kernel_list_modules" => Ok(self.module_catalog()),
            "kernel_set_module_enabled" => {
                let id = args
                    .get("module_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| CoreError::Config("Missing module_id".into()))?;
                let enabled = args
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| CoreError::Config("Missing enabled boolean".into()))?;
                let previous = self.kernel.registry().is_enabled(id);
                self.kernel.set_module_enabled(id, enabled)?;
                if let Err(error) = self.sync_panel_shortcuts() {
                    let _ = self.kernel.set_module_enabled(id, previous);
                    let _ = self.sync_panel_shortcuts();
                    return Err(error);
                }
                if !enabled {
                    ctx.window_pool.destroy_window(&format!("feature-{id}"))?;
                    if id == "password_vault" {
                        self.password_vault.notify_page_close();
                    }
                }
                Ok(self.module_catalog())
            }
            "kernel_set_agent_access" => {
                let obj = args.as_object().ok_or_else(|| {
                    CoreError::Config("agent access params must be an object".into())
                })?;
                if obj.len() != 2 || !obj.contains_key("module_id") || !obj.contains_key("allowed")
                {
                    return Err(CoreError::Config(
                        "agent access accepts only module_id and allowed".into(),
                    ));
                }
                let id = args
                    .get("module_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| CoreError::Config("module_id must be a string".into()))?;
                let allowed = args
                    .get("allowed")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| CoreError::Config("allowed must be a boolean".into()))?;
                self.kernel.set_agent_access(id, allowed)?;
                Ok(self.module_catalog())
            }

            _ => Err(CoreError::Config(format!("Unknown IPC command: {}", cmd))),
        }
    }
}

#[cfg(test)]
mod agent_access_ipc_tests {
    use super::*;

    fn entry<'a>(catalog: &'a Value, id: &str) -> &'a Value {
        catalog
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == id)
            .unwrap()
    }

    #[test]
    fn human_grant_is_separate_from_enablement_and_history_remains_reachable() {
        let dir = tempfile::tempdir().unwrap();
        let host = crate::DesktopHost::bootstrap(dir.path(), true).unwrap();
        let listed = host.invoke_ipc("kernel_list_modules", json!({}));
        assert!(listed.ok);
        let catalog = listed.data.unwrap();
        assert_eq!(entry(&catalog, "clipboard")["agent_supported"], true);
        assert_eq!(entry(&catalog, "clipboard")["agent_allowed"], false);
        assert_eq!(entry(&catalog, "clipboard")["agent_effective"], false);
        assert_eq!(entry(&catalog, "sticky_note")["agent_supported"], true);
        assert_eq!(entry(&catalog, "sticky_note")["agent_allowed"], false);
        assert_eq!(entry(&catalog, "media_proc")["agent_supported"], false);

        let forged = host.invoke_ipc(
            "kernel_set_agent_access",
            json!({"module_id": "media_proc", "allowed": true}),
        );
        assert!(!forged.ok);
        let notes = host.invoke_ipc(
            "kernel_set_agent_access",
            json!({"module_id": "sticky_note", "allowed": true}),
        );
        assert!(notes.ok);
        assert_eq!(entry(&notes.data.unwrap(), "sticky_note")["agent_allowed"], true);
        host.kernel().set_agent_access("sticky_note", false).unwrap();
        let actor = host.invoke_ipc(
            "kernel_set_agent_access",
            json!({"module_id": "clipboard", "allowed": true, "actor": "human"}),
        );
        assert!(!actor.ok);

        let granted = host.invoke_ipc(
            "kernel_set_agent_access",
            json!({"module_id": "clipboard", "allowed": true}),
        );
        assert!(granted.ok);
        let catalog = granted.data.unwrap();
        assert_eq!(entry(&catalog, "clipboard")["enabled"], true);
        assert_eq!(entry(&catalog, "clipboard")["agent_allowed"], true);
        assert_eq!(entry(&catalog, "clipboard")["agent_effective"], true);
        assert_eq!(entry(&catalog, "screenshot")["agent_allowed"], false);
        assert!(host.kernel().context().config.read().usage_tracking.enabled);

        let history = host.invoke_ipc("clipboard_list_items", json!({"limit": 1}));
        assert!(history.ok, "{:?}", history.error);

        host.kernel().set_module_enabled("clipboard", false).unwrap();
        let after_disable = host.invoke_ipc("kernel_list_modules", json!({})).data.unwrap();
        assert_eq!(entry(&after_disable, "clipboard")["enabled"], false);
        assert_eq!(entry(&after_disable, "clipboard")["agent_allowed"], true);
        assert_eq!(entry(&after_disable, "clipboard")["agent_effective"], false);
        assert_eq!(
            app_core::agent_error_code(&host.kernel().authorize_agent("clipboard").unwrap_err()),
            Some("MODULE_DISABLED")
        );
        let _ = host.kernel().shutdown();
    }
}
