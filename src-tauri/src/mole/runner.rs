//! Locating and invoking the bundled Mole engine.
//!
//! Two rules govern every process we spawn here:
//!
//! 1. **stdin is always `/dev/null`.** `clean.sh` branches on `[[ -t 0 ]]`: with a
//!    tty it stops on blocking keypress prompts ("Enter continue, Space skip"),
//!    without one it prints "Running in non-interactive mode" and runs straight
//!    through. Never hand the engine a pty.
//! 2. **stdout is ANSI-stripped before parsing.** The engine targets a terminal
//!    and colours everything, including lines we read back.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::LazyLock;

use regex::Regex;
use serde::de::DeserializeOwned;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// Override for the engine location. Lets `cargo test` and one-off debugging run
/// against a checkout without going through a bundled .app.
const ENGINE_DIR_ENV: &str = "MKCLEANER_MOLE_DIR";

static ANSI: LazyLock<Regex> = LazyLock::new(|| {
    // CSI sequences (colour, cursor moves, line erase) plus OSC strings.
    Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
        .expect("static ANSI pattern is valid")
});

/// Removes terminal escape sequences, then resolves carriage returns so a line
/// the engine redrew in place reads as its final state rather than a pile-up.
pub fn strip_ansi(input: &str) -> String {
    let cleaned = ANSI.replace_all(input, "");
    cleaned
        .split('\n')
        .map(|line| line.rsplit('\r').next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone)]
pub struct Engine {
    dir: PathBuf,
}

impl Engine {
    /// Resolves the engine directory and makes sure it can actually be run.
    pub fn resolve(app: &AppHandle) -> Result<Engine> {
        let dir = engine_dir(app)?;
        let entry = dir.join("mole");
        if !entry.is_file() {
            return Err(Error::EngineMissing(entry.display().to_string()));
        }
        ensure_executable(&dir)?;
        Ok(Engine { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The engine version we vendored, from the stamp `vendor-mole.sh` writes.
    /// Falls back to asking the binary if the stamp is missing.
    pub fn version(&self) -> Result<String> {
        if let Ok(stamp) = std::fs::read_to_string(self.dir.join("VERSION")) {
            let stamp = stamp.trim();
            if !stamp.is_empty() {
                return Ok(stamp.to_string());
            }
        }
        let out = self.capture(&["--version"])?;
        Ok(out
            .lines()
            .find_map(|l| l.strip_prefix("Mole version "))
            .unwrap_or("unknown")
            .trim()
            .to_string())
    }

    /// A `Command` with the engine's environment pinned down. Callers set up
    /// stdout/stderr themselves; stdin is already `/dev/null` (see module docs).
    pub fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(self.dir.join("mole"));
        cmd.args(args);
        Self::configure(&mut cmd, &self.dir);
        cmd
    }

    /// A `Command` that runs one of the engine's bin scripts directly,
    /// bypassing the `mole` entrypoint's dispatch.
    ///
    /// The patched entrypoint refuses `uninstall` so the terminal cannot reach
    /// it, but the app's own uninstall view still needs the script.
    pub fn command_bin(&self, script: &str, args: &[&str]) -> Command {
        let mut cmd = Command::new(self.dir.join("bin").join(script));
        cmd.args(args);
        Self::configure(&mut cmd, &self.dir);
        cmd
    }

    fn configure(cmd: &mut Command, dir: &Path) {
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // A GUI process starts with a minimal PATH; the engine shells out to
        // plenty of system tools and to its own helpers under bin/.
        cmd.env(
            "PATH",
            format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", dir.join("bin").display()),
        );
        // Debug output interleaves diagnostics into the streams we parse.
        cmd.env_remove("MO_DEBUG");
        cmd.env_remove("MOLE_TEST_MODE");
        cmd.env_remove("MOLE_TEST_NO_AUTH");
    }

    /// Runs to completion, returning ANSI-stripped stdout and stderr.
    fn run(&self, args: &[&str]) -> Result<(String, String)> {
        let output = self
            .command(args)
            .output()
            .map_err(|e| Error::io(format!("spawning `mole {}`", args.join(" ")), e))?;

        let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout));
        let stderr = strip_ansi(&String::from_utf8_lossy(&output.stderr))
            .trim()
            .to_string();

        if !output.status.success() {
            return Err(Error::Command {
                args: args.join(" "),
                status: output.status.to_string(),
                stderr,
            });
        }

        Ok((stdout, stderr))
    }

    /// Runs to completion and returns ANSI-stripped stdout.
    pub fn capture(&self, args: &[&str]) -> Result<String> {
        self.run(args).map(|(stdout, _)| stdout)
    }

    /// `capture`, for a bin script run directly — see [`Self::command_bin`].
    pub fn capture_bin(&self, script: &str, args: &[&str]) -> Result<String> {
        let output = self
            .command_bin(script, args)
            .output()
            .map_err(|e| Error::io(format!("spawning `{script}`"), e))?;
        if !output.status.success() {
            return Err(Error::Command {
                args: format!("{script} {}", args.join(" ")),
                status: output.status.to_string(),
                stderr: strip_ansi(&String::from_utf8_lossy(&output.stderr))
                    .trim()
                    .to_string(),
            });
        }
        Ok(strip_ansi(&String::from_utf8_lossy(&output.stdout)))
    }

    /// Runs a subcommand that speaks JSON natively (`analyze`, `status`,
    /// `history`, `uninstall --list`) and deserializes its stdout.
    ///
    /// Some subcommands report failure by writing to stderr and still exiting
    /// zero — `analyze` does this for an unreadable path. Empty stdout is
    /// therefore treated as a failure so the real message survives instead of
    /// becoming "expected value at line 1 column 1".
    pub fn capture_json<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T> {
        let (stdout, stderr) = self.run(args)?;

        if stdout.trim().is_empty() {
            return Err(Error::Command {
                args: args.join(" "),
                status: "no output".into(),
                stderr: if stderr.is_empty() {
                    "the engine produced nothing".into()
                } else {
                    stderr
                },
            });
        }

        serde_json::from_str(&stdout).map_err(|source| Error::Json {
            args: args.join(" "),
            source,
        })
    }

    /// `capture_json`, for a bin script run directly — used by the uninstall
    /// view, whose subcommand the patched entrypoint refuses.
    pub fn capture_bin_json<T: DeserializeOwned>(&self, script: &str, args: &[&str]) -> Result<T> {
        let stdout = self.capture_bin(script, args)?;
        if stdout.trim().is_empty() {
            return Err(Error::Command {
                args: format!("{script} {}", args.join(" ")),
                status: "no output".into(),
                stderr: "the engine produced nothing".into(),
            });
        }
        serde_json::from_str(&stdout).map_err(|source| Error::Json {
            args: format!("{script} {}", args.join(" ")),
            source,
        })
    }

    /// Spawns a long-running subcommand for line-by-line streaming.
    pub fn spawn(&self, args: &[&str]) -> Result<Child> {
        self.command(args)
            .spawn()
            .map_err(|e| Error::io(format!("spawning `mole {}`", args.join(" ")), e))
    }

    /// `spawn`, for a bin script run directly.
    pub fn spawn_bin(&self, script: &str, args: &[&str]) -> Result<Child> {
        self.command_bin(script, args)
            .spawn()
            .map_err(|e| Error::io(format!("spawning `{script}`"), e))
    }

    /// Spawns a subcommand that stops for confirmation, answering it up front.
    ///
    /// `uninstall` is the exception to the module's first rule: it has no
    /// non-interactive branch and stops at two prompts regardless of whether
    /// stdin is a tty. Both are answered here, from a decision the user already
    /// made in the app — see `uninstall::CONFIRM`.
    pub fn spawn_answering(&self, args: &[&str], answers: &str) -> Result<Child> {
        let mut child = self
            .command(args)
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| Error::io(format!("spawning `mole {}`", args.join(" ")), e))?;

        if let Some(mut stdin) = child.stdin.take() {
            // Dropping the handle closes the pipe, so any prompt beyond the
            // ones answered here reads EOF rather than hanging.
            let _ = stdin.write_all(answers.as_bytes());
        }

        Ok(child)
    }

    /// `spawn_answering`, for a bin script run directly.
    pub fn spawn_bin_answering(&self, script: &str, args: &[&str], answers: &str) -> Result<Child> {
        let mut child = self
            .command_bin(script, args)
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| Error::io(format!("spawning `{script}`"), e))?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(answers.as_bytes());
        }

        Ok(child)
    }
}

/// Where the engine lives: explicit override, then the bundled resource
/// directory, then the vendored tree next to the crate for `cargo test`.
fn engine_dir(app: &AppHandle) -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os(ENGINE_DIR_ENV) {
        return Ok(PathBuf::from(dir));
    }

    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("mole");
        if bundled.join("mole").is_file() {
            return Ok(bundled);
        }
    }

    let vendored = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/mole");
    if vendored.join("mole").is_file() {
        return Ok(vendored);
    }

    Err(Error::EngineMissing(
        "no engine in the app bundle or in src-tauri/resources/mole (run pnpm vendor:mole)".into(),
    ))
}

/// Restores the execute bit on the entrypoint and the Go helpers.
///
/// Resource copying does not reliably preserve mode bits, and a missing execute
/// bit surfaces as a bare "permission denied" much later. Fixing it here keeps
/// the failure at startup, where it is diagnosable.
fn ensure_executable(dir: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut targets = vec![dir.join("mole")];
    if let Ok(entries) = std::fs::read_dir(dir.join("bin")) {
        targets.extend(entries.flatten().map(|e| e.path()));
    }

    for path in targets {
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() || meta.permissions().mode() & 0o111 != 0 {
            continue;
        }
        let mut perms = meta.permissions();
        perms.set_mode(perms.mode() | 0o755);
        std::fs::set_permissions(&path, perms)
            .map_err(|_| Error::EngineNotExecutable(path.display().to_string()))?;
    }

    Ok(())
}

/// Reads a child's stderr to a string, for error reporting after a stream ends.
pub fn drain_stderr(child: &mut Child) -> String {
    let Some(mut stderr) = child.stderr.take() else {
        return String::new();
    };
    let mut buf = String::new();
    let _ = stderr.read_to_string(&mut buf);
    strip_ansi(&buf).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::strip_ansi;

    #[test]
    fn strips_colour_codes() {
        assert_eq!(
            strip_ansi("\x1b[0;32m  → QQ Music temp files\x1b[0m · 6 items"),
            "  → QQ Music temp files · 6 items"
        );
    }

    #[test]
    fn keeps_only_the_final_state_of_a_redrawn_line() {
        assert_eq!(
            strip_ansi("Scanning...\r\x1b[2KScanning caches\r\x1b[2KDone"),
            "Done"
        );
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let list = "=== Browsers ===\n/Users/x/Library/Caches/Edge  # 1.42GB";
        assert_eq!(strip_ansi(list), list);
    }
}
