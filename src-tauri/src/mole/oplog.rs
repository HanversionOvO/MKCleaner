//! Live cleanup progress, read from the engine's operation log.
//!
//! `mo clean` prints a terminal UI, not a machine-readable stream, but it also
//! appends one line per action to `~/Library/Logs/mole/operations.log`:
//!
//! ```text
//! [2026-07-30 13:06:03] [clean] REMOVED /path/to/file (1.1MB)
//! [2026-07-30 13:06:23] [clean] SKIPPED /path (protected)
//! # ========== clean session ended at 2026-07-30 13:06:25, 237 items, 839.7MB ==========
//! ```
//!
//! Tailing that from the offset the log had when we spawned the process gives
//! exact progress without parsing any terminal output.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::mole::size;

static ENTRY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\[[^\]]+\]\s+\[(?P<command>[^\]]+)\]\s+(?P<action>[A-Z]+)\s+(?P<rest>.+)$")
        .expect("static log pattern is valid")
});

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// REMOVED, TRASHED, SKIPPED, FAILED, REBUILT…
    pub action: String,
    pub path: String,
    /// Bytes for actions that freed space.
    pub bytes: Option<u64>,
    /// Why, for actions that did not: `protected`, `whitelist`.
    pub reason: Option<String>,
}

/// A line the engine writes when a session finishes.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionEnd {
    pub command: String,
}

#[derive(Debug, PartialEq)]
pub enum Line {
    Entry(Entry),
    SessionEnd(SessionEnd),
}

/// Parses one log line, ignoring anything that is not an action or a session end.
pub fn parse_line(line: &str, want_command: &str) -> Option<Line> {
    let line = line.trim_end();

    if line.starts_with('#') {
        let end = line.find(" session ended at")?;
        let command = line[..end].rsplit(' ').next()?.to_string();
        return (command == want_command).then_some(Line::SessionEnd(SessionEnd { command }));
    }

    let caps = ENTRY.captures(line)?;
    if &caps["command"] != want_command {
        return None;
    }

    let action = caps["action"].to_string();
    let rest = caps["rest"].trim();

    // The trailing parenthetical is a size for REMOVED and a reason for SKIPPED.
    // Paths may themselves contain parentheses, so split on the last one and only
    // when the line actually ends with `)`.
    let (path, note) = match (rest.ends_with(')'), rest.rfind(" (")) {
        (true, Some(at)) => (&rest[..at], Some(&rest[at + 2..rest.len() - 1])),
        _ => (rest, None),
    };

    let bytes = note.and_then(size::parse);
    Some(Line::Entry(Entry {
        action,
        path: path.to_string(),
        // A note that did not parse as a size is a reason.
        reason: match (bytes, note) {
            (None, Some(n)) => Some(n.to_string()),
            _ => None,
        },
        bytes,
    }))
}

/// Follows the log from wherever it was when the tailer was created.
pub struct Tailer {
    file: PathBuf,
    offset: u64,
    command: String,
}

impl Tailer {
    /// Anchors at the log's current end, so we only ever report our own run.
    pub fn starting_now(file: PathBuf, command: impl Into<String>) -> Self {
        let offset = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        Tailer {
            file,
            offset,
            command: command.into(),
        }
    }

    /// Returns every complete line appended since the last poll. A trailing
    /// partial line is left for the next call so a half-written entry is never
    /// parsed.
    pub fn poll(&mut self) -> Vec<Line> {
        let Ok(mut file) = File::open(&self.file) else {
            return Vec::new();
        };
        let Ok(len) = file.metadata().map(|m| m.len()) else {
            return Vec::new();
        };

        // The engine rotates the log when it gets large; restart from the top.
        if len < self.offset {
            self.offset = 0;
        }
        if len == self.offset {
            return Vec::new();
        }

        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return Vec::new();
        }
        let mut buf = Vec::new();
        if file.read_to_end(&mut buf).is_err() {
            return Vec::new();
        }

        let Some(last_newline) = buf.iter().rposition(|b| *b == b'\n') else {
            return Vec::new();
        };
        self.offset += last_newline as u64 + 1;

        String::from_utf8_lossy(&buf[..last_newline])
            .lines()
            .filter_map(|l| parse_line(l, &self.command))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_line, Line};

    fn entry(line: &str) -> Option<super::Entry> {
        match parse_line(line, "clean") {
            Some(Line::Entry(e)) => Some(e),
            _ => None,
        }
    }

    #[test]
    fn reads_a_removal_with_its_size() {
        let e = entry("[2026-07-30 13:06:03] [clean] REMOVED /Users/x/Library/Caches/data_2 (1.1MB)")
            .expect("parses");
        assert_eq!(e.action, "REMOVED");
        assert_eq!(e.path, "/Users/x/Library/Caches/data_2");
        assert_eq!(e.bytes, Some(1153434));
        assert_eq!(e.reason, None);
    }

    #[test]
    fn reads_a_skip_with_its_reason() {
        let e = entry("[2026-07-30 13:06:23] [clean] SKIPPED /Users/x/Library/Caches/y (protected)")
            .expect("parses");
        assert_eq!(e.action, "SKIPPED");
        assert_eq!(e.reason.as_deref(), Some("protected"));
        assert_eq!(e.bytes, None);
    }

    #[test]
    fn keeps_parentheses_that_belong_to_the_path() {
        let e = entry("[2026-07-30 13:06:03] [clean] REMOVED /Users/x/My App (old)/cache (2KB)")
            .expect("parses");
        assert_eq!(e.path, "/Users/x/My App (old)/cache");
        assert_eq!(e.bytes, Some(2048));
    }

    #[test]
    fn ignores_other_commands_sharing_the_log() {
        assert!(entry("[2026-07-31 15:54:25] [uninstall] REMOVED /Applications/X.app (1MB)").is_none());
    }

    #[test]
    fn recognises_the_end_of_our_session_only() {
        assert!(matches!(
            parse_line(
                "# ========== clean session ended at 2026-07-30 13:06:25, 237 items, 839.7MB ==========",
                "clean"
            ),
            Some(Line::SessionEnd(_))
        ));
        assert!(parse_line(
            "# ========== uninstall session ended at 2026-07-31 15:54:25, 0 items, 0B ==========",
            "clean"
        )
        .is_none());
    }
}
