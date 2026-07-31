//! Filesystem locations the engine reads and writes.
//!
//! These are the engine's own paths, not ours — they are the contract between
//! the GUI and the scripts, so they live in one place.

use std::path::PathBuf;

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn home_dir() -> PathBuf {
    home()
}

/// Detailed file list written by `mole clean --dry-run`.
pub fn clean_preview() -> PathBuf {
    home().join(".config/mole/clean-list.txt")
}

/// Paths the engine must never touch. The only mechanism for excluding items
/// from a cleanup — `--select` / `--exclude` were removed from `mo clean`.
pub fn whitelist() -> PathBuf {
    home().join(".config/mole/whitelist")
}

/// Append-only record of every action, the source of live cleanup progress.
pub fn operations_log() -> PathBuf {
    home().join("Library/Logs/mole/operations.log")
}

/// Our own state, kept apart from the engine's config.
///
/// Needed because a whitelisted path vanishes from the next dry-run entirely.
/// Without remembering what we excluded and how big it was, an unchecked row
/// would disappear with no way to check it again.
pub fn exclusions() -> PathBuf {
    home().join("Library/Application Support/MkCleaner/exclusions.json")
}
