//! Classify shortcut failures without guessing which program holds a hotkey.
//!
//! Windows `RegisterHotKey` returns success or failure. `GetLastError` may be
//! `ERROR_HOTKEY_ALREADY_REGISTERED` (1409). Neither call returns a process id
//! or an executable name. `WM_GETHOTKEY` only reads a window hotkey set with
//! `WM_SETHOTKEY`; it does not identify `RegisterHotKey` owners. This module
//! therefore leaves `owner` null. The vendored `global-hotkey` 0.8.0 Windows
//! backend maps raw os error 1409, and only that code, to
//! `HotKey already registered`. An explicit `(os error N)` wins over that phrase.

use serde_json::{json, Value};

pub(crate) struct ClassifiedFailure {
    pub category: &'static str,
    pub os_error_code: Option<u32>,
    pub guidance: &'static [&'static str],
    pub suggestions: &'static [&'static str],
}

const OWNER_UNKNOWN: &[&str] = &["owner_unknown", "recheck", "change_combo"];
const OCCUPIED_SUGGESTIONS: &[&str] = &["app_settings", "common_tools"];
const OCCUPIED_WIN_SUGGESTIONS: &[&str] = &["app_settings", "common_tools", "windows_key"];
const DENIED: &[&str] = &["system_denied", "owner_unknown", "change_combo", "recheck"];
const DENIED_WIN: &[&str] = &["windows_key"];
const INVALID: &[&str] = &["invalid", "change_combo"];
const UNKNOWN: &[&str] = &["unknown_failure", "owner_unknown", "recheck", "change_combo"];
const UNKNOWN_WIN: &[&str] = &["windows_key"];
const PROBE: &[&str] = &["probe_failed", "recheck"];
const PROBE_CLEANUP: &[&str] = &["probe_failed", "cleanup_failed", "recheck"];
const RESERVED_F12: &[&str] = &["reserved_f12", "owner_unknown", "change_combo"];
const NOT_CHECKED: &[&str] = &["not_checked"];
const NOT_CHECKED_F12: &[&str] = &["not_checked", "reserved_f12"];
const INTERNAL: &[&str] = &["internal", "change_combo"];
const NONE: &[&str] = &[];

pub(crate) fn diagnose_check(
    status: &str,
    detail: Option<&str>,
    accelerator: &str,
    conflicts: &[Value],
) -> Value {
    match status {
        "unassigned" => diagnosis("unassigned", None, NONE, NONE, Vec::new()),
        "available" => diagnosis("available", None, NONE, NONE, Vec::new()),
        "invalid" => diagnosis("invalid_combo", None, INVALID, NONE, Vec::new()),
        "internal_conflict" => {
            diagnosis("internal_conflict", None, INTERNAL, NONE, subjects_from(conflicts))
        }
        "not_checked" => {
            let guidance = if is_bare_f12(accelerator) {
                NOT_CHECKED_F12
            } else {
                NOT_CHECKED
            };
            diagnosis("not_checked", None, guidance, NONE, Vec::new())
        }
        "probe_error" => {
            let class = classify_os_failure(detail.unwrap_or(""), accelerator, true);
            diagnosis(
                class.category,
                class.os_error_code,
                class.guidance,
                class.suggestions,
                Vec::new(),
            )
        }
        "os_unavailable" => {
            let class = classify_os_failure(detail.unwrap_or(""), accelerator, false);
            diagnosis(
                class.category,
                class.os_error_code,
                class.guidance,
                class.suggestions,
                Vec::new(),
            )
        }
        _ => diagnosis("unknown_system_failure", None, UNKNOWN, NONE, Vec::new()),
    }
}

/// Parse a stored registration failure (`accelerator：error`) into a diagnosis.
/// The fullwidth colon is the separator written with the failure. ASCII colons
/// stay inside the raw error text.
pub(crate) fn diagnose_stored_native_error(stored: &str) -> Value {
    let (accelerator, detail) = stored
        .split_once('：')
        .map(|(accelerator, detail)| (accelerator.trim(), detail.trim()))
        .unwrap_or(("", stored.trim()));
    let probe_failed = detail.contains("Temporary shortcut cleanup failed");
    let class = classify_os_failure(detail, accelerator, probe_failed);
    diagnosis(
        class.category,
        class.os_error_code,
        class.guidance,
        class.suggestions,
        Vec::new(),
    )
}

pub(crate) fn classify_os_failure(
    detail: &str,
    accelerator: &str,
    probe_failed: bool,
) -> ClassifiedFailure {
    if probe_failed {
        let guidance = if detail.to_ascii_lowercase().contains("cleanup failed") {
            PROBE_CLEANUP
        } else {
            PROBE
        };
        return ClassifiedFailure {
            category: "probe_failed",
            os_error_code: explicit_os_error(detail),
            guidance,
            suggestions: NONE,
        };
    }

    let mut code = explicit_os_error(detail);
    if code.is_none() && indicates_already_registered(detail) {
        code = Some(1409);
    }
    if is_bare_f12(accelerator) {
        return ClassifiedFailure {
            category: "system_reserved",
            os_error_code: code,
            guidance: RESERVED_F12,
            suggestions: NONE,
        };
    }

    let win = uses_windows_key(accelerator);
    match code {
        Some(1409) => ClassifiedFailure {
            category: "registration_occupied",
            os_error_code: Some(1409),
            guidance: OWNER_UNKNOWN,
            suggestions: if win {
                OCCUPIED_WIN_SUGGESTIONS
            } else {
                OCCUPIED_SUGGESTIONS
            },
        },
        Some(5) => ClassifiedFailure {
            category: "system_denied",
            os_error_code: Some(5),
            guidance: DENIED,
            suggestions: if win { DENIED_WIN } else { NONE },
        },
        Some(87) => ClassifiedFailure {
            category: "invalid_combo",
            os_error_code: Some(87),
            guidance: INVALID,
            suggestions: NONE,
        },
        Some(code) => ClassifiedFailure {
            category: "unknown_system_failure",
            os_error_code: Some(code),
            guidance: UNKNOWN,
            suggestions: if win { UNKNOWN_WIN } else { NONE },
        },
        None => ClassifiedFailure {
            category: "unknown_system_failure",
            os_error_code: None,
            guidance: UNKNOWN,
            suggestions: if win { UNKNOWN_WIN } else { NONE },
        },
    }
}

fn diagnosis(
    category: &str,
    os_error_code: Option<u32>,
    guidance: &[&str],
    suggestions: &[&str],
    subjects: Vec<Value>,
) -> Value {
    json!({
        "category": category,
        "os_error_code": os_error_code,
        "owner": Value::Null,
        "guidance": guidance,
        "suggestions": suggestions,
        "subjects": subjects,
    })
}

fn subjects_from(conflicts: &[Value]) -> Vec<Value> {
    conflicts
        .iter()
        .filter_map(|row| {
            let module_id = row["spec"]["module_id"].as_str()?.to_string();
            let action_id = row["spec"]["action_id"].as_str()?.to_string();
            let description = row["spec"]["description"].as_str().unwrap_or("").to_string();
            let enabled = row["enabled"].as_bool().unwrap_or(false);
            let kind = if module_id == "script_runner" || action_id.starts_with("script:") {
                "script"
            } else {
                "module_action"
            };
            Some(json!({
                "module_id": module_id,
                "action_id": action_id,
                "description": description,
                "enabled": enabled,
                "kind": kind,
            }))
        })
        .collect()
}

fn explicit_os_error(detail: &str) -> Option<u32> {
    let lower = detail.to_ascii_lowercase();
    let mut last = None;
    let mut rest = lower.as_str();
    while let Some(index) = rest.find("os error ") {
        let after = &rest[index + "os error ".len()..];
        let digits: String = after.chars().take_while(|ch| ch.is_ascii_digit()).collect();
        if let Ok(code) = digits.parse::<u32>() {
            if !digits.is_empty() {
                last = Some(code);
            }
        }
        rest = &rest[index + "os error ".len()..];
    }
    last
}

fn indicates_already_registered(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("hotkey already registered")
        || lower.contains("hot key already registered")
        || lower.contains("hot key is already registered")
        || lower.contains("error_hotkey_already_registered")
}

fn is_bare_f12(accelerator: &str) -> bool {
    accelerator.trim().eq_ignore_ascii_case("F12")
}

fn uses_windows_key(accelerator: &str) -> bool {
    accelerator.split('+').any(|token| {
        let token = token.trim();
        token.eq_ignore_ascii_case("Super")
            || token.eq_ignore_ascii_case("Win")
            || token.eq_ignore_ascii_case("Meta")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn class(detail: &str, accelerator: &str) -> ClassifiedFailure {
        classify_os_failure(detail, accelerator, false)
    }

    #[test]
    fn maps_global_hotkey_1409_phrase_without_naming_a_process() {
        let occupied = class(
            "HotKey already registered: HotKey { mods: (CONTROL | SHIFT), key: KeyA }",
            "Ctrl+Shift+A",
        );
        assert_eq!(occupied.category, "registration_occupied");
        assert_eq!(occupied.os_error_code, Some(1409));
        assert_eq!(occupied.suggestions, OCCUPIED_SUGGESTIONS);
        let value = diagnose_stored_native_error(
            "Ctrl+Shift+A：HotKey already registered: HotKey { key: KeyA } ShareX pid 4242",
        );
        assert!(value["owner"].is_null());
        assert_eq!(value["os_error_code"].as_u64(), Some(1409));
        assert!(value.get("program").is_none());
        assert!(!value.to_string().contains("ShareX"));
        assert!(!value.to_string().contains("4242"));
    }

    #[test]
    fn explicit_os_error_wins_and_does_not_treat_every_failure_as_occupation() {
        let denied = class(
            "Access is denied. (os error 5). HotKey already registered by ShareX",
            "Ctrl+Alt+P",
        );
        assert_eq!(denied.category, "system_denied");
        assert_eq!(denied.os_error_code, Some(5));
        assert!(denied.suggestions.is_empty());

        let invalid = class("The parameter is incorrect. (os error 87)", "Ctrl+Alt+P");
        assert_eq!(invalid.category, "invalid_combo");
        assert_eq!(invalid.os_error_code, Some(87));

        let unknown = class("foreground process is ShareX pid 99", "Ctrl+Alt+P");
        assert_eq!(unknown.category, "unknown_system_failure");
        assert_eq!(unknown.os_error_code, None);
        assert!(unknown.suggestions.is_empty());

        let other = class("The handle is invalid. (os error 6)", "Ctrl+Alt+P");
        assert_eq!(other.category, "unknown_system_failure");
        assert_eq!(other.os_error_code, Some(6));

        let numbered = class("failed (os error 1409)", "Ctrl+Alt+P");
        assert_eq!(numbered.category, "registration_occupied");
        assert_eq!(numbered.os_error_code, Some(1409));
    }

    #[test]
    fn reserves_only_bare_f12_and_keeps_cleanup_failures_separate() {
        let f12 = class("HotKey already registered: F12", "F12");
        assert_eq!(f12.category, "system_reserved");
        assert_eq!(f12.os_error_code, Some(1409));
        assert!(f12.suggestions.is_empty());

        let modified = class("HotKey already registered", "Ctrl+F12");
        assert_eq!(modified.category, "registration_occupied");

        let cleanup = classify_os_failure(
            "Temporary shortcut cleanup failed: HotKey already registered; cleanup failed",
            "F12",
            true,
        );
        assert_eq!(cleanup.category, "probe_failed");
        assert_eq!(cleanup.guidance, PROBE_CLEANUP);
        assert_eq!(cleanup.os_error_code, None);

        let win = class("HotKey already registered", "Shift+Super+S");
        assert_eq!(win.category, "registration_occupied");
        assert_eq!(win.suggestions, OCCUPIED_WIN_SUGGESTIONS);
    }

    #[test]
    fn internal_subjects_copy_only_module_action_and_script_description() {
        let conflicts = vec![json!({
            "spec": {
                "module_id": "script_runner",
                "action_id": "script:run:7",
                "description": "运行脚本 QA",
            },
            "enabled": true,
            "native_error": "C:\\Users\\private\\secret",
        })];
        let value = diagnose_check("internal_conflict", None, "Ctrl+Alt+Q", &conflicts);
        assert!(value["owner"].is_null());
        assert_eq!(value["subjects"][0]["kind"], "script");
        assert_eq!(value["subjects"][0]["description"], "运行脚本 QA");
        assert_eq!(value["subjects"][0]["action_id"], "script:run:7");
        assert!(value["subjects"][0].get("native_error").is_none());
        assert!(!value.to_string().contains("secret"));
    }
}
