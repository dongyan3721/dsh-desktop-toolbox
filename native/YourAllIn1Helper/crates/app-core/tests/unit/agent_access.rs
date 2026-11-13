use super::*;
use serde_json::json;
use std::sync::atomic::Ordering;

struct GateModule {
    id: &'static str,
}

impl AppModule for GateModule {
    fn id(&self) -> &'static str {
        self.id
    }
    fn name(&self) -> &'static str {
        "gate"
    }
}

fn kernel_with(dir: &std::path::Path, ids: &[&'static str]) -> AppKernel {
    let mut builder = AppKernelBuilder::new(dir).with_in_memory_db(true);
    for id in ids {
        builder = builder.register_module(GateModule { id }).unwrap();
    }
    builder.bootstrap().unwrap()
}

#[test]
fn old_config_migrates_without_granting_agent_access() {
    let legacy = json!({
        "config_version": 4,
        "future_plugin_flag": "keep_me",
        "shortcut_overrides": {"screenshot:capture": "PrimaryMod+SecondaryMod+F8"},
        "modules": {
            "enabled": {"clipboard": false, "screenshot": true},
            "settings": {"translator": {"hotkey": "PrimaryMod+SecondaryMod+Shift+T"}},
            "custom_field": {"keep": true}
        },
        "clipboard": {"enabled": false, "max_history_items": 80}
    });
    let migrated = ConfigMigrationPipeline::migrate_value(legacy, 4).unwrap();
    let cfg: AppConfig = serde_json::from_value(migrated).unwrap();
    assert_eq!(cfg.config_version, CURRENT_CONFIG_VERSION);
    assert!(!cfg.modules.agent_allowed("clipboard"));
    assert!(!cfg.modules.agent_allowed("screenshot"));
    assert!(!cfg.modules.agent_allowed("sticky_note"));
    assert_eq!(cfg.modules.enabled.get("clipboard"), Some(&false));
    assert_eq!(
        cfg.shortcut_overrides.get("screenshot:capture").map(String::as_str),
        Some("PrimaryMod+SecondaryMod+F8")
    );
    assert_eq!(cfg.clipboard.max_history_items, 80);
    assert!(!cfg.clipboard.enabled);
    assert_eq!(
        cfg.unknown_fields.get("future_plugin_flag"),
        Some(&json!("keep_me"))
    );
    assert_eq!(
        cfg.modules.unknown_fields.get("custom_field"),
        Some(&json!({"keep": true}))
    );
}

#[test]
fn forged_grant_never_authorizes_an_unsupported_module() {
    let dir = tempfile::tempdir().unwrap();
    let forged = json!({
        "config_version": 5,
        "modules": {
            "enabled": {"clipboard": true, "sticky_note": true},
            "agent_access": {"sticky_note": true, "clipboard": true, "not_a_module": true}
        }
    });
    std::fs::write(dir.path().join("config.json"), forged.to_string()).unwrap();
    let kernel = kernel_with(dir.path(), &["clipboard"]);
    assert!(kernel.context().config.read().modules.agent_allowed("clipboard"));
    assert!(kernel.agent_access_view("sticky_note").agent_supported);
    assert!(!kernel.context().config.read().modules.agent_allowed("sticky_note"));
    assert_eq!(
        kernel.context().config.read().modules.agent_support_generation,
        crate::config::STICKY_GRANT_GENERATION
    );
    assert!(!kernel.context().config.read().modules.agent_allowed("not_a_module"));
    let unmounted = kernel.authorize_agent("sticky_note").unwrap_err();
    assert_eq!(agent_error_code(&unmounted), Some("UNAVAILABLE"));
    kernel.set_agent_access("sticky_note", true).unwrap();
    assert!(kernel.context().config.read().modules.agent_allowed("sticky_note"));
    assert!(kernel.set_agent_access("not_a_module", true).is_err());
    assert!(kernel.set_agent_access("media_proc", true).is_err());
    assert!(kernel.context().config.read().modules.agent_allowed("clipboard"));
}

#[test]
fn grants_are_independent_of_enablement_and_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let kernel = kernel_with(dir.path(), &["clipboard", "screenshot"]);
    assert_eq!(kernel.agent_revision(), 1);
    for id in ["clipboard", "screenshot", "screen_ink", "app_usage"] {
        let view = kernel.agent_access_view(id);
        assert!(view.agent_supported);
        assert!(!view.agent_allowed);
        assert!(!view.agent_effective);
    }
    assert!(kernel.agent_access_view("sticky_note").agent_supported);
    assert!(!kernel.agent_access_view("sticky_note").agent_allowed);
    assert!(!kernel.agent_access_view("media_proc").agent_supported);

    let disabled_denied = kernel.authorize_agent("clipboard").unwrap_err();
    assert_eq!(agent_error_code(&disabled_denied), Some("AGENT_ACCESS_DENIED"));

    kernel.set_module_enabled("clipboard", false).unwrap();
    assert_eq!(
        agent_error_code(&kernel.authorize_agent("clipboard").unwrap_err()),
        Some("MODULE_DISABLED")
    );
    kernel.set_agent_access("clipboard", true).unwrap();
    let parked = kernel.agent_access_view("clipboard");
    assert!(parked.agent_allowed);
    assert!(!parked.agent_effective);
    assert!(!kernel.registry().is_enabled("clipboard"));
    assert_eq!(
        agent_error_code(&kernel.authorize_agent("clipboard").unwrap_err()),
        Some("MODULE_DISABLED")
    );

    kernel.set_module_enabled("clipboard", true).unwrap();
    kernel.authorize_agent("clipboard").unwrap();
    assert!(kernel.agent_access_view("clipboard").agent_effective);
    assert_eq!(
        agent_error_code(&kernel.authorize_agent("screenshot").unwrap_err()),
        Some("AGENT_ACCESS_DENIED")
    );

    kernel.set_agent_access("clipboard", false).unwrap();
    assert!(kernel.registry().is_enabled("clipboard"));
    assert_eq!(
        agent_error_code(&kernel.authorize_agent("clipboard").unwrap_err()),
        Some("AGENT_ACCESS_DENIED")
    );
    assert!(kernel.agent_revision() > 1);
}

#[test]
fn failed_grant_save_keeps_the_previous_policy() {
    let dir = tempfile::tempdir().unwrap();
    let kernel = kernel_with(dir.path(), &["clipboard"]);
    let revision = kernel.agent_revision();
    std::fs::remove_file(dir.path().join("config.json")).unwrap();
    std::fs::create_dir(dir.path().join("config.json")).unwrap();
    assert!(kernel.set_agent_access("clipboard", true).is_err());
    assert!(!kernel.agent_access_view("clipboard").agent_allowed);
    assert_eq!(kernel.agent_revision(), revision);
    let _ = Ordering::Relaxed;
}
