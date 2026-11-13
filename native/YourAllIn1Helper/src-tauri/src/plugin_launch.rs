//! Formal GUI plugin startup. One desktop kernel owns the instance; the headless bridge is not started.

use std::path::{Path, PathBuf};

use app_core::{AppConfig, MODULE_CATALOG};
use dsh_bridge::transport::expected_pipe_name;

pub const AGENT_DATA_METHODS: &[&str] = &[
    "agent.screenshot.monitors",
    "agent.screenshot.capture",
    "agent.clipboard.list",
    "agent.clipboard.read_text",
    "agent.clipboard.write_text",
    "agent.ink.status",
    "agent.ink.start",
    "agent.ink.stop",
    "agent.ink.passthrough",
    "agent.ink.clear",
    "agent.ink.draw",
    "agent.ink.snapshot",
    "agent.usage.status",
    "agent.usage.overview",
    "agent.usage.apps",
    "agent.usage.hourly",
    "agent.notes.search",
    "agent.notes.read",
    "agent.notes.create",
    "agent.notes.update",
    "agent.notes.open",
];

pub const DESKTOP_CAPABILITIES: &[&str] = &[
    "desktop.console",
    "status",
    "desktop.show_main",
    "desktop.open_panel",
    "desktop.shutdown",
    "agent.get_access",
    "agent.screenshot.monitors",
    "agent.screenshot.capture",
    "agent.clipboard.list",
    "agent.clipboard.read_text",
    "agent.clipboard.write_text",
    "agent.ink.status",
    "agent.ink.start",
    "agent.ink.stop",
    "agent.ink.passthrough",
    "agent.ink.clear",
    "agent.ink.draw",
    "agent.ink.snapshot",
    "agent.usage.status",
    "agent.usage.overview",
    "agent.usage.apps",
    "agent.usage.hourly",
    "agent.notes.search",
    "agent.notes.read",
    "agent.notes.create",
    "agent.notes.update",
    "agent.notes.open",
    "agent.artifacts.read",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupMode {
    Smoke,
    Standalone,
    Plugin(PluginLaunch),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginLaunch {
    pub pipe_name: String,
    pub instance_id: String,
    pub data_dir: PathBuf,
    pub parent_pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginIsolation {
    pub data_dir: PathBuf,
    pub webview_data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub updater_enabled: bool,
    pub demo_seed: bool,
    pub autostart: bool,
    pub open_dashboard_on_start: bool,
    pub kernel_owner: &'static str,
}

pub fn parse_startup_mode<I, S>(args: I) -> Result<StartupMode, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|arg| arg.as_ref().to_string()).collect();
    let plugin = args.iter().any(|arg| arg == "--toolbox-plugin");
    let smoke = args.iter().any(|arg| arg == "--smoke-test");
    if plugin && smoke {
        return Err("toolbox plugin mode cannot be combined with --smoke-test".to_string());
    }
    if smoke {
        if args.iter().any(|arg| arg.starts_with("--") && arg != "--smoke-test") {
            return Err("smoke test does not accept plugin arguments".to_string());
        }
        return Ok(StartupMode::Smoke);
    }
    if !plugin {
        if args.iter().any(|arg| {
            matches!(
                arg.as_str(),
                "--pipe-name" | "--instance-id" | "--data-dir" | "--parent-pid"
            )
        }) {
            return Err("desktop control arguments require --toolbox-plugin".to_string());
        }
        return Ok(StartupMode::Standalone);
    }
    Ok(StartupMode::Plugin(parse_plugin_launch(&args)?))
}

fn parse_plugin_launch(args: &[String]) -> Result<PluginLaunch, String> {
    let mut pipe_name = None;
    let mut instance_id = None;
    let mut data_dir = None;
    let mut parent_pid = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--toolbox-plugin" || arg == "--silent" {
            continue;
        }
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
            "--ui-smoke-test" | "--keep-open" => {
                return Err("plugin mode does not run GUI smoke".to_string());
            }
            other => return Err(format!("unknown argument {other}")),
        }
    }
    let instance_id = instance_id.ok_or("missing --instance-id")?;
    uuid::Uuid::parse_str(&instance_id).map_err(|_| "instance id must be a UUID".to_string())?;
    let pipe_name = pipe_name.ok_or("missing --pipe-name")?;
    if pipe_name != expected_pipe_name(&instance_id) {
        return Err("pipe name must be \\\\.\\pipe\\dsh-toolbox-<instance-id>".to_string());
    }
    let data_dir = prepare_data_dir(&data_dir.ok_or("missing --data-dir")?)?;
    let parent_pid = parent_pid.ok_or("missing --parent-pid")?;
    Ok(PluginLaunch {
        pipe_name,
        instance_id,
        data_dir,
        parent_pid,
    })
}

pub fn isolation_for(launch: &PluginLaunch) -> PluginIsolation {
    PluginIsolation {
        data_dir: launch.data_dir.clone(),
        webview_data_dir: launch.data_dir.join("webview"),
        log_dir: launch.data_dir.join("logs"),
        temp_dir: launch.data_dir.join("temp"),
        updater_enabled: false,
        demo_seed: false,
        autostart: false,
        open_dashboard_on_start: false,
        kernel_owner: "DesktopHost",
    }
}

pub fn prepare_plugin_runtime(launch: &PluginLaunch) -> Result<PluginIsolation, String> {
    let isolation = isolation_for(launch);
    for dir in [
        &isolation.data_dir,
        &isolation.webview_data_dir,
        &isolation.log_dir,
        &isolation.temp_dir,
    ] {
        std::fs::create_dir_all(dir).map_err(|_| "plugin directory could not be created".to_string())?;
    }
    write_fresh_plugin_config(&isolation.data_dir)?;
    let log = isolation.log_dir.join("desktop.log");
    if !log.exists() {
        std::fs::write(&log, "toolbox plugin runtime prepared\n")
            .map_err(|_| "plugin log could not be created".to_string())?;
    }
    Ok(isolation)
}

pub fn apply_process_isolation(isolation: &PluginIsolation) {
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &isolation.webview_data_dir);
    std::env::set_var("TEMP", &isolation.temp_dir);
    std::env::set_var("TMP", &isolation.temp_dir);
    std::env::set_var("TMPDIR", &isolation.temp_dir);
}

/// A new plugin data directory enables notes and leaves capture modules off.
/// An existing `config.json` is left untouched so a later import keeps user settings.
pub fn write_fresh_plugin_config(data_dir: &Path) -> Result<(), String> {
    let path = data_dir.join("config.json");
    if path.exists() {
        return Ok(());
    }
    let mut config = AppConfig::default();
    config.general.launch_at_login = false;
    for module in MODULE_CATALOG {
        config
            .modules
            .enabled
            .insert(module.id.to_string(), module.id == "sticky_note");
    }
    let bytes = serde_json::to_vec_pretty(&config)
        .map_err(|_| "plugin config could not be encoded".to_string())?;
    std::fs::write(path, bytes).map_err(|_| "plugin config could not be written".to_string())
}

fn prepare_data_dir(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("data directory must be an absolute path".to_string());
    }
    std::fs::create_dir_all(path).map_err(|_| "data directory could not be created".to_string())?;
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| "data directory could not be resolved".to_string())?;
    if !canonical.is_dir() {
        return Err("data directory must be an existing directory".to_string());
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

fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let stripped = text
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .or_else(|| text.strip_prefix(r"\\?\").map(|rest| rest.to_string()));
    stripped.map(PathBuf::from).unwrap_or_else(|| path.to_path_buf())
}

pub fn accept_control_client(client_pid: u32, parent_pid: u32) -> bool {
    client_pid == parent_pid && client_pid != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DesktopHost;

    const INSTANCE: &str = "11111111-1111-4111-8111-111111111111";

    fn plugin_args(dir: &Path) -> Vec<String> {
        vec![
            "--toolbox-plugin".into(),
            "--pipe-name".into(),
            expected_pipe_name(INSTANCE),
            "--instance-id".into(),
            INSTANCE.into(),
            "--data-dir".into(),
            dir.display().to_string(),
            "--parent-pid".into(),
            "4".into(),
        ]
    }

    #[test]
    fn standalone_and_smoke_stay_distinct_from_plugin_mode() {
        assert_eq!(
            parse_startup_mode(["--smoke-test"]).unwrap(),
            StartupMode::Smoke
        );
        assert!(matches!(
            parse_startup_mode(Vec::<String>::new()).unwrap(),
            StartupMode::Standalone
        ));
        assert!(parse_startup_mode(["--smoke-test", "--toolbox-plugin"]).is_err());
        assert!(parse_startup_mode(["--data-dir", r"D:\data"]).is_err());
        assert!(parse_startup_mode(["--toolbox-plugin", "--ui-smoke-test"]).is_err());
    }

    #[test]
    fn plugin_launch_rejects_bad_identity_and_profile_paths() {
        let dir = tempfile::tempdir().unwrap();
        let mut args = plugin_args(dir.path());
        assert!(matches!(
            parse_startup_mode(args.clone()).unwrap(),
            StartupMode::Plugin(_)
        ));
        args[2] = r"\\.\pipe\dsh-toolbox-other".into();
        assert!(parse_startup_mode(args).is_err());
        let mut relative = plugin_args(Path::new("relative-data"));
        relative[6] = "relative-data".into();
        assert!(parse_startup_mode(relative).is_err());
        if let Ok(profile) = std::env::var("LOCALAPPDATA") {
            assert!(parse_startup_mode(plugin_args(Path::new(&profile))).is_err());
        }
    }

    #[test]
    fn fresh_plugin_config_isolates_resources_and_leaves_an_existing_config() {
        let dir = tempfile::tempdir().unwrap();
        let launch = match parse_startup_mode(plugin_args(dir.path())).unwrap() {
            StartupMode::Plugin(launch) => launch,
            other => panic!("expected plugin mode, got {other:?}"),
        };
        let isolation = prepare_plugin_runtime(&launch).unwrap();
        assert!(!isolation.updater_enabled);
        assert!(!isolation.demo_seed);
        assert!(!isolation.autostart);
        assert!(!isolation.open_dashboard_on_start);
        assert_eq!(isolation.kernel_owner, "DesktopHost");
        assert!(isolation.webview_data_dir.is_dir());
        assert!(isolation.log_dir.join("desktop.log").is_file());
        assert!(isolation.temp_dir.is_dir());

        let host = DesktopHost::bootstrap(&isolation.data_dir, false).unwrap();
        assert!(host.kernel().registry().is_enabled("sticky_note"));
        assert!(!host.kernel().registry().is_enabled("clipboard"));
        assert!(!host.kernel().registry().is_enabled("app_usage"));
        assert!(!host.kernel().registry().is_enabled("screenshot"));
        assert!(host
            .kernel()
            .context()
            .shortcut_registry
            .get_by_action("screenshot:capture")
            .is_none());
        assert!(host
            .kernel()
            .context()
            .shortcut_registry
            .get_by_action("sticky_note:create")
            .is_none());
        assert!(!host.kernel().context().config.read().general.launch_at_login);

        let mut preserved = AppConfig::default();
        preserved
            .shortcut_overrides
            .insert("screenshot:capture".into(), "PrimaryMod+SecondaryMod+F8".into());
        preserved.general.launch_at_login = false;
        preserved.modules.enabled.insert("screenshot".into(), false);
        let existing = tempfile::tempdir().unwrap();
        std::fs::write(
            existing.path().join("config.json"),
            serde_json::to_vec_pretty(&preserved).unwrap(),
        )
        .unwrap();
        let existing_launch = match parse_startup_mode(plugin_args(existing.path())).unwrap() {
            StartupMode::Plugin(launch) => launch,
            other => panic!("expected plugin mode, got {other:?}"),
        };
        prepare_plugin_runtime(&existing_launch).unwrap();
        let reopened = DesktopHost::bootstrap(existing.path(), false).unwrap();
        let stored = reopened
            .kernel()
            .context()
            .config
            .read()
            .shortcut_overrides
            .get("screenshot:capture")
            .cloned();
        assert_eq!(stored.as_deref(), Some("PrimaryMod+SecondaryMod+F8"));
        assert!(!reopened.kernel().registry().is_enabled("screenshot"));
        assert!(reopened
            .kernel()
            .context()
            .shortcut_registry
            .get_by_action("screenshot:capture")
            .is_none());
        reopened
            .kernel()
            .set_module_enabled("screenshot", true)
            .unwrap();
        reopened.sync_panel_shortcuts().unwrap();
        let restored = reopened
            .kernel()
            .context()
            .shortcut_registry
            .get_by_action("screenshot:capture");
        assert_eq!(
            restored.as_ref().map(|binding| binding.active_logical_hotkey.as_str()),
            Some("PrimaryMod+SecondaryMod+F8")
        );
        reopened
            .kernel()
            .set_module_enabled("screenshot", false)
            .unwrap();
        assert!(reopened
            .kernel()
            .context()
            .shortcut_registry
            .get_by_action("screenshot:capture")
            .is_none());
    }

    #[test]
    fn control_client_must_be_the_parent_process() {
        assert!(accept_control_client(4, 4));
        assert!(!accept_control_client(5, 4));
        assert!(!accept_control_client(0, 0));
    }
}
