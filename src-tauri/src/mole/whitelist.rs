//! Excluding paths from a cleanup, by editing the engine's whitelist.
//!
//! `mo clean` has no per-item selection — `--select`, `--categories` and
//! `--exclude` were removed. The whitelist file is the only way to keep the
//! engine off a path, so unchecking a row in the UI means writing that path
//! here.
//!
//! The file belongs to the user, who may well have curated it by hand. We
//! therefore confine ourselves to a marked block at the end and never rewrite
//! anything outside it. The engine skips `#` lines, so the markers are inert.

use std::collections::BTreeSet;
use std::fs;

use crate::error::{Error, Result};
use crate::mole::paths;

const BEGIN: &str = "# >>> managed by MkCleaner >>>";
const END: &str = "# <<< managed by MkCleaner <<<";

/// Replaces the managed block with exactly `paths`, leaving the rest untouched.
pub fn set_managed(paths_to_protect: &BTreeSet<String>) -> Result<()> {
    let file = paths::whitelist();
    let existing = fs::read_to_string(&file).unwrap_or_default();
    let mut kept = strip_managed(&existing);

    if !paths_to_protect.is_empty() {
        if !kept.is_empty() && !kept.ends_with('\n') {
            kept.push('\n');
        }
        if !kept.is_empty() {
            kept.push('\n');
        }
        kept.push_str(BEGIN);
        kept.push_str("\n# Paths unchecked in the app. Edit them there, not here.\n");
        for path in paths_to_protect {
            kept.push_str(path);
            kept.push('\n');
        }
        kept.push_str(END);
        kept.push('\n');
    }

    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| Error::io("creating ~/.config/mole", e))?;
    }
    fs::write(&file, kept).map_err(|e| Error::io("writing the whitelist", e))
}

/// The contents of the file with our block removed, normalized to end in a
/// single newline (or empty).
fn strip_managed(contents: &str) -> String {
    let mut out = String::new();
    let mut inside = false;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed == BEGIN {
            inside = true;
            continue;
        }
        if trimmed == END {
            inside = false;
            continue;
        }
        if !inside {
            out.push_str(line);
            out.push('\n');
        }
    }

    // Collapse the blank lines that accumulate where the block used to be.
    while out.ends_with("\n\n") {
        out.pop();
    }
    if out.trim().is_empty() {
        out.clear();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{strip_managed, BEGIN, END};

    #[test]
    fn removes_only_the_managed_block() {
        let file = format!(
            "# my own notes\n/Users/me/Library/Caches/keep-this\n\n{BEGIN}\n/Users/me/tmp\n{END}\n"
        );
        assert_eq!(
            strip_managed(&file),
            "# my own notes\n/Users/me/Library/Caches/keep-this\n"
        );
    }

    #[test]
    fn a_file_without_our_block_is_unchanged() {
        let file = "/Users/me/one\n/Users/me/two\n";
        assert_eq!(strip_managed(file), file);
    }

    #[test]
    fn a_file_that_is_only_our_block_becomes_empty() {
        let file = format!("{BEGIN}\n/Users/me/tmp\n{END}\n");
        assert_eq!(strip_managed(&file), "");
    }
}
