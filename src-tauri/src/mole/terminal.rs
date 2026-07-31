//! A real terminal for the bundled engine.
//!
//! The engine runs inside a pty, so it behaves exactly as it does in a
//! terminal: full colour, progress spinners, interactive prompts — everything
//! the GUI pages cannot reach. The boundary from the previous line-based
//! terminal stays: the *command* is still restricted to a whitelist of mo
//! subcommands, and arguments with shell metacharacters are refused. Once
//! running, keystrokes go straight to the pty.
//!
//! `update` and `remove` are refused — they would rewrite or delete the
//! engine inside .app and break the code signature.

use std::io::{Read, Write};
use std::process::Child;
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Error, Result};
use crate::mole::runner::Engine;

/// Subcommands the terminal may run. Everything else is refused.
const ALLOWED: &[&str] = &[
    "clean",
    "optimize",
    "analyze",
    "status",
    "history",
    "purge",
    "touchid",
    "--help",
    "-h",
    "--version",
];

/// Shell metacharacters never cross into a mo argument.
fn has_metachar(arg: &str) -> bool {
    arg.chars().any(|c| ";&|`$()<>\"'\\".contains(c))
}

/// One live pty session: the master handle (for resize), the writer (keystrokes
/// in) and the child (for killing).
pub struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// The running pty session, if any. Only one at a time.
#[derive(Default)]
pub struct Terminal(Mutex<Option<Session>>);

/// Parses and validates a `mo …` command line, returning the engine args.
fn parse(input: &str) -> Result<Vec<String>> {
    let parts: Vec<&str> = input.split_whitespace().collect();
    let rest = match parts.first().copied() {
        Some("mo") | Some("mole") => &parts[1..],
        Some(other) => {
            return Err(Error::Other(format!("只支持 mo 命令，收到：{other}")));
        }
        None => return Err(Error::Other("输入命令，例如：mo clean --dry-run".into())),
    };

    // Bare `mo` opens the interactive main menu — the terminal's default face.
    let Some(subcommand) = rest.first().copied() else {
        return Ok(Vec::new());
    };
    if !ALLOWED.contains(&subcommand) {
        return Err(Error::Other(format!(
            "不允许的命令：{subcommand}（支持：clean / optimize / analyze / status / history / purge / touchid）"
        )));
    }
    if let Some(bad) = rest.iter().find(|arg| has_metachar(arg)) {
        return Err(Error::Other(format!("参数包含不允许的字符：{bad}")));
    }
    Ok(rest.iter().map(|s| s.to_string()).collect())
}

#[tauri::command]
pub async fn terminal_pty_start(app: AppHandle, input: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;
        let args = parse(&input)?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Other(format!("打开 pty 失败：{e}")))?;

        let mut builder = CommandBuilder::new(engine.dir().join("mole"));
        for arg in &args {
            builder.arg(arg);
        }
        builder.env(
            "PATH",
            format!(
                "{}:/usr/bin:/bin:/usr/sbin:/sbin",
                engine.dir().join("bin").display()
            ),
        );
        builder.env_remove("MO_DEBUG");
        builder.env_remove("MOLE_TEST_MODE");

        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|e| Error::Other(format!("启动引擎失败：{e}")))?;
        drop(pair.slave);

        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| Error::Other(format!("读取 pty 失败：{e}")))?;
        let writer = master
            .take_writer()
            .map_err(|e| Error::Other(format!("写入 pty 失败：{e}")))?;

        // Replace any hung session.
        let terminal = app.state::<Terminal>();
        if let Ok(mut guard) = terminal.0.lock() {
            if let Some(mut old) = guard.take() {
                let _ = old.child.kill();
            }
            *guard = Some(Session {
                master,
                writer,
                child,
            });
        }

        // Stream the pty output as it comes, without waiting for newlines —
        // spinners and progress bars redraw in place.
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut reader = reader;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                        if app.emit("terminal://data", chunk).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = app.emit("terminal://exit", ());
        });

        Ok(())
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[tauri::command]
pub fn terminal_pty_write(app: AppHandle, data: String) -> Result<()> {
    let terminal = app.state::<Terminal>();
    let mut guard = terminal
        .0
        .lock()
        .map_err(|_| Error::Other("terminal lock poisoned".into()))?;
    let Some(session) = guard.as_mut() else {
        return Err(Error::Other("终端未运行".into()));
    };
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| Error::Other(format!("写入终端失败：{e}")))
}

#[tauri::command]
pub fn terminal_pty_resize(app: AppHandle, cols: u16, rows: u16) -> Result<()> {
    let terminal = app.state::<Terminal>();
    let guard = terminal
        .0
        .lock()
        .map_err(|_| Error::Other("terminal lock poisoned".into()))?;
    let Some(session) = guard.as_ref() else {
        return Ok(());
    };
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::Other(format!("调整终端大小失败：{e}")))
}

#[tauri::command]
pub fn terminal_pty_kill(app: AppHandle) {
    if let Ok(mut guard) = app.state::<Terminal>().0.lock() {
        if let Some(mut session) = guard.take() {
            let _ = session.child.kill();
        }
    }
}
