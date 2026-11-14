//! Domain types shared across `os-hal` traits and feature modules.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Unified result type for OS HAL operations.
pub type HalResult<T> = Result<T, HalError>;

/// Platform-neutral opaque identifier for an external OS window (`HWND` on Windows, `CGWindowID` on macOS).
pub type WindowHandleId = u64;

/// Errors originating from native OS HAL adapters.
#[derive(Debug, Error)]
pub enum HalError {
    #[error("OS permission denied for '{capability}': {guidance}")]
    PermissionDenied {
        capability: &'static str,
        guidance: String,
    },

    #[error("Requested OS resource not found: {0}")]
    NotFound(String),

    #[error("Platform capability '{0}' is not supported or unavailable on this system")]
    Unsupported(&'static str),

    #[error("Native OS API call failed: {0}")]
    NativeCallFailed(String),
}

/// Monitor topology in the capturer's declared native desktop units.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DisplayMonitorInfo {
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

impl DisplayMonitorInfo {
    pub fn logical_size(&self, coordinates_are_logical: bool) -> (f64, f64) {
        let divisor = if coordinates_are_logical { 1.0 } else { self.valid_scale() };
        (f64::from(self.width) / divisor, f64::from(self.height) / divisor)
    }

    pub fn physical_pixels(mut self, coordinates_are_logical: bool) -> Self {
        if coordinates_are_logical {
            let scale = self.valid_scale();
            self.x = (f64::from(self.x) * scale).round() as i32;
            self.y = (f64::from(self.y) * scale).round() as i32;
            self.width = (f64::from(self.width) * scale).round() as u32;
            self.height = (f64::from(self.height) * scale).round() as u32;
        }
        self
    }

    fn valid_scale(&self) -> f64 {
        if self.scale_factor.is_finite() && self.scale_factor > 0.1 { self.scale_factor } else { 1.0 }
    }
}

#[cfg(test)]
mod monitor_coordinate_tests {
    use super::*;

    #[test]
    fn retina_points_keep_full_canvas_and_convert_agent_bounds_once() {
        let points = DisplayMonitorInfo { id: 1, name: "Retina".into(), x: -1470, y: 0,
            width: 1470, height: 956, scale_factor: 2.0, is_primary: true };
        assert_eq!(points.logical_size(true), (1470.0, 956.0));
        let pixels = points.clone().physical_pixels(true);
        assert_eq!((pixels.x, pixels.width, pixels.height), (-2940, 2940, 1912));
        assert_eq!(pixels.logical_size(false), (1470.0, 956.0));
        assert_eq!(pixels.clone().physical_pixels(false), pixels);
    }

    #[test]
    fn invalid_scale_does_not_shrink_or_overflow_bounds() {
        let monitor = DisplayMonitorInfo { id: 1, name: "fixture".into(), x: 0, y: 0,
            width: 1920, height: 1080, scale_factor: f64::NAN, is_primary: true };
        assert_eq!(monitor.logical_size(false), (1920.0, 1080.0));
        assert_eq!(monitor.physical_pixels(true).width, 1920);
    }
}

/// Frozen RGBA8 screen capture frame buffer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapturedFrame {
    pub width: u32,
    pub height: u32,
    pub scale_factor_milli: u32,
    /// Raw RGBA8 pixel bytes (`width * height * 4`).
    pub rgba_bytes: Vec<u8>,
}

/// Backend engine that fulfilled an OCR request in the fallback chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OcrBackendKind {
    /// Windows.Media.Ocr or macOS Vision framework (`VNRecognizeTextRequest`).
    SystemNative,
    /// ONNX Runtime GPU provider (`CUDA` / `DirectML` / `CoreML GPU`).
    OnnxGpu,
    /// ONNX Runtime NPU provider (`DirectML NPU` / `OpenVINO NPU` / `Apple Neural Engine`).
    OnnxNpu,
    /// ONNX Runtime CPU fallback (`AVX2` / `NEON`).
    OnnxCpu,
}

/// Single line recognized by OCR with bounding box coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrLineResult {
    pub text: String,
    pub confidence: f32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Complete OCR recognition result returned to `mod-screenshot`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrRecognitionResult {
    pub backend_used: OcrBackendKind,
    pub full_text: String,
    pub lines: Vec<OcrLineResult>,
    pub elapsed_ms: u64,
}

/// Metadata describing an external third-party OS window (used by `mod-window-pin`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalWindowInfo {
    pub handle: WindowHandleId,
    pub title: String,
    pub process_name: String,
    pub process_id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_topmost: bool,
}

/// Channel that produced the extracted global text selection (used by `mod-translator`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionSource {
    /// Zero-clipboard-pollution native accessibility API (`UIAutomation` / `AXUIElement`).
    AccessibilityApi,
    /// Fallback simulated `Ctrl+C` / `Cmd+C` with clipboard backup & restore.
    SimulatedCopyFallback,
}

/// Selected text payload returned by `SelectionExtractor`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectionTextResult {
    pub text: String,
    pub source: SelectionSource,
    pub source_app_name: Option<String>,
}

/// Outcome of a biometric / device-owner authentication prompt (`mod-password-vault`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BiometricResult {
    Verified,
    CancelledByUser,
    NotEnrolled,
    Failed(String),
}

/// Snapshot of the current foreground application (`mod-app-usage`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveAppSnapshot {
    /// Canonical identifier (Bundle ID on macOS, normalized executable path on Windows).
    pub app_id: String,
    pub app_name: String,
    pub window_title: String,
    pub executable_path: Option<String>,
    pub process_id: u32,
}
