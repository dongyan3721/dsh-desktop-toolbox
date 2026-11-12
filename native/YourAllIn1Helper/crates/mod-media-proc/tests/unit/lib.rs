use super::*;
use crate::{av::ProgressLine, output::prepare_output};
use ::image::{ImageBuffer, Rgb};
use std::fs;
use tempfile::TempDir;

pub(crate) fn test_dir(label: &str) -> TempDir {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(".runtime_data")
        .join("mod-media-proc-tests");
    fs::create_dir_all(&root).unwrap();
    tempfile::Builder::new()
        .prefix(&format!("{label}-"))
        .tempdir_in(root)
        .unwrap()
}

fn sample_png(path: &Path) {
    let image = ImageBuffer::from_fn(12, 8, |x, y| Rgb([(x * 17) as u8, (y * 29) as u8, 120_u8]));
    image.save(path).unwrap();
}

#[test]
fn config_and_parameters_are_validated() {
    let mut config = MediaProcConfig::default();
    config.max_concurrent_jobs = 0;
    assert!(config.validate().is_err());
    let mut image = ImageConvertOptions::default();
    image.quality = Some(80);
    assert!(image.validate().is_err());
    image.output_format = ImageOutputFormat::Jpeg;
    assert!(image.validate().is_ok());
    image.quality = Some(101);
    assert!(image.validate().is_err());
    image.quality = Some(80);
    image.width = Some(0);
    assert!(image.validate().is_err());
    image.width = None;
    image.preserve_aspect = false;
    assert!(image.validate().is_err());
}

#[test]
fn real_rust_codecs_convert_resize_and_never_overwrite() {
    let dir = test_dir("codecs");
    let input = dir.path().join("图片 with spaces.png");
    sample_png(&input);
    for format in [
        ImageOutputFormat::Png,
        ImageOutputFormat::Jpeg,
        ImageOutputFormat::Webp,
        ImageOutputFormat::Bmp,
        ImageOutputFormat::Ico,
    ] {
        let mut job = MediaJob::new("image_convert", input.clone());
        let (output, partial) =
            prepare_output(&input, Some(dir.path()), format.extension(), &job.id).unwrap();
        job.output_path = Some(output.clone());
        let options = ImageConvertOptions {
            output_format: format,
            quality: (format == ImageOutputFormat::Jpeg).then_some(82),
            width: Some(6),
            height: None,
            preserve_aspect: true,
        };
        image::process(
            &job,
            &options,
            &partial,
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();
        let decoded = ::image::open(&output).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (6, 4));
        assert!(input.exists());
    }
}

#[test]
fn output_names_handle_unicode_spaces_and_conflicts() {
    let dir = test_dir("outputs");
    let input = dir.path().join("示例 文件.png");
    sample_png(&input);
    let (first, _) = prepare_output(&input, None, "webp", "a").unwrap();
    fs::write(&first, b"do not overwrite").unwrap();
    let (second, _) = prepare_output(&input, None, "webp", "b").unwrap();
    assert_ne!(first, second);
    assert_eq!(fs::read(&first).unwrap(), b"do not overwrite");
    let (pending_first, _) = prepare_output(&input, None, "bmp", "c").unwrap();
    let (pending_second, _) = prepare_output(&input, None, "bmp", "d").unwrap();
    assert_ne!(pending_first, pending_second);
    assert!(!pending_first.exists());
    crate::output::release_output(&pending_first);
    crate::output::release_output(&pending_second);
}

#[test]
fn ffmpeg_progress_parser_accepts_real_pipe_keys() {
    let mut parser = ProgressLine::default();
    parser.parse("out_time_us=1500000");
    parser.parse("speed= 2.5x");
    parser.parse("progress=continue");
    assert_eq!(parser.out_time_us, Some(1_500_000.0));
    assert_eq!(parser.speed.as_deref(), Some("2.5x"));
    assert!(!parser.ended);
    parser.parse("progress=end");
    assert!(parser.ended);
}

#[test]
fn trim_and_volume_validation_rejects_invalid_ranges() {
    let dir = test_dir("validation");
    let input = dir.path().join("in.wav");
    fs::write(&input, b"placeholder").unwrap();
    let request = |operation| AvJobRequest {
        input_path: input.clone(),
        operation,
        output_format: Some("wav".into()),
        output_dir: None,
        start_seconds: None,
        end_seconds: None,
        volume: None,
        precise: false,
    };
    assert!(request(AvOperation::Trim).validate().is_err());
    let mut trim = request(AvOperation::Trim);
    trim.start_seconds = Some(3.0);
    trim.end_seconds = Some(2.0);
    assert!(trim.validate().is_err());
    let mut volume = request(AvOperation::AdjustVolume);
    volume.volume = Some(-1.0);
    assert!(volume.validate().is_err());
}

fn worktree_fixture(name: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|dir| dir.join("AGENTS.md").is_file() && dir.join("native").is_dir())
        .expect("CARGO_MANIFEST_DIR is not inside the toolbox project")
        .to_path_buf();
    let tmp = project.join(".tmp");
    let root = tmp.join("mod-media-proc-tests").join(format!(
        "{name}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let root_key = fixture_key(&root);
    let tmp_key = fixture_key(&tmp);
    assert!(
        !tmp_key.is_empty() && root_key.starts_with(&(tmp_key + "\\")),
        "refusing to delete {} because it is outside {}",
        root.display(),
        tmp.display()
    );
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }
    fs::create_dir_all(&root).unwrap();
    root
}

fn fixture_key(path: &Path) -> String {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn staging_names(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            name.starts_with(".dsh-").then_some(name)
        })
        .collect()
}

#[test]
fn exact_conversion_uses_real_codecs_and_settles_cancellation() {
    let dir = worktree_fixture("exact");
    let input = dir.join("source.png");
    sample_png(&input);
    let cases = [
        (ImageOutputFormat::Png, "out.png", &b"\x89PNG"[..]),
        (ImageOutputFormat::Jpeg, "out.jpg", &b"\xFF\xD8\xFF"[..]),
        (ImageOutputFormat::Webp, "out.webp", &b"RIFF"[..]),
        (ImageOutputFormat::Bmp, "out.bmp", &b"BM"[..]),
        (ImageOutputFormat::Ico, "out.ico", &b"\x00\x00\x01\x00"[..]),
    ];
    for (format, name, magic) in cases {
        let output = dir.join(name);
        let status = convert_image_exact(
            &ExactImageRequest {
                input_path: input.clone(),
                output_path: output.clone(),
                format,
            },
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(status, ExactImageStatus::Completed);
        let bytes = fs::read(&output).unwrap();
        assert!(bytes.starts_with(magic), "{name} did not start with its magic bytes");
        if format == ImageOutputFormat::Webp {
            assert_eq!(&bytes[8..12], b"WEBP");
        }
        let decoded = ::image::open(&output).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (12, 8));
        assert!(staging_names(&dir).is_empty());
    }

    let bad = dir.join("bad.png");
    fs::write(&bad, b"this is not an image").unwrap();
    let bad_out = dir.join("bad-out.png");
    let error = convert_image_exact(
        &ExactImageRequest {
            input_path: bad,
            output_path: bad_out.clone(),
            format: ImageOutputFormat::Png,
        },
        &std::sync::atomic::AtomicBool::new(false),
    )
    .unwrap_err();
    assert!(error.to_string().contains("could not be decoded"));
    assert!(!bad_out.exists());
    assert!(staging_names(&dir).is_empty());

    let existing = dir.join("existing.png");
    fs::write(&existing, b"keep-these-bytes").unwrap();
    let error = convert_image_exact(
        &ExactImageRequest {
            input_path: input.clone(),
            output_path: existing.clone(),
            format: ImageOutputFormat::Png,
        },
        &std::sync::atomic::AtomicBool::new(false),
    )
    .unwrap_err();
    assert!(error.to_string().contains("already exists"));
    assert_eq!(fs::read(&existing).unwrap(), b"keep-these-bytes");

    let early = dir.join("early.png");
    let early_flag = std::sync::atomic::AtomicBool::new(true);
    assert_eq!(
        convert_image_exact(
            &ExactImageRequest {
                input_path: input.clone(),
                output_path: early.clone(),
                format: ImageOutputFormat::Png,
            },
            &early_flag,
        )
        .unwrap(),
        ExactImageStatus::Cancelled
    );
    assert!(!early.exists());
    assert!(staging_names(&dir).is_empty());

    let during = dir.join("during.png");
    let during_flag = std::sync::atomic::AtomicBool::new(false);
    let saw_staging = std::sync::atomic::AtomicBool::new(false);
    let status = convert_image_exact_with(
        &ExactImageRequest {
            input_path: input.clone(),
            output_path: during.clone(),
            format: ImageOutputFormat::Png,
        },
        &during_flag,
        &|| {
            assert!(!during.exists());
            assert!(!staging_names(&dir).is_empty());
            saw_staging.store(true, std::sync::atomic::Ordering::Relaxed);
            during_flag.store(true, std::sync::atomic::Ordering::Release);
        },
        &|| panic!("publish ran after cancellation"),
    )
    .unwrap();
    assert_eq!(status, ExactImageStatus::Cancelled);
    assert!(saw_staging.load(std::sync::atomic::Ordering::Relaxed));
    assert!(!during.exists());
    assert!(staging_names(&dir).is_empty());

    let published = dir.join("published.png");
    let published_flag = std::sync::atomic::AtomicBool::new(false);
    let status = convert_image_exact_with(
        &ExactImageRequest {
            input_path: input,
            output_path: published.clone(),
            format: ImageOutputFormat::Png,
        },
        &published_flag,
        &|| {},
        &|| published_flag.store(true, std::sync::atomic::Ordering::Release),
    )
    .unwrap();
    assert_eq!(status, ExactImageStatus::Completed);
    assert!(published_flag.load(std::sync::atomic::Ordering::Relaxed));
    assert_eq!(::image::open(&published).unwrap().width(), 12);
    assert!(staging_names(&dir).is_empty());
}
