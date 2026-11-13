//! Test directories under the current project's `.tmp`.
//!
//! The project root is the ancestor of `CARGO_MANIFEST_DIR` that contains this toolbox.
//! Recursive cleanup runs only after the path is checked to be a child of that `.tmp`.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) fn scoped_fixture(group: &str, name: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let tmp = project_root().join(".tmp");
    let root = tmp.join(group).join(format!(
        "{name}-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    assert!(
        is_inside_tmp(&root, &tmp),
        "refusing to delete {} because it is outside {}",
        root.display(),
        tmp.display()
    );
    if root.exists() {
        std::fs::remove_dir_all(&root).unwrap();
    }
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|dir| dir.join("AGENTS.md").is_file() && dir.join("native").is_dir())
        .expect("CARGO_MANIFEST_DIR is not inside the toolbox project")
        .to_path_buf()
}

fn is_inside_tmp(path: &Path, tmp: &Path) -> bool {
    let path = path_key(path);
    let tmp = path_key(tmp);
    !tmp.is_empty() && path.starts_with(&(tmp + "\\"))
}

fn path_key(path: &Path) -> String {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}
