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
mod winutil;

pub use service::run_from_env;

/// Framing and Windows pipe primitives shared with the desktop control pipe.
/// The desktop host must not start `BridgeService` or a second kernel.
pub mod transport {
    pub use crate::protocol::{
        encode_frame, expected_pipe_name, parse_message, ClientMessage, FrameDecoder,
        ProtocolFault, MAX_FRAME_LEN, PROTOCOL_VERSION,
    };
    pub use crate::winutil::{
        client_process_id, create_listening_pipe, watch_parent, InstanceLock,
    };
}
