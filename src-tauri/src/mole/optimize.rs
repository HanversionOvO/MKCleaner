//! System optimization via `mole optimize`.
//!
//! Unlike `clean` there is no dry-run file and no per-item selection: the
//! engine runs a fixed catalogue of maintenance steps (DNS cache, Launch
//! Services, Dock, Spotlight, memory…). The UI is a checklist — the engine's
//! own `➤ Section` / `→ detail` output streaming in — rather than a chooser.
//!
//! A real run may need admin for some steps: `ensure_sudo_session` falls back
//! to a native password dialog when stdin is not a tty, so the engine handles
//! that itself, exactly as it does in a terminal.

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{Error, Result};
use crate::mole::runner::{self, Engine};
use crate::mole::size;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeItem {
    pub title: String,
    /// The raw detail lines under the section, symbols included — `✓` when
    /// done, `→` for the next action.
    pub details: Vec<String>,
}

/// Splits the engine's output into its section blocks: `➤ Title` headers over
/// indented detail lines.
pub fn parse_output(text: &str) -> Vec<OptimizeItem> {
    let mut items: Vec<OptimizeItem> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("➤ ") {
            items.push(OptimizeItem {
                title: title.to_string(),
                details: Vec::new(),
            });
        } else if trimmed.starts_with("→ ") || trimmed.starts_with("✓ ") {
            if let Some(current) = items.last_mut() {
                current.details.push(trimmed.to_string());
            }
        }
    }
    items
}

#[tauri::command]
pub async fn optimize_scan(app: AppHandle) -> Result<Vec<OptimizeItem>> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;
        let mut child = engine.spawn(&["optimize", "--dry-run"])?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Other("optimize --dry-run produced no stdout".into()))?;

        // Stream the sections as the engine reaches them, so the scan reads as
        // a list filling in rather than a blank wait.
        let mut items: Vec<OptimizeItem> = Vec::new();
        for line in BufReader::new(stdout).lines().map_while(std::result::Result::ok) {
            let clean = runner::strip_ansi(&line);
            let trimmed = clean.trim();
            if let Some(title) = trimmed.strip_prefix("➤ ") {
                items.push(OptimizeItem {
                    title: title.to_string(),
                    details: Vec::new(),
                });
                let _ = app.emit(
                    "optimize://scanning",
                    OptimizeItem {
                        title: title.to_string(),
                        details: Vec::new(),
                    },
                );
            } else if trimmed.starts_with("→ ") || trimmed.starts_with("✓ ") {
                if let Some(current) = items.last_mut() {
                    current.details.push(trimmed.to_string());
                }
            }
        }

        let stderr = runner::drain_stderr(&mut child);
        let status = child
            .wait()
            .map_err(|e| Error::io("waiting for `mole optimize --dry-run`", e))?;
        if !status.success() {
            return Err(Error::Command {
                args: "optimize --dry-run".into(),
                status: status.to_string(),
                stderr,
            });
        }

        Ok(items)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

/// One line of the running optimization.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    title: String,
    detail: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HistoryFile {
    sessions: Vec<HistorySession>,
}

#[derive(Debug, Deserialize)]
struct HistorySession {
    command: String,
    items: u64,
    size: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeSummary {
    pub items: u64,
    pub bytes: u64,
}

#[tauri::command]
pub async fn optimize_run(app: AppHandle) -> Result<OptimizeSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;
        let mut child = engine.spawn(&["optimize"])?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Other("optimize produced no stdout".into()))?;

        let mut current: Option<String> = None;
        for line in BufReader::new(stdout).lines().map_while(std::result::Result::ok) {
            let clean = runner::strip_ansi(&line);
            let trimmed = clean.trim();
            if let Some(title) = trimmed.strip_prefix("➤ ") {
                current = Some(title.to_string());
                let _ = app.emit(
                    "optimize://progress",
                    Progress {
                        title: title.to_string(),
                        detail: None,
                    },
                );
            } else if trimmed.starts_with("→ ") || trimmed.starts_with("✓ ") {
                if let Some(title) = &current {
                    let _ = app.emit(
                        "optimize://progress",
                        Progress {
                            title: title.clone(),
                            detail: Some(trimmed.to_string()),
                        },
                    );
                }
            }
        }

        let stderr = runner::drain_stderr(&mut child);
        let status = child
            .wait()
            .map_err(|e| Error::io("waiting for `mole optimize`", e))?;
        if !status.success() {
            return Err(Error::Command {
                args: "optimize".into(),
                status: status.to_string(),
                stderr,
            });
        }

        // The engine's own tally is authoritative.
        let summary = engine
            .capture_json::<HistoryFile>(&["history", "--json", "--limit", "5"])
            .ok()
            .and_then(|h| h.sessions.into_iter().find(|s| s.command == "optimize"))
            .map(|s| OptimizeSummary {
                items: s.items,
                bytes: size::parse(&s.size).unwrap_or(0),
            })
            .unwrap_or(OptimizeSummary { items: 0, bytes: 0 });

        Ok(summary)
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::parse_output;

    /// Captured from a real `mole optimize --dry-run` run.
    const DRY_RUN: &str = "\
Optimize
→ DRY RUN MODE, No files will be modified

⚙ System 9/16 GB RAM | 133/228 GB Disk | Uptime 0d

PERFORMANCE DIAGNOSIS
  ✓ No sustained high-CPU bottleneck detected

➤ DNS & Spotlight Check
  → DNS cache flushed
  → Spotlight index verified

➤ Finder Cache Refresh
  → QuickLook thumbnails refreshed
  → Icon services cache rebuilt

======================================================================
Dry Run Complete, No Changes Made
Would apply 23 optimizations
======================================================================
";

    #[test]
    fn reads_the_section_blocks() {
        let items = parse_output(DRY_RUN);
        assert_eq!(items.len(), 2, "diagnosis block is not a section");
        assert_eq!(items[0].title, "DNS & Spotlight Check");
        assert_eq!(items[0].details.len(), 2);
        assert_eq!(items[1].title, "Finder Cache Refresh");
    }

    #[test]
    fn ignores_noise_lines() {
        let items = parse_output(DRY_RUN);
        assert!(
            !items.iter().any(|i| i.title.contains("Dry Run Complete")),
            "the summary banner must not become a section"
        );
        assert!(
            !items.iter().any(|i| i.details.iter().any(|d| d.contains("high-CPU"))),
            "diagnosis lines must not attach to sections"
        );
    }
}
