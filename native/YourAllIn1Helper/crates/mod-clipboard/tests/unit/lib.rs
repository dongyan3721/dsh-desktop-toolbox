use super::*;
use app_core::{AppKernelBuilder, TargetOs};
use os_hal::MockOsHal;

#[test]
fn test_clipboard_deduplication_lru_eviction_and_suppression() {
    let temp_dir = tempfile::tempdir().unwrap();
    let mock_hal = MockOsHal::new();
    let clip_mod = ClipboardModule::new(Arc::new(mock_hal.clone()));

    let kernel = AppKernelBuilder::new(temp_dir.path())
        .with_in_memory_db(true)
        .with_target_os(TargetOs::MacOs)
        .register_module(ClipboardModule::new(Arc::new(mock_hal.clone())))
        .unwrap()
        .bootstrap()
        .unwrap();

    let ctx = kernel.context();

    // 调整容量上限为 3 条以测试 LRU 自动淘汰
    kernel
        .update_config(|cfg| {
            cfg.clipboard.max_history_items = 3;
        })
        .unwrap();

    // 1. 插入 3 条文本并固定第一条
    let r1 = clip_mod
        .capture_text(ctx, "First pinned item", Some("Notes"))
        .unwrap()
        .unwrap();
    assert!(clip_mod.toggle_pin(ctx, r1.id).unwrap());

    let r2 = clip_mod
        .capture_text(ctx, "Second item", Some("Browser"))
        .unwrap()
        .unwrap();
    let _r3 = clip_mod
        .capture_text(ctx, "Third item", Some("Editor"))
        .unwrap()
        .unwrap();
    let _r4 = clip_mod
        .capture_text(ctx, "Fourth item", Some("Terminal"))
        .unwrap()
        .unwrap();

    // 重新复制 "Second item"，验证排重且置顶
    let r2_again = clip_mod
        .capture_text(ctx, "Second item", Some("Browser"))
        .unwrap()
        .unwrap();
    assert_eq!(r2.id, r2_again.id);

    // 插入第 5 条，应当淘汰最旧的未固定项 ("Third item")，保留已固定的 r1 + 3条未固定 = 4条
    let _r5 = clip_mod
        .capture_text(ctx, "Fifth item", Some("Terminal"))
        .unwrap()
        .unwrap();

    let all = clip_mod.list_items(ctx, None, 50).unwrap();
    assert_eq!(all.len(), 4);
    assert_eq!(all[0].content_text.as_deref(), Some("First pinned item"));
    assert!(all[0].is_pinned);

    // 2. 测试防污染屏蔽守卫（如密码本复制或划词翻译取词）
    ctx.event_bus
        .set_clipboard_suppression(true, "password_vault_secret");
    let suppressed = clip_mod
        .capture_text(ctx, "SuperSecretPassword123!", None)
        .unwrap();
    assert!(suppressed.is_none());
    ctx.event_bus.set_clipboard_suppression(false, "done");

    // 3. 测试快捷键唤醒与粘贴销毁
    kernel.trigger_action("clipboard:toggle_popup").unwrap();
    assert_eq!(ctx.window_pool.active_window_count(), 1);

    clip_mod.paste_item(ctx, r2.id, true).unwrap();
    assert_eq!(ctx.window_pool.active_window_count(), 0);
    assert_eq!(mock_hal.paste_trigger_count(), 1);
}

#[test]
fn test_clipboard_image_capture_and_blob_storage() {
    let temp_dir = tempfile::tempdir().unwrap();
    let mock_hal = MockOsHal::new();
    let clip_mod = ClipboardModule::new(Arc::new(mock_hal.clone()));

    let kernel = AppKernelBuilder::new(temp_dir.path())
        .with_in_memory_db(true)
        .with_target_os(TargetOs::MacOs)
        .register_module(ClipboardModule::new(Arc::new(mock_hal.clone())))
        .unwrap()
        .bootstrap()
        .unwrap();

    let ctx = kernel.context();

    // 构造一个 10x10 的红色 RGBA 像素图片
    let width = 10u32;
    let height = 10u32;
    let mut pixels = Vec::new();
    for _ in 0..(width * height) {
        pixels.extend_from_slice(&[255, 0, 0, 255]);
    }

    let rec = clip_mod
        .capture_image_rgba(ctx, width, height, &pixels, Some("ScreenshotApp"))
        .unwrap()
        .expect("图片条目应当成功捕获");

    assert_eq!(rec.item_type, ClipboardItemType::Image);
    assert!(rec.thumb_base64.is_some());
    assert!(rec.blob_rel_path.is_some());

    let blob_path = ctx.app_data_dir.join(rec.blob_rel_path.as_ref().unwrap());
    assert!(blob_path.exists());
}

#[test]
fn test_text_and_image_source_storage_search_and_duplicate_semantics() {
    let temp_dir = tempfile::tempdir().unwrap();
    let mock_hal = MockOsHal::new();
    let clip_mod = ClipboardModule::new(Arc::new(mock_hal.clone()));

    let kernel = AppKernelBuilder::new(temp_dir.path())
        .with_in_memory_db(true)
        .with_target_os(TargetOs::MacOs)
        .register_module(ClipboardModule::new(Arc::new(mock_hal.clone())))
        .unwrap()
        .bootstrap()
        .unwrap();
    let ctx = kernel.context();

    let text = clip_mod
        .capture_text(ctx, "Source-aware text", Some("Code"))
        .unwrap()
        .expect("text item");
    assert_eq!(text.source_app_name.as_deref(), Some("Code"));
    assert_eq!(
        clip_mod.list_items(ctx, Some("Code"), 20).unwrap().len(),
        1,
        "source search must find the text item"
    );
    assert_eq!(
        clip_mod.list_items(ctx, Some("Source-aware"), 20).unwrap().len(),
        1,
        "content search must still work"
    );

    // 同一内容再次复制：已知新来源更新来源；未知来源保留已有来源。
    let text_again = clip_mod
        .capture_text(ctx, "Source-aware text", Some("Browser"))
        .unwrap()
        .unwrap();
    assert_eq!(text_again.id, text.id);
    assert_eq!(text_again.source_app_name.as_deref(), Some("Browser"));
    let text_unknown = clip_mod
        .capture_text(ctx, "Source-aware text", None)
        .unwrap()
        .unwrap();
    assert_eq!(text_unknown.id, text.id);
    assert_eq!(text_unknown.source_app_name.as_deref(), Some("Browser"));

    let unknown_only = clip_mod
        .capture_text(ctx, "Unknown source text", None)
        .unwrap()
        .unwrap();
    assert_eq!(unknown_only.source_app_name, None);

    let width = 4u32;
    let height = 4u32;
    let mut pixels = Vec::new();
    for _ in 0..(width * height) {
        pixels.extend_from_slice(&[0, 128, 255, 255]);
    }
    let image = clip_mod
        .capture_image_rgba(ctx, width, height, &pixels, Some("ScreenshotApp"))
        .unwrap()
        .expect("image item");
    assert_eq!(image.source_app_name.as_deref(), Some("ScreenshotApp"));
    assert_eq!(
        clip_mod.list_items(ctx, Some("ScreenshotApp"), 20).unwrap().len(),
        1,
        "source search must find the image item"
    );
    let image_unknown = clip_mod
        .capture_image_rgba(ctx, width, height, &pixels, None)
        .unwrap()
        .unwrap();
    assert_eq!(image_unknown.id, image.id);
    assert_eq!(image_unknown.source_app_name.as_deref(), Some("ScreenshotApp"));

    // 停用和屏蔽租约继续拒绝新采集，且不影响已存条目来源。
    kernel
        .update_config(|cfg| cfg.clipboard.enabled = false)
        .unwrap();
    assert!(clip_mod
        .capture_text(ctx, "Disabled text", Some("Code"))
        .unwrap()
        .is_none());
    assert!(clip_mod
        .capture_image_rgba(ctx, width, height, &pixels, Some("ScreenshotApp"))
        .unwrap()
        .is_none());
    kernel
        .update_config(|cfg| cfg.clipboard.enabled = true)
        .unwrap();

    ctx.event_bus
        .set_clipboard_suppression(true, "password_vault_secret");
    assert!(clip_mod
        .capture_text(ctx, "Suppressed text", Some("Code"))
        .unwrap()
        .is_none());
    assert!(clip_mod
        .capture_image_rgba(ctx, width, height, &pixels, Some("ScreenshotApp"))
        .unwrap()
        .is_none());
    ctx.event_bus.set_clipboard_suppression(false, "done");
}
