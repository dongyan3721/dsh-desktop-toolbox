//! In-memory artifact ledger. A restarted process does not revive old files.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};

use crate::desktop_control::ControlError;
use crate::DesktopHost;

const MAX_PNG_BYTES: usize = 16 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
const MAX_TOTAL_BYTES: usize = 256 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(15 * 60);
const MAX_CHUNK: u64 = 65_536;

struct Artifact {
    module_id: String,
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    epoch: u64,
    created: Instant,
}

#[derive(Default)]
pub(crate) struct AgentArtifacts {
    items: BTreeMap<String, Artifact>,
}

impl AgentArtifacts {
    pub(crate) fn insert(
        &mut self,
        id: String,
        module_id: &str,
        bytes: Vec<u8>,
        width: u32,
        height: u32,
        epoch: u64,
    ) -> Result<(), ControlError> {
        self.prune();
        if bytes.len() > MAX_PNG_BYTES || bytes.is_empty() {
            return Err(ControlError::new("INVALID_REQUEST", "png exceeds 16MiB"));
        }
        let mut total: usize = self.items.values().map(|item| item.bytes.len()).sum();
        while total.saturating_add(bytes.len()) > MAX_TOTAL_BYTES {
            let Some(oldest) = self
                .items
                .iter()
                .min_by_key(|(_, item)| item.created)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            if let Some(removed) = self.items.remove(&oldest) {
                total = total.saturating_sub(removed.bytes.len());
            }
        }
        if total.saturating_add(bytes.len()) > MAX_TOTAL_BYTES {
            return Err(ControlError::new("UNAVAILABLE", "artifact storage is full"));
        }
        self.items.insert(
            id,
            Artifact {
                module_id: module_id.to_string(),
                bytes,
                width,
                height,
                epoch,
                created: Instant::now(),
            },
        );
        Ok(())
    }

    pub(crate) fn bytes(
        &mut self,
        host: &DesktopHost,
        artifact_id: &str,
        module_id: &str,
    ) -> Result<Vec<u8>, ControlError> {
        self.prune();
        Self::authorize(host, module_id)?;
        let item = self.item(artifact_id, module_id, host)?;
        Ok(item.bytes.clone())
    }

    pub(crate) fn read(
        &mut self,
        host: &DesktopHost,
        artifact_id: &str,
        module_id: &str,
        offset: u64,
        length: u64,
    ) -> Result<Value, ControlError> {
        self.prune();
        if !(1..=MAX_CHUNK).contains(&length) {
            return Err(ControlError::new("INVALID_REQUEST", "length must be 1 to 65536"));
        }
        Self::authorize(host, module_id)?;
        let item = self.item(artifact_id, module_id, host)?;
        let total = item.bytes.len() as u64;
        if offset > total {
            return Err(ControlError::new("INVALID_REQUEST", "offset is past the artifact"));
        }
        let available = total - offset;
        let take = length.min(available) as usize;
        let start = offset as usize;
        let slice = &item.bytes[start..start + take];
        if slice.is_empty() && offset != total {
            return Err(ControlError::new("INVALID_REQUEST", "empty chunk is only valid at eof"));
        }
        let eof = offset + slice.len() as u64 == total;
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(slice);
        Ok(json!({
            "artifact_id": artifact_id,
            "module_id": module_id,
            "offset": offset,
            "total_bytes": total,
            "mime_type": "image/png",
            "width": item.width,
            "height": item.height,
            "revision": item.epoch,
            "data_base64": data_base64,
            "eof": eof,
        }))
    }

    fn authorize(host: &DesktopHost, module_id: &str) -> Result<(), ControlError> {
        if module_id != "screenshot" && module_id != "screen_ink" {
            return Err(ControlError::new("INVALID_REQUEST", "module_id is invalid"));
        }
        host.kernel().authorize_agent(module_id).map_err(|error| {
            let code = app_core::agent_error_code(&error).unwrap_or("INTERNAL");
            ControlError::new(code, "agent request failed")
        })
    }

    fn item(
        &self,
        artifact_id: &str,
        module_id: &str,
        host: &DesktopHost,
    ) -> Result<&Artifact, ControlError> {
        let Some(item) = self.items.get(artifact_id) else {
            return Err(ControlError::new("UNAVAILABLE", "artifact is not available"));
        };
        if item.module_id != module_id {
            return Err(ControlError::new("INVALID_REQUEST", "artifact module does not match"));
        }
        if item.epoch != host.kernel().agent_grant_epoch(module_id) {
            return Err(ControlError::new("UNAVAILABLE", "artifact grant epoch has ended"));
        }
        Ok(item)
    }

    fn prune(&mut self) {
        let now = Instant::now();
        self.items
            .retain(|_, item| now.saturating_duration_since(item.created) <= TTL);
    }
}

pub(crate) fn validate_png(bytes: &[u8]) -> Result<(u32, u32), ControlError> {
    if bytes.len() > MAX_PNG_BYTES || bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(ControlError::new("INVALID_REQUEST", "png is not valid"));
    }
    if &bytes[12..16] != b"IHDR" {
        return Err(ControlError::new("INVALID_REQUEST", "png is not valid"));
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || pixels > MAX_PIXELS {
        return Err(ControlError::new("INVALID_REQUEST", "png exceeds the pixel cap"));
    }
    let image = image::load_from_memory(bytes)
        .map_err(|_| ControlError::new("INVALID_REQUEST", "png is not valid"))?;
    if image.width() != width || image.height() != height {
        return Err(ControlError::new("INVALID_REQUEST", "png metadata does not match"));
    }
    Ok((width, height))
}
