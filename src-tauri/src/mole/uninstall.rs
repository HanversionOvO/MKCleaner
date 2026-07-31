//! Removing applications and the files they leave behind.
//!
//! The riskiest thing this app does, and the one subcommand that ignores the
//! module-wide "stdin is /dev/null" rule. `mo uninstall` has no non-interactive
//! branch: it stops twice regardless of whether stdin is a tty.
//!
//! 1. `Proceed with uninstallation? [y/N]` — a line read. Anything but `y`/`Y`,
//!    including EOF, aborts.
//! 2. `Remove N apps  Enter confirm, ESC cancel` — a single character. Note that
//!    EOF here *confirms*: the empty string falls in the same branch as Enter.
//!
//! Both answers are sent up front, which is safe only because the user has
//! already confirmed the exact file list in the app — `uninstall_preview` runs
//! the identical flow under `--dry-run` and returns what would be deleted.
//!
//! Removals go to the Trash. `--permanent` is deliberately not exposed.

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};
use crate::mole::runner::{self, Engine};
use crate::mole::{apps, oplog, paths, size};

/// Answers both prompts: `y` for the line read, then Enter for the keypress.
const CONFIRM: &str = "y\n\n";

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct RawApp {
    #[serde(default)]
    name: String,
    #[serde(default)]
    bundle_id: String,
    #[serde(default)]
    uninstall_name: String,
    #[serde(default)]
    path: String,
    /// Human-readable, and `--` when the engine could not measure it in time.
    #[serde(default)]
    size: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub name: String,
    pub bundle_id: String,
    /// The exact string `mo uninstall` matches on. Not always the display name.
    pub uninstall_name: String,
    pub path: String,
    /// None when the engine could not measure the app.
    pub bytes: Option<u64>,
}

/// The uninstall script is invoked directly, because the patched `mole`
/// entrypoint refuses the `uninstall` subcommand — the terminal must not
/// reach it, while the app's own uninstall view still needs it.
const UNINSTALL_SCRIPT: &str = "uninstall.sh";

#[tauri::command]
pub async fn uninstall_list(app: AppHandle) -> Result<Vec<App>> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;
        let raw: Vec<RawApp> = engine.capture_bin_json(UNINSTALL_SCRIPT, &["--list"])?;

        let mut apps: Vec<App> = raw
            .into_iter()
            .filter(|a| !a.uninstall_name.is_empty())
            .map(|a| App {
                bytes: size::parse(&a.size),
                name: a.name,
                bundle_id: a.bundle_id,
                uninstall_name: a.uninstall_name,
                path: a.path,
            })
            .collect();

        // Largest first: an uninstaller is usually opened to reclaim space.
        apps.sort_by(|a, b| b.bytes.unwrap_or(0).cmp(&a.bytes.unwrap_or(0)));
        Ok(apps)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[tauri::command]
pub async fn app_icon(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || apps::icon_data_url(&path))
        .await
        .unwrap_or(None)
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removal {
    pub name: String,
    pub bytes: u64,
    pub items: Vec<RemovalItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalItem {
    pub path: String,
    pub bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub apps: Vec<Removal>,
    pub bytes: u64,
}

/// Reads the `Files to be removed:` block out of a dry run.
///
/// ```text
/// Files to be removed:
///
/// ◎ Zotero , 401.1MB
///   ✓ /Applications/Zotero.app , 399.3MB
///   ✓ ~/Library/Application Support/Zotero , 1.8MB
///
/// ➤ Remove 1 app, 401.1MB  Enter confirm, ESC cancel:
/// ```
fn parse_preview(output: &str) -> Preview {
    let mut preview = Preview::default();
    let mut inside = false;

    for line in output.lines() {
        let trimmed = line.trim();

        if !inside {
            inside = trimmed.starts_with("Files to be removed");
            continue;
        }
        // The trailing prompt closes the block.
        if trimmed.starts_with('➤') {
            break;
        }
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("◎ ") {
            let (name, bytes) = split_size(rest);
            preview.apps.push(Removal {
                name: name.to_string(),
                bytes: bytes.unwrap_or(0),
                items: Vec::new(),
            });
        } else if let Some(rest) = trimmed.strip_prefix("✓ ") {
            let (path, bytes) = split_size(rest);
            if path.is_empty() {
                continue;
            }
            if let Some(current) = preview.apps.last_mut() {
                current.items.push(RemovalItem {
                    path: path.to_string(),
                    bytes,
                });
            }
        }
    }

    preview.bytes = preview.apps.iter().map(|a| a.bytes).sum();
    preview
}

/// Splits `text , 1.8MB` into its text and size.
///
/// Only splits when the tail actually parses as a size, so a path that happens
/// to contain ` , ` survives intact.
fn split_size(text: &str) -> (&str, Option<u64>) {
    match text.rfind(" , ") {
        Some(at) => match size::parse(&text[at + 3..]) {
            Some(bytes) => (text[..at].trim_end(), Some(bytes)),
            None => (text.trim_end(), None),
        },
        None => (text.trim_end(), None),
    }
}

#[tauri::command]
pub async fn uninstall_preview(app: AppHandle, names: Vec<String>) -> Result<Preview> {
    tauri::async_runtime::spawn_blocking(move || {
        if names.is_empty() {
            return Ok(Preview::default());
        }
        let engine = Engine::resolve(&app)?;

        let mut args = vec!["--dry-run"];
        args.extend(names.iter().map(String::as_str));

        let mut child = engine.spawn_bin_answering(UNINSTALL_SCRIPT, &args, CONFIRM)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Other("uninstall --dry-run produced no stdout".into()))?;

        let mut text = String::new();
        for line in BufReader::new(stdout).lines().map_while(std::result::Result::ok) {
            text.push_str(&runner::strip_ansi(&line));
            text.push('\n');
        }

        let stderr = runner::drain_stderr(&mut child);
        let status = child
            .wait()
            .map_err(|e| Error::io("waiting for `mole uninstall --dry-run`", e))?;

        if !status.success() {
            return Err(Error::Command {
                args: format!("uninstall --dry-run {}", names.join(" ")),
                status: status.to_string(),
                stderr,
            });
        }

        let preview = parse_preview(&text);
        if preview.apps.is_empty() {
            return Err(Error::Other(
                "引擎没有列出要删除的文件，已中止。".into(),
            ));
        }
        Ok(preview)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    entries: Vec<oplog::Entry>,
    removed: usize,
    failed: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub freed_bytes: u64,
    pub items: usize,
    pub removed: usize,
    pub failed: usize,
}

#[derive(Deserialize)]
struct HistoryFile {
    sessions: Vec<HistorySession>,
}

#[derive(Deserialize)]
struct HistorySession {
    command: String,
    items: u64,
    size: String,
    actions: HistoryActions,
}

#[derive(Deserialize)]
struct HistoryActions {
    removed: u64,
    trashed: u64,
    failed: u64,
}

#[tauri::command]
pub async fn uninstall_run(app: AppHandle, names: Vec<String>) -> Result<Summary> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if names.is_empty() {
            return Err(Error::Other("没有选择要卸载的应用。".into()));
        }
        let engine = Engine::resolve(&handle)?;

        let args: Vec<&str> = names.iter().map(String::as_str).collect();

        let mut tailer = oplog::Tailer::starting_now(paths::operations_log(), "uninstall");
        let mut child = engine.spawn_bin_answering(UNINSTALL_SCRIPT, &args, CONFIRM)?;

        // Drain stdout so a full pipe never stalls the engine mid-removal.
        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                for _ in BufReader::new(stdout).split(b'\n') {}
            });
        }

        let mut totals = Progress {
            entries: Vec::new(),
            removed: 0,
            failed: 0,
        };
        let mut freed: u64 = 0;

        loop {
            let exited = child
                .try_wait()
                .map_err(|e| Error::io("waiting for `mole uninstall`", e))?
                .is_some();

            let mut batch = Vec::new();
            for line in tailer.poll() {
                let oplog::Line::Entry(entry) = line else {
                    continue;
                };
                match entry.action.as_str() {
                    "REMOVED" | "TRASHED" => {
                        totals.removed += 1;
                        freed += entry.bytes.unwrap_or(0);
                    }
                    "FAILED" => totals.failed += 1,
                    _ => {}
                }
                batch.push(entry);
            }

            if !batch.is_empty() {
                let _ = handle.emit(
                    "uninstall://progress",
                    Progress {
                        entries: batch,
                        ..totals.clone()
                    },
                );
            }

            if exited && tailer.poll().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(150));
        }

        let status = child
            .wait()
            .map_err(|e| Error::io("waiting for `mole uninstall`", e))?;
        if !status.success() {
            return Err(Error::Command {
                args: format!("uninstall {}", names.join(" ")),
                status: status.to_string(),
                stderr: runner::drain_stderr(&mut child),
            });
        }

        // The engine's own tally is authoritative; the tailer can miss lines
        // written as the process exits.
        let summary = engine
            .capture_json::<HistoryFile>(&["history", "--json", "--limit", "5"])
            .ok()
            .and_then(|h| h.sessions.into_iter().find(|s| s.command == "uninstall"))
            .map(|s| Summary {
                freed_bytes: size::parse(&s.size).unwrap_or(freed),
                items: s.items as usize,
                removed: (s.actions.removed + s.actions.trashed) as usize,
                failed: s.actions.failed as usize,
            })
            .unwrap_or(Summary {
                freed_bytes: freed,
                items: totals.removed,
                removed: totals.removed,
                failed: totals.failed,
            });

        Ok(summary)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::{parse_preview, split_size};

    /// Captured from `mo uninstall --dry-run Zotero`.
    const DRY_RUN: &str = "\
→ DRY RUN MODE, No app files or settings will be modified

◎ Matched 1 app(s):
1. Zotero  399.3MB  |  Last: 1w ago

Proceed with uninstallation? [y/N]
Files to be removed:

◎ Zotero , 401.1MB
  ✓ /Applications/Zotero.app , 399.3MB
  ✓ ~/Library/Application Support/Zotero , 1.8MB
  ✓ ~/Library/Preferences/org.zotero.zotero.plist , 1KB

➤ Remove 1 app, 401.1MB  Enter confirm, ESC cancel:

======================================================================
Uninstall dry run complete
======================================================================
";

    #[test]
    fn reads_the_file_list_out_of_a_dry_run() {
        let preview = parse_preview(DRY_RUN);

        assert_eq!(preview.apps.len(), 1);
        let zotero = &preview.apps[0];
        assert_eq!(zotero.name, "Zotero");
        assert_eq!(zotero.bytes, 420583834);
        assert_eq!(zotero.items.len(), 3);
        assert_eq!(zotero.items[0].path, "/Applications/Zotero.app");
        assert_eq!(zotero.items[2].path, "~/Library/Preferences/org.zotero.zotero.plist");
        assert_eq!(zotero.items[2].bytes, Some(1024));
        assert_eq!(preview.bytes, 420583834);
    }

    /// The `◎ Matched N app(s):` header appears before the block and must not
    /// be mistaken for an app entry.
    #[test]
    fn ignores_everything_before_the_file_list() {
        let preview = parse_preview(DRY_RUN);
        assert!(
            !preview.apps.iter().any(|a| a.name.starts_with("Matched")),
            "picked up the match header as an app"
        );
    }

    /// Seen on an app whose only file is the bundle itself.
    #[test]
    fn handles_entries_with_no_size() {
        let preview = parse_preview(
            "Files to be removed:\n\n◎ Claude Code URL Handler , 0B\n  ✓ ~/Applications/Claude Code URL Handler.app\n\n➤ Remove 1 app",
        );
        assert_eq!(preview.apps.len(), 1);
        assert_eq!(preview.apps[0].items.len(), 1);
        assert_eq!(preview.apps[0].items[0].bytes, None);
        assert_eq!(
            preview.apps[0].items[0].path,
            "~/Applications/Claude Code URL Handler.app"
        );
    }

    #[test]
    fn keeps_a_path_that_contains_the_size_separator() {
        let (path, bytes) = split_size("/Users/x/Odd , Name/thing , 2KB");
        assert_eq!(path, "/Users/x/Odd , Name/thing");
        assert_eq!(bytes, Some(2048));

        let (path, bytes) = split_size("/Users/x/Odd , Name");
        assert_eq!(path, "/Users/x/Odd , Name");
        assert_eq!(bytes, None);
    }

    #[test]
    fn a_run_that_listed_nothing_yields_no_apps() {
        assert!(parse_preview("Aborted.").apps.is_empty());
        assert!(parse_preview("").apps.is_empty());
    }
}
