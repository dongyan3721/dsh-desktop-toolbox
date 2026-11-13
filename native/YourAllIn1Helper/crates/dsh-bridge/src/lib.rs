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
