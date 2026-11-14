//! Headless named-pipe bridge for the toolbox.
//!
//! This process reuses `AppKernel` and the sticky-note module. It does not create a
//! WebView, screenshot overlay, or desktop note window, and it does not start clipboard,
//! usage tracking, or the password vault. `HeadlessWindowBackend` only records window
//! requests in memory; it is not a production desktop backend, and `MockOsHal` is not used.

mod protocol;
mod service;
mod session;
#[cfg(test)]
mod test_fixture;
#[cfg(windows)]
mod winutil;
#[cfg(target_os = "macos")]
mod macutil;
#[cfg(not(any(windows, target_os = "macos")))]
compile_error!("dsh-bridge private IPC supports only Windows named pipes and macOS Unix sockets");

pub use service::run_from_env;

/// Framing and private IPC primitives shared with the desktop control endpoint.
/// The desktop host must not start `BridgeService` or a second kernel.
pub mod transport {
    pub use crate::protocol::{
        encode_frame, expected_pipe_name, parse_message, ClientMessage, FrameDecoder,
        ProtocolFault, MAX_FRAME_LEN, PROTOCOL_VERSION,
    };
    #[cfg(windows)]
    pub use crate::winutil::{
        client_process_id, create_listening_pipe, watch_parent, InstanceLock,
    };
    #[cfg(target_os = "macos")]
    pub use crate::macutil::{
        accept_peer, validate_socket_path, watch_parent, InstanceLock, SocketListener,
    };
}
