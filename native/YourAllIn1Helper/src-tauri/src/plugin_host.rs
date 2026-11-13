//! Tauri-thread adapter for the private control pipe.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use dsh_bridge::transport::{self, watch_parent};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::watch;

use crate::desktop_control::{serve_desktop_control, ControlError, DesktopControl};
use crate::plugin_launch::{
    apply_process_isolation, prepare_plugin_runtime, PluginIsolation, PluginLaunch,
    DESKTOP_CAPABILITIES,
};
use app_core::WindowSpec;
use crate::DesktopHost;

pub struct PluginShutdown {
    flush_accepted: AtomicBool,
}

impl PluginShutdown {
    pub fn mark(&self) {
        self.flush_accepted.store(true, Ordering::Release);
    }

    pub fn accepted(&self) -> bool {
        self.flush_accepted.load(Ordering::Acquire)
    }
}

struct PluginRuntime {
    launch: PluginLaunch,
    isolation: PluginIsolation,
    parent_exit: watch::Receiver<bool>,
    ready_tx: watch::Sender<bool>,
    _lock: transport::InstanceLock,
}

static PLUGIN: std::sync::OnceLock<PluginRuntime> = std::sync::OnceLock::new();

pub fn plugin_active() -> bool {
    PLUGIN.get().is_some()
}

pub fn active_isolation() -> Option<&'static PluginIsolation> {
    PLUGIN.get().map(|runtime| &runtime.isolation)
}

pub fn webview_data_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.try_state::<PluginIsolation>()
        .map(|isolation| isolation.webview_data_dir.clone())
}

pub fn run_plugin(launch: PluginLaunch) -> anyhow::Result<()> {
    let parent_exit = watch_parent(launch.parent_pid).map_err(anyhow::Error::msg)?;
    if *parent_exit.borrow() {
        return Err(anyhow::anyhow!("parent process is not running"));
    }
    let (lock, isolation) = prepare_locked_runtime(&launch).map_err(anyhow::Error::msg)?;
    apply_process_isolation(&isolation);
    let (ready_tx, _ready_rx) = watch::channel(false);
    PLUGIN
        .set(PluginRuntime {
            launch,
            isolation,
            parent_exit,
            ready_tx,
            _lock: lock,
        })
        .map_err(|_| anyhow::anyhow!("plugin runtime was already installed"))?;
    crate::run();
    Ok(())
}

fn prepare_locked_runtime(
    launch: &PluginLaunch,
) -> Result<(transport::InstanceLock, PluginIsolation), String> {
    // A losing second launch must not create or replace configuration before
    // discovering that another desktop/headless kernel already owns the data.
    let lock = transport::InstanceLock::acquire(&launch.data_dir)?;
    let isolation = prepare_plugin_runtime(launch)?;
    Ok((lock, isolation))
}

pub fn install_plugin_state(app: &AppHandle) -> Result<(), String> {
    let Some(runtime) = PLUGIN.get() else {
        return Ok(());
    };
    if *runtime.parent_exit.borrow() {
        return Err("parent process is not running".to_string());
    }
    app.manage(runtime.isolation.clone());
    app.manage(PluginShutdown {
        flush_accepted: AtomicBool::new(false),
    });
    Ok(())
}

pub fn spawn_control_server(app: &AppHandle) -> Result<(), String> {
    let Some(runtime) = PLUGIN.get() else {
        return Ok(());
    };
    runtime.ready_tx.send_replace(true);
    let launch = runtime.launch.clone();
    let parent_exit = runtime.parent_exit.clone();
    let ready = runtime.ready_tx.subscribe();
    let control = Arc::new(TauriDesktopControl {
        app: app.clone(),
    });
    tauri::async_runtime::spawn(async move {
        if let Err(error) = listen(launch, control, parent_exit, ready).await {
            tracing::error!(%error, "Desktop control pipe stopped");
        }
    });
    Ok(())
}

fn finish_parent_exit(control: &TauriDesktopControl) {
    if control.shutdown(&AtomicBool::new(false)).is_ok() {
        control.finish_accepted_shutdown();
    }
}

async fn listen(
    launch: PluginLaunch,
    control: Arc<TauriDesktopControl>,
    mut parent_exit: watch::Receiver<bool>,
    ready: watch::Receiver<bool>,
) -> Result<(), String> {
    loop {
        if *parent_exit.borrow() {
            finish_parent_exit(&control);
            return Ok(());
        }
        let server = transport::create_listening_pipe(&launch.pipe_name)
            .map_err(|_| "named pipe could not be created".to_string())?;
        tokio::select! {
            biased;
            changed = parent_exit.changed() => {
                if changed.is_err() || *parent_exit.borrow() {
                    finish_parent_exit(&control);
                    return Ok(());
                }
            }
            connected = server.connect() => {
                if connected.is_err() {
                    return Err("named pipe connection failed".to_string());
                }
                match transport::client_process_id(&server) {
                    Ok(pid) if crate::plugin_launch::accept_control_client(pid, launch.parent_pid) => {
                        let (reader, writer) = tokio::io::split(server);
                        let stop = serve_desktop_control(
                            reader,
                            writer,
                            Arc::clone(&control),
                            launch.instance_id.clone(),
                            parent_exit.clone(),
                            ready.clone(),
                        )
                        .await;
                        tracing::info!(?stop, "Desktop control session ended");
                        if matches!(
                            stop,
                            crate::desktop_control::ControlStop::Disconnected
                                | crate::desktop_control::ControlStop::ProtocolFault
                        ) {
                            finish_parent_exit(&control);
                        }
                        return Ok(());
                    }
                    _ => {
                        tracing::warn!("Rejected a control client that is not the parent process");
                    }
                }
            }
        }
    }
}

struct TauriDesktopControl {
    app: AppHandle,
}

impl DesktopControl for TauriDesktopControl {
    fn status(&self) -> Value {
        self.on_main(|app| {
            let Some(host) = app.try_state::<Arc<DesktopHost>>() else {
                return json!({
                    "protocolVersion": 1,
                    "nativeVersion": env!("CARGO_PKG_VERSION"),
                    "capabilities": DESKTOP_CAPABILITIES,
                    "modules": [],
                    "desktop": true
                });
            };
            let modules: Vec<_> = app_core::MODULE_CATALOG
                .iter()
                .map(|module| {
                    json!({
                        "id": module.id,
                        "enabled": host.kernel().registry().is_enabled(module.id),
                    })
                })
                .collect();
            json!({
                "protocolVersion": 1,
                "nativeVersion": env!("CARGO_PKG_VERSION"),
                "capabilities": DESKTOP_CAPABILITIES,
                "modules": modules,
                "desktop": true
            })
        })
        .unwrap_or_else(|_| {
            json!({
                "protocolVersion": 1,
                "nativeVersion": env!("CARGO_PKG_VERSION"),
                "capabilities": DESKTOP_CAPABILITIES,
                "modules": [],
                "desktop": true
            })
        })
    }

    fn show_main(&self, cancel: &AtomicBool) -> Result<Value, ControlError> {
        if cancel.load(Ordering::Acquire) {
            return Err(ControlError::cancelled());
        }
        self.on_main(|app| {
            let host = app
                .try_state::<Arc<DesktopHost>>()
                .ok_or_else(|| ControlError::new("INTERNAL", "desktop runtime is not initialized"))?;
            host.kernel()
                .context()
                .window_pool
                .open_window(WindowSpec::dashboard("/overview"))
                .map_err(|_| ControlError::new("INTERNAL", "main window could not be opened"))?;
            Ok(json!({"opened": true}))
        })?
    }

    fn open_panel(&self, module_id: &str, cancel: &AtomicBool) -> Result<Value, ControlError> {
        if cancel.load(Ordering::Acquire) {
            return Err(ControlError::cancelled());
        }
        let module_id = module_id.to_string();
        self.on_main(move |app| {
            let known = app_core::MODULE_CATALOG.iter().any(|module| module.id == module_id);
            if !known {
                return Err(ControlError::new("INVALID_REQUEST", "unknown feature panel"));
            }
            let host = app
                .try_state::<Arc<DesktopHost>>()
                .ok_or_else(|| ControlError::new("INTERNAL", "desktop runtime is not initialized"))?;
            if !host.kernel().registry().is_enabled(&module_id) {
                return Err(ControlError::new("DISABLED", "feature module is disabled"));
            }
            host.open_feature_panel(&module_id)
                .map(|_| json!({"opened": true}))
                .map_err(|_| ControlError::new("INTERNAL", "feature panel could not be opened"))
        })?
    }

    fn shutdown(&self, cancel: &AtomicBool) -> Result<Value, ControlError> {
        if cancel.load(Ordering::Acquire) {
            return Err(ControlError::cancelled());
        }
        let host = self.on_main(|app| {
            app.try_state::<Arc<DesktopHost>>()
                .map(|host| host.inner().clone())
        })?;
        let Some(host) = host else {
            return Err(ControlError::new(
                "INTERNAL",
                "desktop runtime is not initialized",
            ));
        };
        if host
            .sticky_note
            .flush_open_windows(host.kernel().context())
            .is_err()
        {
            return Err(ControlError::new(
                "INTERNAL",
                "desktop shutdown was not accepted",
            ));
        }
        self.on_main(|app| {
            if let Some(shutdown) = app.try_state::<PluginShutdown>() {
                shutdown.mark();
            }
        })?;
        Ok(json!({"stopping": true}))
    }

    fn agent_call(
        &self,
        method: &str,
        params: &Value,
        cancel: Arc<AtomicBool>,
    ) -> Result<Value, ControlError> {
        if cancel.load(Ordering::Acquire) {
            return Err(ControlError::cancelled());
        }
        let method = method.to_string();
        let params = params.clone();
        let on_ui = matches!(
            method.as_str(),
            "agent.ink.start" | "agent.ink.stop" | "agent.ink.passthrough"
        );
        if on_ui {
            return self.on_main(move |app| {
                let Some(host) = app.try_state::<Arc<DesktopHost>>() else {
                    return Err(ControlError::new(
                        "INTERNAL",
                        "desktop runtime is not initialized",
                    ));
                };
                crate::agent_api::dispatch(host.as_ref(), &method, &params, &cancel)
            })?;
        }
        let Some(host) = self.on_main(|app| {
            app.try_state::<Arc<DesktopHost>>()
                .map(|host| host.inner().clone())
        })?
        else {
            return Err(ControlError::new(
                "INTERNAL",
                "desktop runtime is not initialized",
            ));
        };
        crate::agent_api::dispatch(host.as_ref(), &method, &params, &cancel)
    }

    fn finish_accepted_shutdown(&self) {
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || {
            app.exit(0);
        });
    }
}

impl TauriDesktopControl {
    fn on_main<T, F>(&self, op: F) -> Result<T, ControlError>
    where
        T: Send + 'static,
        F: FnOnce(&AppHandle) -> T + Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let app = self.app.clone();
        self.app
            .run_on_main_thread(move || {
                let _ = tx.send(op(&app));
            })
            .map_err(|_| ControlError::new("INTERNAL", "desktop thread did not accept the command"))?;
        rx.recv()
            .map_err(|_| ControlError::new("INTERNAL", "desktop thread did not finish the command"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflicting_launch_cannot_prepare_configuration_before_taking_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let launch = PluginLaunch {
            pipe_name: "unused-in-preparation-test".into(),
            instance_id: "11111111-1111-4111-8111-111111111111".into(),
            data_dir: dir.path().to_path_buf(),
            parent_pid: std::process::id(),
        };
        let first = transport::InstanceLock::acquire(dir.path()).unwrap();
        assert!(prepare_locked_runtime(&launch).is_err());
        assert!(!dir.path().join("config.json").exists());
        assert!(!dir.path().join("webview").exists());
        drop(first);
        let (_lock, isolation) = prepare_locked_runtime(&launch).unwrap();
        assert!(isolation.data_dir.join("config.json").is_file());
        assert!(isolation.webview_data_dir.is_dir());
    }
}
