pub mod analyze;
pub mod apps;
pub mod menu;
pub mod clean;
pub mod oplog;
pub mod optimize;
pub mod paths;
pub mod runner;
pub mod size;
pub mod status;
pub mod terminal;
pub mod uninstall;
pub mod whitelist;

use serde::Serialize;
use tauri::AppHandle;

use crate::error::Result;
use runner::Engine;

/// What the frontend needs to decide between "ready" and a diagnosable error
/// screen. Resolved once at startup and again whenever the user retries.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub version: String,
    pub path: String,
}

#[tauri::command]
pub async fn engine_info(app: AppHandle) -> Result<EngineInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;
        Ok(EngineInfo {
            version: engine.version()?,
            path: engine.dir().display().to_string(),
        })
    })
    .await
    .map_err(|e| crate::error::Error::Other(e.to_string()))?
}
