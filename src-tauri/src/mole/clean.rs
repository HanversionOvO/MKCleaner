//! The cleanup flow: scan, choose, run.
//!
//! `mo clean` is the one subcommand with no JSON mode, so this module works from
//! the two artefacts it does produce — the dry-run's detailed file list, and the
//! operation log it appends to while running.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};
use crate::mole::runner::{self, Engine};
use crate::mole::{oplog, paths, size};

/// One path the engine offered to delete.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub path: String,
    pub bytes: u64,
    /// Unchecked in the UI, so whitelisted and skipped by the engine.
    pub excluded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub name: String,
    pub items: Vec<Item>,
    /// Bytes that would actually be freed — excluded items do not count.
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub categories: Vec<Category>,
    pub bytes: u64,
    pub item_count: usize,
    pub excluded_bytes: u64,
    pub excluded_count: usize,
    pub home: String,
}

/// What we remember about a path the user unchecked.
///
/// A whitelisted path is absent from the next dry-run, so without this the row
/// would vanish and could never be checked again.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exclusion {
    pub path: String,
    pub category: String,
    pub bytes: u64,
}

/// Progress event while `mo clean` runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    entries: Vec<oplog::Entry>,
    /// Running totals, so the UI never has to accumulate them itself.
    freed_bytes: u64,
    removed: usize,
    skipped: usize,
    failed: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub freed_bytes: u64,
    pub items: usize,
    pub removed: usize,
    pub skipped: usize,
    pub failed: usize,
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/// Splits the dry-run preview into categories.
///
/// The file is `=== Category ===` headers over `path  # size` lines, with `#`
/// comments at the top. Every entry line carries a size.
fn parse_preview(contents: &str) -> Vec<(String, Vec<(String, u64)>)> {
    let mut out: Vec<(String, Vec<(String, u64)>)> = Vec::new();

    for line in contents.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }

        if let Some(name) = line
            .strip_prefix("=== ")
            .and_then(|l| l.strip_suffix(" ==="))
        {
            out.push((name.to_string(), Vec::new()));
            continue;
        }

        // Split on the last `  # `, so a path containing `#` still parses.
        let Some(at) = line.rfind("  # ") else { continue };
        let path = line[..at].trim();
        let Some(bytes) = size::parse(&line[at + 4..]) else {
            continue;
        };
        if path.is_empty() {
            continue;
        }

        if out.is_empty() {
            out.push((String::from("其他"), Vec::new()));
        }
        out.last_mut()
            .expect("just ensured non-empty")
            .1
            .push((path.to_string(), bytes));
    }

    out
}

/// Runs a dry run, reporting each section the engine enters.
fn dry_run(app: &AppHandle, engine: &Engine) -> Result<()> {
    let mut child = engine.spawn(&["clean", "--dry-run"])?;

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(std::result::Result::ok) {
            // Section headers look like `➤ Browsers`. They are the only progress
            // signal a dry run gives, and they make the wait legible.
            let clean = runner::strip_ansi(&line);
            if let Some(section) = clean.trim().strip_prefix("➤ ") {
                let _ = app.emit("clean://scanning", section.trim());
            }
        }
    }

    let stderr = runner::drain_stderr(&mut child);
    let status = child
        .wait()
        .map_err(|e| Error::io("waiting for `mole clean --dry-run`", e))?;

    if !status.success() {
        return Err(Error::Command {
            args: "clean --dry-run".into(),
            status: status.to_string(),
            stderr,
        });
    }
    Ok(())
}

fn read_exclusions() -> BTreeMap<String, Exclusion> {
    let Ok(raw) = std::fs::read_to_string(paths::exclusions()) else {
        return BTreeMap::new();
    };
    serde_json::from_str::<Vec<Exclusion>>(&raw)
        .map(|list| list.into_iter().map(|e| (e.path.clone(), e)).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn clean_scan(app: AppHandle) -> Result<Scan> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&handle)?;
        dry_run(&handle, &engine)?;

        let contents = std::fs::read_to_string(paths::clean_preview())
            .map_err(|e| Error::io("reading the dry-run file list", e))?;

        let excluded = read_exclusions();
        let mut categories: Vec<Category> = Vec::new();

        for (name, entries) in parse_preview(&contents) {
            let items: Vec<Item> = entries
                .into_iter()
                .map(|(path, bytes)| Item {
                    path,
                    bytes,
                    excluded: false,
                })
                .collect();
            categories.push(Category {
                bytes: items.iter().map(|i| i.bytes).sum(),
                name,
                items,
            });
        }

        // Fold the remembered exclusions back in, so they stay visible and can
        // be re-checked.
        for exclusion in excluded.values() {
            let item = Item {
                path: exclusion.path.clone(),
                bytes: exclusion.bytes,
                excluded: true,
            };
            match categories.iter_mut().find(|c| c.name == exclusion.category) {
                Some(category) => category.items.push(item),
                None => categories.push(Category {
                    name: exclusion.category.clone(),
                    items: vec![item],
                    bytes: 0,
                }),
            }
        }

        for category in &mut categories {
            category
                .items
                .sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.path.cmp(&b.path)));
        }
        categories.retain(|c| !c.items.is_empty());
        categories.sort_by(|a, b| b.bytes.cmp(&a.bytes));

        let bytes = categories.iter().map(|c| c.bytes).sum();
        let item_count = categories
            .iter()
            .flat_map(|c| &c.items)
            .filter(|i| !i.excluded)
            .count();

        Ok(Scan {
            categories,
            bytes,
            item_count,
            excluded_bytes: excluded.values().map(|e| e.bytes).sum(),
            excluded_count: excluded.len(),
            home: paths::home_dir().display().to_string(),
        })
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

/// Records the full set of unchecked paths, in our state and in the engine's
/// whitelist. Taking the whole set (rather than one toggle) keeps the two files
/// in step even if an event is missed.
#[tauri::command]
pub async fn clean_set_exclusions(items: Vec<Exclusion>) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = paths::exclusions();
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| Error::io("creating the app support directory", e))?;
        }
        let json = serde_json::to_string_pretty(&items)
            .map_err(|e| Error::Other(format!("encoding exclusions: {e}")))?;
        std::fs::write(&file, json).map_err(|e| Error::io("writing exclusions", e))?;

        let protect: BTreeSet<String> = items.into_iter().map(|e| e.path).collect();
        crate::mole::whitelist::set_managed(&protect)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HistoryFile {
    sessions: Vec<HistorySession>,
}

#[derive(Deserialize)]
struct HistorySession {
    command: String,
    started_at: String,
    items: u64,
    size: String,
    actions: HistoryActions,
}

/// One past cleanup session, for the "最近清理" block under the scan card.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub command: String,
    pub started_at: String,
    pub items: u64,
    pub bytes: u64,
}

#[tauri::command]
pub async fn clean_history(app: AppHandle) -> Result<Vec<HistoryEntry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;
        let history: HistoryFile = engine.capture_json(&["history", "--json", "--limit", "10"])?;
        Ok(history
            .sessions
            .into_iter()
            .filter(|s| s.command == "clean" || s.command == "uninstall")
            .map(|s| HistoryEntry {
                command: s.command,
                started_at: s.started_at,
                items: s.items,
                bytes: size::parse(&s.size).unwrap_or(0),
            })
            .collect())
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[derive(Deserialize)]
struct HistoryActions {
    removed: u64,
    trashed: u64,
    skipped: u64,
    failed: u64,
}

/// The engine's own tally of the run that just finished. Authoritative — our
/// tailer can miss the last lines if the process exits mid-write.
fn summary_from_history(engine: &Engine) -> Option<Summary> {
    let history: HistoryFile = engine
        .capture_json(&["history", "--json", "--limit", "5"])
        .ok()?;
    let session = history.sessions.into_iter().find(|s| s.command == "clean")?;
    Some(Summary {
        freed_bytes: size::parse(&session.size).unwrap_or(0),
        items: session.items as usize,
        removed: (session.actions.removed + session.actions.trashed) as usize,
        skipped: session.actions.skipped as usize,
        failed: session.actions.failed as usize,
    })
}

#[tauri::command]
pub async fn clean_run(app: AppHandle) -> Result<Summary> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&handle)?;

        // Anchor the tailer before spawning, so we see every line this run
        // writes and none of the previous run's.
        let mut tailer = oplog::Tailer::starting_now(paths::operations_log(), "clean");
        let mut child = engine.spawn(&["clean"])?;

        // The engine writes its terminal UI to stdout. We do not parse it, but it
        // must be drained or the pipe fills and the process blocks.
        let finished = Arc::new(AtomicBool::new(false));
        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                for _ in BufReader::new(stdout).split(b'\n') {}
            });
        }

        let mut totals = Progress {
            entries: Vec::new(),
            freed_bytes: 0,
            removed: 0,
            skipped: 0,
            failed: 0,
        };

        loop {
            let exited = child
                .try_wait()
                .map_err(|e| Error::io("waiting for `mole clean`", e))?
                .is_some();

            let lines = tailer.poll();
            let mut batch = Vec::new();
            for line in lines {
                let oplog::Line::Entry(entry) = line else {
                    // Session-end tells us the engine is done writing; the
                    // process exit is what actually ends the loop.
                    finished.store(true, Ordering::Relaxed);
                    continue;
                };
                match entry.action.as_str() {
                    "REMOVED" | "TRASHED" => {
                        totals.removed += 1;
                        totals.freed_bytes += entry.bytes.unwrap_or(0);
                    }
                    "SKIPPED" => totals.skipped += 1,
                    "FAILED" => totals.failed += 1,
                    _ => {}
                }
                batch.push(entry);
            }

            if !batch.is_empty() {
                let _ = app.emit(
                    "clean://progress",
                    Progress {
                        entries: batch,
                        ..totals.clone()
                    },
                );
            }

            // One more poll after exit, to pick up lines written just before it.
            if exited {
                if finished.load(Ordering::Relaxed) || tailer.poll().is_empty() {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(180));
        }

        let status = child
            .wait()
            .map_err(|e| Error::io("waiting for `mole clean`", e))?;
        if !status.success() {
            return Err(Error::Command {
                args: "clean".into(),
                status: status.to_string(),
                stderr: runner::drain_stderr(&mut child),
            });
        }

        Ok(summary_from_history(&engine).unwrap_or(Summary {
            freed_bytes: totals.freed_bytes,
            items: totals.removed,
            removed: totals.removed,
            skipped: totals.skipped,
            failed: totals.failed,
        }))
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::parse_preview;

    const SAMPLE: &str = "\
# Mole Cleanup Preview - 2026-07-31 15:59:18
#
# How to protect files:
# 1. Copy any path below to ~/.config/mole/whitelist


=== User essentials ===
/Users/x/Library/Caches/bun  # 38.6MB
/Users/x/Library/Caches/Microsoft Edge  # 1.42GB

=== Browsers ===
/Users/x/Library/Caches/familycircled  # 0B
";

    #[test]
    fn splits_into_categories_with_sizes() {
        let parsed = parse_preview(SAMPLE);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].0, "User essentials");
        assert_eq!(parsed[0].1.len(), 2);
        assert_eq!(
            parsed[0].1[1],
            ("/Users/x/Library/Caches/Microsoft Edge".into(), 1524713390)
        );
        assert_eq!(parsed[1].0, "Browsers");
        assert_eq!(parsed[1].1[0].1, 0);
    }

    #[test]
    fn ignores_the_header_comments() {
        assert!(parse_preview("# only comments\n#\n").is_empty());
    }

    /// Parses the dry-run file this machine actually has, if there is one.
    ///
    /// The unit tests above use a fixture, which only proves the parser matches
    /// what I believed the format to be. This checks it against real engine
    /// output: every non-comment line must survive, and no size may be lost.
    ///
    /// A freshly cleaned machine legitimately has nothing left to list, so the
    /// size check only applies when there are entries to check.
    #[test]
    fn agrees_with_a_real_dry_run() {
        let file = crate::mole::paths::clean_preview();
        let Ok(contents) = std::fs::read_to_string(&file) else {
            eprintln!("skipped: no dry run at {}", file.display());
            return;
        };

        let expected_entries = contents
            .lines()
            .filter(|l| {
                let t = l.trim();
                !t.is_empty() && !t.starts_with('#') && !t.starts_with("===")
            })
            .count();
        let expected_categories = contents
            .lines()
            .filter(|l| l.trim_start().starts_with("=== "))
            .count();

        let parsed = parse_preview(&contents);
        assert_eq!(parsed.len(), expected_categories, "lost a category");

        let entries: Vec<_> = parsed.iter().flat_map(|(_, items)| items).collect();
        assert_eq!(entries.len(), expected_entries, "lost an entry");

        if entries.is_empty() {
            eprintln!("note: nothing left to clean on this machine, sizes not exercised");
            return;
        }
        assert!(
            entries.iter().any(|(_, bytes)| *bytes > 0),
            "every size parsed as zero across {} entries",
            entries.len()
        );
    }
}
