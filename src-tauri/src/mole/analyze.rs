//! Disk usage, from `mole analyze -json`.
//!
//! The engine answers one level at a time: no argument gives a curated overview
//! of the places worth looking, and a path gives that directory's children. It
//! is not a tree — drilling down means asking again.
//!
//! A real path also comes back with `large_files`, a deep scan of the biggest
//! individual files underneath. That is often the more useful answer: a
//! directory listing tells you Library is large, while this tells you which
//! single file to delete.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};
use crate::mole::runner::Engine;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Analysis {
    pub path: String,
    /// True for the curated top-level view, which has no parent to go back to.
    pub overview: bool,
    pub entries: Vec<Entry>,
    /// Only present when analyzing a real path.
    pub large_files: Vec<LargeFile>,
    pub total_size: u64,
    pub total_files: u64,
    /// Not from the engine; lets the UI abbreviate paths as `~/…`.
    #[serde(skip_deserializing)]
    pub home: String,
}

impl Default for Analysis {
    fn default() -> Self {
        Analysis {
            path: String::new(),
            overview: false,
            entries: Vec::new(),
            large_files: Vec::new(),
            total_size: 0,
            total_files: 0,
            home: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    /// The engine flags this as somewhere worth cleaning. Overview only.
    pub insight: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct LargeFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/// One snapshot of a scan in progress: the directories measured so far.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressSnapshot {
    entries: Vec<ProgressEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEntry {
    name: String,
    path: String,
    size: u64,
}

/// Walks a directory tree and returns its size in bytes, without following
/// symlinks (a link back up the tree would loop forever) and tolerating
/// unreadable branches.
fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            total += dir_size(&entry.path());
        } else if file_type.is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    total
}

/// Reports the first-level directories of `root` as each one finishes being
/// measured, so the treemap grows while the engine's authoritative scan runs.
///
/// The snapshot carries the sizes known so far; the frontend keeps whatever the
/// engine has not reported yet. This is a live estimate — the engine's final
/// answer replaces it, which is fine, because every block animates smoothly to
/// its settled size.
fn scan_progressively(root: std::path::PathBuf, app: AppHandle) {
    let Ok(dirs) = std::fs::read_dir(&root) else {
        return;
    };
    let dirs: Vec<std::path::PathBuf> = dirs
        .flatten()
        .map(|entry| entry.path())
        .filter(|p| p.is_dir())
        .collect();
    if dirs.is_empty() {
        return;
    }

    let done: std::sync::Arc<std::sync::Mutex<Vec<(String, std::path::PathBuf, u64)>>> =
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

    for dir in dirs {
        let done = done.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            let size = dir_size(&dir);
            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if let Ok(mut guard) = done.lock() {
                guard.push((name, dir, size));
            }
            let entries: Vec<ProgressEntry> = {
                let guard = done.lock().expect("progress lock");
                let mut entries: Vec<ProgressEntry> = guard
                    .iter()
                    .map(|(name, path, size)| ProgressEntry {
                        name: name.clone(),
                        path: path.display().to_string(),
                        size: *size,
                    })
                    .collect();
                entries.sort_by(|a, b| b.size.cmp(&a.size));
                entries
            };
            let _ = app.emit(
                "analyze://progress",
                ProgressSnapshot { entries },
            );
        });
    }
}

#[tauri::command]
pub async fn analyze(app: AppHandle, path: Option<String>) -> Result<Analysis> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;

        // Reject anything that is not an absolute path before handing it to a
        // shell entrypoint.
        if let Some(target) = &path {
            if !target.starts_with('/') {
                return Err(Error::Other(format!("不是绝对路径：{target}")));
            }
        }

        // A drill-down is also reported live while the engine measures.
        if let Some(target) = &path {
            scan_progressively(std::path::PathBuf::from(target), app.clone());
        }

        let mut analysis: Analysis = match &path {
            Some(target) => engine.capture_json(&["analyze", "-json", target])?,
            None => engine.capture_json(&["analyze", "-json"])?,
        };

        // Largest first, so the list and the treemap agree on rank.
        analysis
            .entries
            .sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
        analysis.large_files.sort_by(|a, b| b.size.cmp(&a.size));
        analysis.home = crate::mole::paths::home_dir().display().to_string();

        Ok(analysis)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[cfg(test)]
mod size_tests {
    use std::io::Write;

    use super::dir_size;

    #[test]
    fn measures_a_tree_including_nested_dirs() {
        let dir = std::env::temp_dir().join(format!("mkcleaner-size-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("a/b")).expect("create fixture");
        let mut file = std::fs::File::create(dir.join("a/one")).expect("create file");
        file.write_all(&[0u8; 100]).expect("write");
        std::fs::File::create(dir.join("a/b/two"))
            .expect("create file")
            .write_all(&[0u8; 50])
            .expect("write");
        std::fs::File::create(dir.join("root")).expect("create file");

        let size = dir_size(&dir);
        assert_eq!(size, 150, "sums file bytes but not the directory entries themselves");

        std::fs::remove_dir_all(&dir).expect("cleanup fixture");
    }

    #[test]
    fn does_not_follow_a_symlink_loop() {
        let dir = std::env::temp_dir().join(format!("mkcleaner-loop-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("real")).expect("create fixture");
        std::fs::File::create(dir.join("real/one"))
            .expect("create file")
            .write_all(&[0u8; 10])
            .expect("write");
        std::os::unix::fs::symlink(&dir.join("real"), dir.join("real/loop")).expect("symlink");

        let size = dir_size(&dir);
        assert_eq!(size, 10, "the loop link contributes nothing and terminates");

        std::fs::remove_dir_all(&dir).expect("cleanup fixture");
    }

    #[test]
    fn tolerates_unreadable_branches() {
        let dir = std::env::temp_dir().join(format!("mkcleaner-deny-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("open")).expect("create fixture");
        std::fs::File::create(dir.join("open/one"))
            .expect("create file")
            .write_all(&[0u8; 10])
            .expect("write");
        std::fs::create_dir_all(dir.join("denied")).expect("create fixture");
        std::fs::File::create(dir.join("denied/two"))
            .expect("create file")
            .write_all(&[0u8; 40])
            .expect("write");
        std::fs::set_permissions(
            dir.join("denied"),
            std::os::unix::fs::PermissionsExt::from_mode(0o000),
        )
        .expect("chmod");

        let size = dir_size(&dir);
        assert_eq!(size, 10, "the unreadable branch contributes nothing");

        std::fs::set_permissions(
            dir.join("denied"),
            std::os::unix::fs::PermissionsExt::from_mode(0o755),
        )
        .expect("chmod back");
        std::fs::remove_dir_all(&dir).expect("cleanup fixture");
    }
}

#[cfg(test)]
mod tests {
    use super::Analysis;

    /// Captured from real `analyze -json` runs: one drilled into a directory,
    /// one of the curated overview.
    const DRILL: &str = include_str!("../../tests/fixtures/analyze-path.json");
    const OVERVIEW: &str = include_str!("../../tests/fixtures/analyze-overview.json");

    #[test]
    fn reads_a_drilled_level_including_its_large_files() {
        let a: Analysis = serde_json::from_str(DRILL).expect("engine output parses");

        assert!(!a.overview);
        assert!(a.path.starts_with('/'));
        assert!(a.total_size > 0, "total size lost");
        assert!(a.total_files > 0, "total_files lost");
        assert!(!a.entries.is_empty());
        assert!(a.entries.iter().any(|e| e.is_dir), "is_dir lost");
        assert!(a.entries.iter().all(|e| !e.name.is_empty()));

        assert_eq!(a.large_files.len(), 3, "large_files lost");
        assert!(a.large_files[0].size > 0);
        assert!(a.large_files[0].path.starts_with('/'));
    }

    /// The overview omits `large_files` and `total_files` entirely, and is the
    /// only mode that sets `insight`.
    #[test]
    fn reads_the_overview_despite_its_missing_fields() {
        let a: Analysis = serde_json::from_str(OVERVIEW).expect("engine output parses");

        assert!(a.overview);
        assert!(a.large_files.is_empty());
        assert_eq!(a.total_files, 0);
        assert!(a.total_size > 0);
        assert!(
            a.entries.iter().any(|e| e.insight),
            "insight flags lost — the overview marks what is worth cleaning"
        );
    }

    #[test]
    fn writes_camel_case_for_the_frontend() {
        let a: Analysis = serde_json::from_str(DRILL).expect("parses");
        let out = serde_json::to_value(&a).expect("serializes");

        assert!(out.get("largeFiles").is_some(), "largeFiles missing");
        assert!(out.get("totalSize").is_some(), "totalSize missing");
        assert!(out.get("totalFiles").is_some(), "totalFiles missing");
        assert!(out["entries"][0].get("isDir").is_some(), "entry.isDir missing");
        assert!(out.get("total_size").is_none(), "snake_case leaked to the frontend");
    }
}
