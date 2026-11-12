//! Waitable exact-path image conversion. Reuses the crate's encoder and no-clobber publication.

use crate::image::process_with_hook;
use crate::output::{self, create_private_partial};
use crate::types::{ImageConvertOptions, ImageOutputFormat, MediaJob};
use app_core::{CoreError, CoreResult};
use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone)]
pub struct ExactImageRequest {
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub format: ImageOutputFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExactImageStatus {
    Completed,
    Cancelled,
}

pub fn convert_image_exact(
    request: &ExactImageRequest,
    cancelled: &AtomicBool,
) -> CoreResult<ExactImageStatus> {
    convert_image_exact_with(request, cancelled, &|| {}, &|| {})
}

pub fn convert_image_exact_with(
    request: &ExactImageRequest,
    cancelled: &AtomicBool,
    before_publish: &dyn Fn(),
    after_publish: &dyn Fn(),
) -> CoreResult<ExactImageStatus> {
    if cancelled.load(Ordering::Acquire) {
        return Ok(ExactImageStatus::Cancelled);
    }
    if !request.input_path.is_file() {
        return Err(CoreError::Config("input image was not found".into()));
    }
    let Some(parent) = request.output_path.parent() else {
        return Err(CoreError::Config("output directory is not available".into()));
    };
    if !parent.is_dir() {
        return Err(CoreError::Config("output directory is not available".into()));
    }
    if std::fs::symlink_metadata(&request.output_path).is_ok() {
        return Err(CoreError::Config("output already exists".into()));
    }
    let partial = create_private_partial(parent)?;
    let published = Cell::new(false);
    let outcome = publish_exact(request, &partial, cancelled, before_publish, &|| {
        published.set(true);
        after_publish();
    });
    match outcome {
        Ok(()) => {
            let _ = output::remove_partial(&partial);
            Ok(ExactImageStatus::Completed)
        }
        Err(error) => {
            output::remove_partial(&partial);
            if published.get() {
                return Ok(ExactImageStatus::Completed);
            }
            if cancelled.load(Ordering::Acquire) {
                return Ok(ExactImageStatus::Cancelled);
            }
            Err(sanitize_image_error(error))
        }
    }
}

fn publish_exact(
    request: &ExactImageRequest,
    partial: &Path,
    cancelled: &AtomicBool,
    before_publish: &dyn Fn(),
    after_publish: &dyn Fn(),
) -> CoreResult<()> {
    let mut job = MediaJob::new("image_convert", request.input_path.clone());
    job.output_path = Some(request.output_path.clone());
    let options = ImageConvertOptions {
        output_format: request.format,
        quality: None,
        width: None,
        height: None,
        preserve_aspect: true,
    };
    process_with_hook(&job, &options, partial, cancelled, before_publish, after_publish)
}

fn sanitize_image_error(error: CoreError) -> CoreError {
    let text = error.to_string();
    let message = if text.contains("cannot decode") {
        "input image could not be decoded"
    } else if text.contains("refusing to overwrite") || text.contains("output already exists") {
        "output already exists"
    } else if text.contains("encoding failed") || text.contains("ICO encoding") {
        "image conversion failed"
    } else {
        "image conversion failed"
    };
    CoreError::Config(message.to_string())
}
