//! `app-core` — Microkernel foundation for the All-in-One Tauri 2.x Desktop App.
//!
//! Coordinates:
//! - **`AppModule` & `ModuleRegistry`**: Unified plugin contract for all 10 feature modules.
//! - **`EventBus`**: Lock-free clipboard suppression + async broadcast event bus, including
//!   Snipaste-style hierarchical region detection (`DetectedRegionRect`, `resolve_smart_region_at_point`).
//! - **`ShortcutNormalizer` & `ShortcutRegistry`**: Cross-platform hotkey mapping (`PrimaryMod`,
//!   `SecondaryMod`, `MetaMod`) for Windows and macOS with conflict detection.
//! - **`EnvProbeService`**: Zero-bundled-runtime environment detector (`ffmpeg`, `ffprobe`, `node`,
//!   `python3`, `cscript`, `powershell`, `osascript`, `zsh`) with macOS GUI `$PATH` hydration.
//! - **`DbPool` & `ConfigMigrationPipeline`**: Local SQLite WAL storage with automatic pre-upgrade
//!   backups, atomic incremental SQL migrations, and forward/backward-compatible JSON config migration.
//! - **`WindowPoolManager`**: 3-level WebView lifecycle manager guaranteeing 0 hidden WebViews on startup.

pub mod agent_access;
pub mod catalog;
pub mod clipboard_guard;
pub mod config;
pub use agent_access::{agent_error_code, agent_supported, AgentAccessView};
pub use catalog::{ModuleDefinition, MODULE_CATALOG};
pub use clipboard_guard::{ClipboardSuppressionLease, SuppressionHolder};
pub use config::ModulesConfig;
pub mod env_probe;
pub mod error;
pub mod event_bus;
pub mod module;
pub mod screenshot_region;
pub mod shortcut;
pub mod storage;
pub mod window_manager;

use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::{path::PathBuf, sync::Arc};
use tracing::{info, warn};

pub use env_probe::{EnvProbeService, ExternalToolKind, ToolProbeResult};
pub use error::{CoreError, CoreResult};
pub use event_bus::{CaptureMode, EventBus, SystemEvent};
pub use module::{AppModule, ModuleContext, ModuleMetadata, ModuleRegistry};
pub use screenshot_region::{
    infer_visual_edge_box_rgba, resolve_smart_region_at_point, DetectedRegionRect,
    RegionHierarchyLevel, ResizeHandle, SelectionBox,
};
pub use shortcut::{
    RegisteredShortcut, ShortcutNormalizer, ShortcutRegistry, ShortcutSpec, TargetOs,
};
pub use storage::{
    AppConfig, AppliedMigrationRecord, ClipboardConfig, ConfigMigrationPipeline,
    CustomOnnxModelConfig, CustomToolPathsConfig, DbPool, GeneralConfig, ModuleMigration,
    OcrPriorityMode, PasswordVaultConfig, ScreenshotConfig, SharedConfig, UsageTrackingConfig,
    CURRENT_CONFIG_VERSION,
};
pub use window_manager::{
    ActiveWindowEntry, CloseFlushOutcome, CloseFlushReport, HeadlessWindowBackend, WindowBackend,
    WindowLifecyclePolicy, WindowPoolManager, WindowSpec,
};

/// Builder for assembling and bootstrapping the `AppKernel` daemon.
pub struct AppKernelBuilder {
    app_data_dir: PathBuf,
    in_memory_db: bool,
    target_os: TargetOs,
    window_backend: Arc<dyn WindowBackend>,
    registry: ModuleRegistry,
}

impl AppKernelBuilder {
    /// Creates a new kernel builder rooted at `app_data_dir`.
    pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
        Self {
            app_data_dir: app_data_dir.into(),
            in_memory_db: false,
            target_os: TargetOs::current(),
            window_backend: Arc::new(HeadlessWindowBackend),
            registry: ModuleRegistry::new(),
        }
    }

    /// Uses an in-memory SQLite database instead of `<app_data_dir>/app.db` (useful for tests).
    pub fn with_in_memory_db(mut self, in_memory: bool) -> Self {
        self.in_memory_db = in_memory;
        self
    }

    /// Overrides the target OS used for shortcut normalization.
    pub fn with_target_os(mut self, target_os: TargetOs) -> Self {
        self.target_os = target_os;
        self
    }

    /// Attaches a custom `WindowBackend` (such as the Tauri 2.x `AppHandle` adapter).
    pub fn with_window_backend(mut self, backend: Arc<dyn WindowBackend>) -> Self {
        self.window_backend = backend;
        self
    }

    /// Registers a feature module (`AppModule`) into the kernel.
    pub fn register_module<M: AppModule>(mut self, module: M) -> CoreResult<Self> {
        self.registry.register(module)?;
        Ok(self)
    }

    pub fn register_module_arc(mut self, module: Arc<dyn AppModule>) -> CoreResult<Self> {
        self.registry.register_arc(module)?;
        Ok(self)
    }

    /// Bootstraps the microkernel in deterministic order:
    /// 1. Hydrates GUI `$PATH` on macOS.
    /// 2. Loads & migrates `config.json` via `ConfigMigrationPipeline`.
    /// 3. Opens `app.db` (WAL mode), backs up existing DB if migrations are pending, and applies
    ///    all core + module incremental SQL migrations.
    /// 4. Configures `EnvProbeService` with user custom tool paths.
    /// 5. Registers all module shortcuts (applying user overrides from `AppConfig`).
    /// 6. Invokes `on_init(&ctx)` across all registered modules (while creating 0 WebView windows).
    pub fn bootstrap(self) -> CoreResult<AppKernel> {
        // 1. Repair GUI PATH on macOS
        EnvProbeService::hydrate_gui_path_env();

        // 2. Load and migrate config.json
        std::fs::create_dir_all(&self.app_data_dir)?;
        let config_path = self.app_data_dir.join("config.json");
        let app_config = ConfigMigrationPipeline::load_or_init(&config_path)?;
        let shared_config: SharedConfig = Arc::new(RwLock::new(app_config.clone()));

        // 3. Open SQLite database and run core + module migrations
        let db = if self.in_memory_db {
            DbPool::open_in_memory()?
        } else {
            DbPool::open(self.app_data_dir.join("app.db"))?
        };

        let mut all_migrations = vec![ModuleMigration::new(
            "core",
            1,
            "Initialize core audit log and settings metadata table",
            "CREATE TABLE IF NOT EXISTS core_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_id TEXT NOT NULL,
                event_name TEXT NOT NULL,
                detail TEXT,
                created_at INTEGER NOT NULL
            );",
        )];
        all_migrations.extend(self.registry.collect_all_migrations());
        let applied_migrations = db.run_migrations(&all_migrations)?;

        // 4. Configure EnvProbeService with custom tool overrides from config
        let env_probe = Arc::new(EnvProbeService::new());
        Self::sync_env_probe_overrides(&env_probe, &app_config.custom_tool_paths);

        // 5. Initialize ShortcutRegistry and register module default shortcuts + user overrides
        let shortcut_registry = Arc::new(ShortcutRegistry::new(self.target_os));
        self.registry.configure_enabled(&app_config.modules);
        for spec in self.registry.collect_all_default_shortcuts() {
            let user_override = app_config
                .shortcut_overrides
                .get(&spec.action_id)
                .map(String::as_str);
            if spec.is_unassigned(user_override) {
                continue;
            }
            if let Err(err) = shortcut_registry.register(spec, user_override) {
                warn!("Shortcut registration conflict or error (skipped): {}", err);
            }
        }

        // 6. Initialize WindowPoolManager (Level 0: 0 active WebView windows on startup)
        let window_pool = Arc::new(WindowPoolManager::new(self.window_backend));
        let event_bus = EventBus::default();

        let context = ModuleContext {
            app_data_dir: self.app_data_dir.clone(),
            db,
            event_bus,
            config: shared_config,
            env_probe,
            window_pool,
            shortcut_registry,
        };

        // 7. Execute `on_init` across all registered modules
        self.registry.init_all(&context)?;

        info!(
            modules = self.registry.len(),
            applied_migrations,
            active_webviews = context.window_pool.active_window_count(),
            "AppKernel bootstrap completed (Level 0 daemon ready)"
        );

        Ok(AppKernel {
            context,
            registry: Arc::new(self.registry),
            config_path,
            agent_revision: AtomicU64::new(1),
            agent_grant_epoch: Mutex::new(HashMap::new()),
        })
    }

    fn sync_env_probe_overrides(env_probe: &EnvProbeService, paths: &CustomToolPathsConfig) {
        env_probe.set_custom_override(ExternalToolKind::Ffmpeg, paths.ffmpeg_path.clone());
        env_probe.set_custom_override(ExternalToolKind::Ffprobe, paths.ffprobe_path.clone());
        env_probe.set_custom_override(ExternalToolKind::Node, paths.node_path.clone());
        env_probe.set_custom_override(ExternalToolKind::Python3, paths.python3_path.clone());
    }
}

/// Running microkernel instance holding the `ModuleContext` and `ModuleRegistry`.
pub struct AppKernel {
    context: ModuleContext,
    registry: Arc<ModuleRegistry>,
    config_path: PathBuf,
    agent_revision: AtomicU64,
    /// Epoch of the current grant. Revoking increments it so older artifacts stay dead after regrant.
    agent_grant_epoch: Mutex<HashMap<String, u64>>,
}

impl AppKernel {
    /// Returns a reference to the shared `ModuleContext`.
    pub fn context(&self) -> &ModuleContext {
        &self.context
    }

    /// Returns a reference to the `ModuleRegistry`.
    pub fn registry(&self) -> &ModuleRegistry {
        &self.registry
    }

    /// Triggers a shortcut by its `action_id` (e.g., `"screenshot:capture"`, `"clipboard:toggle_popup"`).
    pub fn trigger_action(&self, action_id: &str) -> CoreResult<()> {
        // UI/tray actions also work when their optional global shortcut is unset.
        let spec = self
            .context
            .shortcut_registry
            .get_by_action(action_id)
            .map(|r| r.spec)
            .or_else(|| {
                self.registry
                    .collect_shortcut_preferences()
                    .into_iter()
                    .find(|s| s.action_id == action_id)
            })
            .ok_or_else(|| CoreError::ShortcutActionNotFound(action_id.to_string()))?;
        self.registry
            .dispatch_shortcut_action(&spec.module_id, &spec.action_id, &self.context)
    }

    /// Triggers a shortcut by its physical or logical key combination (e.g., `"F1"`, `"Ctrl+Shift+V"`).
    pub fn trigger_accelerator(&self, accelerator: &str) -> CoreResult<()> {
        let (module_id, action_id) = self
            .context
            .shortcut_registry
            .resolve_accelerator(accelerator)
            .ok_or_else(|| CoreError::ShortcutActionNotFound(accelerator.to_string()))?;
        self.registry
            .dispatch_shortcut_action(&module_id, &action_id, &self.context)
    }

    /// Updates and atomically persists `AppConfig`, synchronizing custom tool paths and broadcasting `ConfigReloaded`.
    pub fn update_config<F>(&self, mutator: F) -> CoreResult<()>
    where
        F: FnOnce(&mut AppConfig),
    {
        // 串行保存配置，只有落盘成功后才发布内存状态，避免保存失败后前后不一致。
        let mut guard = self.context.config.write();
        let mut updated = guard.clone();
        mutator(&mut updated);
        ConfigMigrationPipeline::save_atomic(&self.config_path, &updated)?;
        *guard = updated.clone();
        drop(guard);
        AppKernelBuilder::sync_env_probe_overrides(
            &self.context.env_probe,
            &updated.custom_tool_paths,
        );
        self.context.event_bus.publish(SystemEvent::ConfigReloaded);
        Ok(())
    }

    /// Enables/disables a mounted feature with lifecycle cleanup and durable configuration.
    pub fn set_module_enabled(&self, module_id: &str, enabled: bool) -> CoreResult<()> {
        let before = self.registry.is_enabled(module_id);
        self.registry
            .set_enabled(module_id, enabled, &self.context, || {
                self.update_config(|config| {
                    config
                        .modules
                        .enabled
                        .insert(module_id.to_string(), enabled);
                })
            })?;
        if agent_supported(module_id) && before != enabled {
            self.bump_agent_revision();
        }
        Ok(())
    }

    /// Persists a human Agent grant. Unsupported and unknown modules are rejected.
    /// Disabling a module does not clear the grant, and this call does not enable the module.
    pub fn set_agent_access(&self, module_id: &str, allowed: bool) -> CoreResult<()> {
        if !agent_supported(module_id) {
            return Err(CoreError::AgentUnsupported(module_id.to_string()));
        }
        let modules = self.context.config.read().modules.clone();
        let current = modules.agent_access.get(module_id).copied().unwrap_or(false);
        let sticky_needs_generation = module_id == "sticky_note"
            && allowed
            && modules.agent_support_generation < crate::config::STICKY_GRANT_GENERATION;
        if current == allowed && !sticky_needs_generation {
            return Ok(());
        }
        self.update_config(|config| {
            config
                .modules
                .agent_access
                .insert(module_id.to_string(), allowed);
            if module_id == "sticky_note" && allowed {
                config.modules.agent_support_generation = config
                    .modules
                    .agent_support_generation
                    .max(crate::config::STICKY_GRANT_GENERATION);
            }
        })?;
        if current && !allowed {
            self.bump_grant_epoch(module_id);
        }
        self.bump_agent_revision();
        Ok(())
    }

    /// Grant epoch captured with an artifact. Revocation moves it forward permanently.
    pub fn agent_grant_epoch(&self, module_id: &str) -> u64 {
        self.agent_grant_epoch
            .lock()
            .get(module_id)
            .copied()
            .unwrap_or(1)
    }

    /// Re-reads support, availability, enablement and the grant. Call this before every Agent effect.
    pub fn authorize_agent(&self, module_id: &str) -> CoreResult<()> {
        let view = self.agent_access_view(module_id);
        if !view.agent_supported {
            return Err(CoreError::AgentUnsupported(module_id.to_string()));
        }
        if !self.registry.contains(module_id) {
            return Err(CoreError::AgentUnavailable(module_id.to_string()));
        }
        if !self.registry.is_enabled(module_id) {
            return Err(CoreError::ModuleDisabled(module_id.to_string()));
        }
        if !view.agent_allowed {
            return Err(CoreError::AgentAccessDenied(module_id.to_string()));
        }
        Ok(())
    }

    pub fn agent_access_view(&self, module_id: &str) -> AgentAccessView {
        let stored = self
            .context
            .config
            .read()
            .modules
            .agent_access
            .get(module_id)
            .copied()
            .unwrap_or(false);
        AgentAccessView::from_runtime(
            module_id,
            stored,
            self.registry.contains(module_id),
            self.registry.is_enabled(module_id),
        )
    }

    pub fn agent_revision(&self) -> u64 {
        self.agent_revision.load(Ordering::Acquire)
    }

    fn bump_agent_revision(&self) {
        self.agent_revision.fetch_add(1, Ordering::AcqRel);
    }

    fn bump_grant_epoch(&self, module_id: &str) {
        let mut epochs = self.agent_grant_epoch.lock();
        let next = epochs.get(module_id).copied().unwrap_or(1).saturating_add(1);
        epochs.insert(module_id.to_string(), next);
    }

    /// Gracefully shuts down all modules in reverse registration order and destroys all open WebViews.
    pub fn shutdown(&self) -> CoreResult<()> {
        let res = self.registry.shutdown_all(&self.context);
        // A failed shutdown may still own unsaved page state. Do not blind-destroy
        // the remaining windows, otherwise a module that kept its window alive to
        // preserve unsaved input would lose it during the fallback cleanup.
        if res.is_ok() {
            let _ = self.context.window_pool.destroy_all();
        }
        res
    }
}

#[cfg(test)]
#[path = "../tests/unit/lib.rs"]
mod tests;

#[cfg(test)]
#[path = "../tests/unit/agent_access.rs"]
mod agent_access_tests;
