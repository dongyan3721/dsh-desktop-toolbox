//! Best-effort clipboard owner metadata for the real clipboard listener.
//!
//! Windows reports the clipboard owner window, not the foreground application.
//! The owner is mapped through its process image name; a null owner, exited
//! process, access denial, or unstable clipboard sequence deliberately yields
//! `None` instead of guessing from the foreground window.

/// Immutable metadata sampled around one clipboard read.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClipboardOwnerSnapshot {
    /// System clipboard change sequence; `0` means the system did not provide a
    /// stable value around the owner lookup.
    pub sequence: u32,
    /// Process owning the clipboard window, when it could be read.
    pub owner_pid: Option<u32>,
    /// Executable stem (for example `Code`), never a full path.
    pub app_name: Option<String>,
}

/// How a listener should treat a text/image read bracketed by two snapshots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardSourceDecision {
    /// Content and owner belong to the same stable sequence. The optional
    /// source is `None` when ownership could not be proven.
    Use(Option<String>),
    /// The clipboard changed during the read; discard this observation rather
    /// than pairing new content with an old owner.
    Changed,
}

/// Compare snapshots taken immediately before and after reading clipboard data.
///
/// - A sequence change means the read may have mixed two clipboard states.
/// - A missing/zero sequence cannot prove ownership, so source is unknown.
/// - A PID mismatch with an unchanged sequence is treated as unknown.
pub fn resolve_clipboard_source(
    before: &ClipboardOwnerSnapshot,
    after: &ClipboardOwnerSnapshot,
) -> ClipboardSourceDecision {
    if before.sequence == 0 || after.sequence == 0 {
        return ClipboardSourceDecision::Use(None);
    }
    if before.sequence != after.sequence {
        return ClipboardSourceDecision::Changed;
    }
    if before.owner_pid != after.owner_pid {
        return ClipboardSourceDecision::Use(None);
    }
    ClipboardSourceDecision::Use(
        after
            .app_name
            .clone()
            .filter(|name| !name.trim().is_empty()),
    )
}

#[cfg(target_os = "windows")]
pub fn clipboard_owner_snapshot() -> ClipboardOwnerSnapshot {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::DataExchange::{GetClipboardOwner, GetClipboardSequenceNumber};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let before = unsafe { GetClipboardSequenceNumber() };
    if before == 0 {
        return ClipboardOwnerSnapshot::default();
    }

    let owner = match unsafe { GetClipboardOwner() } {
        Ok(hwnd) if !hwnd.0.is_null() => hwnd,
        _ => {
            return ClipboardOwnerSnapshot {
                sequence: before,
                ..ClipboardOwnerSnapshot::default()
            }
        }
    };

    let mut pid = 0u32;
    // SAFETY: read-only query for the owner window's process.
    unsafe { GetWindowThreadProcessId(owner, Some(&mut pid)) };
    let after = unsafe { GetClipboardSequenceNumber() };
    if after == 0 || before != after {
        // The clipboard changed while reading the owner; do not pair content
        // with a possibly stale process.
        return ClipboardOwnerSnapshot::default();
    }
    if pid == 0 {
        return ClipboardOwnerSnapshot {
            sequence: before,
            ..ClipboardOwnerSnapshot::default()
        };
    }

    // Our own process never supplies a guessed source. The listener passes
    // None, which preserves an explicit Agent/manual source already stored for
    // the same content.
    let app_name = if pid == std::process::id() {
        None
    } else {
        let mut path_buffer = [0u16; 32_768];
        let mut path_length = path_buffer.len() as u32;
        let mut executable_path = None;
        // SAFETY: handle is opened for query only and closed before return.
        if let Ok(handle) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
            if unsafe {
                QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    PWSTR(path_buffer.as_mut_ptr()),
                    &mut path_length,
                )
            }
            .is_ok()
                && path_length > 0
            {
                let path = String::from_utf16_lossy(&path_buffer[..path_length as usize]);
                executable_path = std::path::Path::new(&path)
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .filter(|stem| !stem.is_empty())
                    .map(str::to_owned);
            }
            let _ = unsafe { CloseHandle(handle) };
        }
        executable_path
    };

    ClipboardOwnerSnapshot {
        sequence: before,
        owner_pid: Some(pid),
        app_name,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn clipboard_owner_snapshot() -> ClipboardOwnerSnapshot {
    // Owner lookup is not implemented on this platform; report unknown rather
    // than inferring from the foreground app.
    ClipboardOwnerSnapshot::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(sequence: u32, pid: Option<u32>, name: Option<&str>) -> ClipboardOwnerSnapshot {
        ClipboardOwnerSnapshot {
            sequence,
            owner_pid: pid,
            app_name: name.map(str::to_owned),
        }
    }

    #[test]
    fn stable_sequence_returns_owner_app_name() {
        assert_eq!(
            resolve_clipboard_source(
                &snapshot(7, Some(42), Some("Code")),
                &snapshot(7, Some(42), Some("Code")),
            ),
            ClipboardSourceDecision::Use(Some("Code".to_string())),
        );
    }

    #[test]
    fn sequence_change_is_not_attributed() {
        assert_eq!(
            resolve_clipboard_source(
                &snapshot(7, Some(42), Some("Code")),
                &snapshot(8, Some(99), Some("Browser")),
            ),
            ClipboardSourceDecision::Changed,
        );
    }

    #[test]
    fn missing_sequence_or_name_falls_back_to_unknown() {
        assert_eq!(
            resolve_clipboard_source(
                &snapshot(0, Some(42), Some("Code")),
                &snapshot(0, Some(42), Some("Code")),
            ),
            ClipboardSourceDecision::Use(None),
        );
        assert_eq!(
            resolve_clipboard_source(&snapshot(7, Some(42), None), &snapshot(7, Some(42), None),),
            ClipboardSourceDecision::Use(None),
        );
        assert_eq!(
            resolve_clipboard_source(&snapshot(7, None, None), &snapshot(7, None, None),),
            ClipboardSourceDecision::Use(None),
        );
    }

    #[test]
    fn owner_exit_or_access_denied_falls_back_to_unknown() {
        // A disappeared process or an OpenProcess/QueryFullProcessImageName
        // denial leaves only the PID; it must never be replaced by a guessed
        // foreground application.
        assert_eq!(
            resolve_clipboard_source(&snapshot(11, Some(42), None), &snapshot(11, Some(42), None),),
            ClipboardSourceDecision::Use(None),
        );
    }

    #[test]
    fn null_owner_falls_back_to_unknown() {
        assert_eq!(
            resolve_clipboard_source(&snapshot(11, None, None), &snapshot(11, None, None)),
            ClipboardSourceDecision::Use(None),
        );
    }

    #[test]
    fn pid_mismatch_with_same_sequence_is_unknown() {
        assert_eq!(
            resolve_clipboard_source(
                &snapshot(7, Some(42), Some("Code")),
                &snapshot(7, Some(43), Some("Browser")),
            ),
            ClipboardSourceDecision::Use(None),
        );
    }
}
