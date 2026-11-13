//! Static Agent allowlist. Grants are a separate persisted switch and default to off.

use serde::Serialize;

/// Modules that may receive an Agent grant. Every other catalog id is human-only.
pub const AGENT_SUPPORTED_MODULES: &[&str] = &[
    "screenshot",
    "clipboard",
    "screen_ink",
    "app_usage",
];

pub fn agent_supported(module_id: &str) -> bool {
    AGENT_SUPPORTED_MODULES.contains(&module_id)
}

/// Stable pipe/IPC codes for Agent denial. Other kernel errors stay execution errors.
pub fn agent_error_code(error: &crate::CoreError) -> Option<&'static str> {
    match error {
        crate::CoreError::AgentUnsupported(_) => Some("UNSUPPORTED"),
        crate::CoreError::ModuleDisabled(_) => Some("MODULE_DISABLED"),
        crate::CoreError::AgentAccessDenied(_) => Some("AGENT_ACCESS_DENIED"),
        crate::CoreError::AgentUnavailable(_) => Some("UNAVAILABLE"),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentAccessView {
    pub id: String,
    pub agent_supported: bool,
    pub agent_allowed: bool,
    pub agent_effective: bool,
}

impl AgentAccessView {
    pub fn from_runtime(id: &str, stored_grant: bool, available: bool, enabled: bool) -> Self {
        let agent_supported = agent_supported(id);
        let agent_allowed = agent_supported && stored_grant;
        Self {
            id: id.to_string(),
            agent_supported,
            agent_allowed,
            agent_effective: agent_allowed && available && enabled,
        }
    }
}
