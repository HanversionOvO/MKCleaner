mod error;
mod mole;

use std::io::{BufRead, BufReader};

use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::mole::runner::Engine;

/// Where the bundled GPL-3.0 license text lives, for the About dialog.
#[tauri::command]
fn license_path(app: AppHandle) -> Option<String> {
    app.path()
        .resource_dir()
        .ok()?
        .join("license/LICENSE.txt")
        .to_str()
        .map(String::from)
}

/// Brings the main window back from the tray.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(mole::status::Watcher::default())
        .manage(mole::terminal::Terminal::default())
        .invoke_handler(tauri::generate_handler![
            mole::engine_info,
            mole::clean::clean_scan,
            mole::clean::clean_set_exclusions,
            mole::clean::clean_run,
            mole::clean::clean_history,
            mole::optimize::optimize_scan,
            mole::optimize::optimize_run,
            mole::status::disk_summary,
            mole::status::status_watch_start,
            mole::status::status_watch_stop,
            mole::analyze::analyze,
            mole::uninstall::uninstall_list,
            mole::uninstall::uninstall_preview,
            mole::uninstall::uninstall_run,
            mole::uninstall::app_icon,
            mole::menu::show_tile_menu,
            mole::terminal::terminal_pty_start,
            mole::terminal::terminal_pty_write,
            mole::terminal::terminal_pty_resize,
            mole::terminal::terminal_pty_kill,
            license_path,
        ])
        // Closing the window hides it instead of quitting — the app lives in
        // the tray. Cmd+Q still quits, as does the tray's 退出 item.
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                // Popup menus carry the target path in the item id.
                path if !path.starts_with("tray-") && !path.is_empty() => {
                    let _ = app.emit("menu://reveal", path.to_string());
                }
                "tray-show" => show_main_window(app),
                "tray-scan" => {
                    show_main_window(app);
                    let _ = app.emit("tray://scan", ());
                }
                "tray-optimize" | "tray-analyze" | "tray-uninstall" => {
                    show_main_window(app);
                    let view = event.id().as_ref().trim_start_matches("tray-");
                    let _ = app.emit("tray://navigate", view.to_string());
                }
                "tray-quit" => app.exit(0),
                _ => {}
            }
        })
        .setup(|app| {
            // Live status rows at the top of the tray menu, refreshed by a
            // long-running `status -watch` in a background thread.
            let cpu_item =
                MenuItem::with_id(app, "tray-status-cpu", "读取系统状态…", false, None::<&str>)?;
            let disk_item =
                MenuItem::with_id(app, "tray-status-disk", "读取系统状态…", false, None::<&str>)?;
            let sep1 = tauri::menu::PredefinedMenuItem::separator(app)?;

            let show = MenuItem::with_id(app, "tray-show", "打开 MkCleaner", true, None::<&str>)?;
            let scan = MenuItem::with_id(app, "tray-scan", "开始扫描", true, None::<&str>)?;
            let optimize =
                MenuItem::with_id(app, "tray-optimize", "优化", true, None::<&str>)?;
            let analyze = MenuItem::with_id(app, "tray-analyze", "查看空间", true, None::<&str>)?;
            let uninstall =
                MenuItem::with_id(app, "tray-uninstall", "卸载", true, None::<&str>)?;
            let sep2 = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &cpu_item, &disk_item, &sep1, &show, &scan, &optimize, &analyze,
                    &uninstall, &sep2, &quit,
                ])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .icon_as_template(true)
                .tooltip("MkCleaner")
                .menu(&menu)
                // Left click opens the window; the menu is for right click.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Refresh the status rows from the engine's live stream.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let Ok(engine) = Engine::resolve(&handle) else {
                    return;
                };
                let Ok(mut child) = engine.spawn(&["status", "-watch", "-interval", "2s"]) else {
                    return;
                };
                let Some(stdout) = child.stdout.take() else {
                    return;
                };
                for line in BufReader::new(stdout).lines().map_while(std::result::Result::ok) {
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    // The first tick is a fast partial snapshot; blank fields
                    // keep the previous values.
                    let cpu = value["cpu"]["usage"].as_f64().unwrap_or(f64::NAN);
                    let mem = value["memory"]["used_percent"].as_f64().unwrap_or(f64::NAN);
                    if cpu.is_finite() && mem.is_finite() {
                        let _ = cpu_item.set_text(format!("CPU {cpu:.0}% · 内存 {mem:.0}%"));
                    }
                    let disk = value["disks"]
                        .as_array()
                        .and_then(|disks| {
                            disks.iter().find(|d| d["mount"].as_str() == Some("/"))
                        })
                        .and_then(|d| d["used_percent"].as_f64());
                    let battery = value["batteries"]
                        .as_array()
                        .and_then(|b| b.first())
                        .and_then(|b| b["percent"].as_f64());
                    let mut parts = Vec::new();
                    if let Some(pct) = disk.filter(|v| v.is_finite()) {
                        parts.push(format!("磁盘 {pct:.0}%"));
                    }
                    if let Some(pct) = battery.filter(|v| v.is_finite()) {
                        parts.push(format!("电池 {pct:.0}%"));
                    }
                    if !parts.is_empty() {
                        let _ = disk_item.set_text(parts.join(" · "));
                    }
                }
            });

            let _ = _tray;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The metrics poller wakes every second. Without this it would
            // outlive the window it was started for.
            if let tauri::RunEvent::Exit = event {
                mole::status::stop_watcher(app);
            }
        });
}
