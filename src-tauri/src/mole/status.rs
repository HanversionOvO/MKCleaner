//! System metrics from `mole status`.
//!
//! `status -watch` streams one JSON document per second on stdout. The first
//! tick is a fast partial — hardware, batteries, thermal and top processes are
//! empty so the engine can paint something immediately — and only later ticks
//! carry everything. Rather than push that inconsistency to the UI, the reader
//! carries the last known value forward for those fields, so every tick that
//! crosses the bridge is a complete snapshot.

use std::io::{BufRead, BufReader};
use std::process::Child;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Error, Result};
use crate::mole::runner::Engine;

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/// The parts of the engine's status document the dashboard shows. Fields we do
/// not display (bluetooth, sensors, proxy, process watch config) are dropped
/// here rather than carried across the bridge.
///
/// The engine speaks snake_case and the frontend expects camelCase, so every
/// struct here renames per direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Tick {
    pub uptime: String,
    pub procs: u32,
    pub health_score: i32,
    pub health_score_msg: String,
    pub hardware: Hardware,
    pub cpu: Cpu,
    pub memory: Memory,
    pub disks: Vec<Disk>,
    pub network: Vec<Network>,
    pub batteries: Vec<Battery>,
    pub thermal: Thermal,
    pub top_processes: Vec<Process>,
}

impl Default for Tick {
    fn default() -> Self {
        Tick {
            uptime: String::new(),
            procs: 0,
            health_score: 0,
            health_score_msg: String::new(),
            hardware: Hardware::default(),
            cpu: Cpu::default(),
            memory: Memory::default(),
            disks: Vec::new(),
            network: Vec::new(),
            batteries: Vec::new(),
            thermal: Thermal::default(),
            top_processes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Hardware {
    pub model: String,
    pub cpu_model: String,
    pub total_ram: String,
    pub os_version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Cpu {
    pub usage: f64,
    pub per_core: Vec<f64>,
    pub load1: f64,
    pub core_count: u32,
    /// Apple Silicon reports performance and efficiency cores separately, and
    /// `per_core` lists the performance cores first.
    pub p_core_count: u32,
    pub e_core_count: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Memory {
    pub used: u64,
    pub total: u64,
    pub available: u64,
    pub cached: u64,
    pub used_percent: f64,
    pub swap_used: u64,
    pub swap_total: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Disk {
    pub mount: String,
    pub used: u64,
    pub total: u64,
    pub external: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Network {
    pub name: String,
    pub rx_rate_mbs: f64,
    pub tx_rate_mbs: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Battery {
    pub percent: f64,
    /// `charging`, `discharging`, `charged`…
    pub status: String,
    pub time_left: String,
    pub health: String,
    pub cycle_count: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Thermal {
    pub cpu_temp: f64,
    pub battery_temp: f64,
    pub fan_speed: f64,
    pub system_power: f64,
    /// 100 = not throttled; lower = the CPU is being held back by heat.
    /// Added by MkCleaner's engine patch — `pmset -g therm`, no root needed.
    pub thermal_level: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    default,
    rename_all(serialize = "camelCase", deserialize = "snake_case")
)]
pub struct Process {
    pub pid: u32,
    pub name: String,
    pub cpu: f64,
    pub memory_bytes: u64,
}

// ---------------------------------------------------------------------------
// One-shot
// ---------------------------------------------------------------------------

/// Capacity of the volume the system booted from.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSummary {
    pub used: u64,
    pub total: u64,
}

#[tauri::command]
pub async fn disk_summary(app: AppHandle) -> Result<DiskSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&app)?;
        let tick: Tick = engine.capture_json(&["status", "-json"])?;

        // Mounted simulator runtimes and external volumes also show up here.
        tick.disks
            .into_iter()
            .find(|d| d.mount == "/" && !d.external)
            .map(|d| DiskSummary {
                used: d.used,
                total: d.total,
            })
            .ok_or_else(|| Error::Other("no boot volume in the engine's disk list".into()))
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/// Holds the live `status -watch` process, if any.
///
/// Exactly one may run at a time: it wakes every second, so leaking one would
/// keep polling the system long after the view that wanted it is gone.
#[derive(Default)]
pub struct Watcher(Mutex<Option<Child>>);

impl Watcher {
    fn stop(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Fields the engine leaves empty on its first, fast tick.
const CARRIED: [&str; 5] = ["hardware", "batteries", "thermal", "top_processes", "gpu"];

/// Whether a value carries no information: null, an empty array, or an object
/// whose every field is zero or blank.
fn is_blank(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(items) => items.is_empty(),
        Value::String(s) => s.is_empty(),
        Value::Number(n) => n.as_f64() == Some(0.0),
        Value::Object(fields) => fields.values().all(is_blank),
        Value::Bool(_) => false,
    }
}

#[tauri::command]
pub async fn status_watch_start(app: AppHandle) -> Result<()> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let engine = Engine::resolve(&handle)?;

        // Replace rather than refuse: a view remounting should not be left
        // listening to a stream nobody restarted.
        let watcher = handle.state::<Watcher>();
        watcher.stop();

        let mut child = engine.spawn(&["status", "-watch", "-interval", "1s"])?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Other("status -watch produced no stdout".into()))?;

        if let Ok(mut guard) = watcher.0.lock() {
            *guard = Some(child);
        }

        std::thread::spawn(move || {
            let mut carried: serde_json::Map<String, Value> = serde_json::Map::new();

            for line in BufReader::new(stdout).lines().map_while(std::result::Result::ok) {
                let Ok(Value::Object(mut fields)) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };

                for key in CARRIED {
                    match fields.get(key) {
                        Some(value) if !is_blank(value) => {
                            carried.insert(key.to_string(), value.clone());
                        }
                        _ => {
                            if let Some(previous) = carried.get(key) {
                                fields.insert(key.to_string(), previous.clone());
                            }
                        }
                    }
                }

                if let Ok(tick) = serde_json::from_value::<Tick>(Value::Object(fields)) {
                    // Emitting fails once the window is gone; that is the signal
                    // to stop reading.
                    if handle.emit("status://tick", tick).is_err() {
                        break;
                    }
                }
            }
        });

        Ok(())
    })
    .await
    .map_err(|e| Error::Other(e.to_string()))?
}

#[tauri::command]
pub fn status_watch_stop(app: AppHandle) {
    app.state::<Watcher>().stop();
}

/// Called on app exit so the engine's poller never outlives the window.
pub fn stop_watcher(app: &AppHandle) {
    app.state::<Watcher>().stop();
}

#[cfg(test)]
mod tests {
    use super::{is_blank, Tick};
    use serde_json::json;

    #[test]
    fn recognises_the_engines_empty_first_tick() {
        assert!(is_blank(&json!(null)));
        assert!(is_blank(&json!([])));
        assert!(is_blank(&json!({
            "model": "", "cpu_model": "", "total_ram": "", "refresh_rate": ""
        })));
        assert!(is_blank(&json!({
            "cpu_temp": 0, "battery_temp": 0, "fan_speed": 0, "fan_count": 0
        })));
    }

    #[test]
    fn keeps_ticks_that_carry_anything() {
        assert!(!is_blank(&json!({ "model": "MacBook Air", "cpu_model": "" })));
        assert!(!is_blank(&json!({ "cpu_temp": 0, "battery_temp": 30.81 })));
        assert!(!is_blank(&json!([{ "percent": 100 }])));
    }

    /// A tick captured from a real `status -watch` run.
    const FIXTURE: &str = include_str!("../../tests/fixtures/status-tick.json");

    /// Reads the engine's snake_case and writes the frontend's camelCase.
    ///
    /// These structs rename per direction, which is easy to get subtly wrong —
    /// and getting it wrong yields zeroes everywhere rather than an error, so
    /// this checks values, not just that parsing succeeded.
    #[test]
    fn reads_a_real_tick_and_renames_both_ways() {
        let tick: Tick = serde_json::from_str(FIXTURE).expect("engine output parses");

        assert_eq!(tick.hardware.model, "MacBook Air");
        assert_eq!(tick.hardware.cpu_model, "Apple M4");
        assert!(tick.cpu.usage > 0.0, "cpu usage lost");
        assert_eq!(tick.cpu.per_core.len(), 10);
        assert_eq!(tick.cpu.p_core_count + tick.cpu.e_core_count, 10);
        assert!(tick.memory.used_percent > 0.0, "memory percent lost");
        assert!(tick.disks.iter().any(|d| d.mount == "/"), "boot volume lost");
        assert!(tick.batteries[0].percent > 0.0, "battery percent lost");
        assert!(!tick.batteries[0].health.is_empty(), "battery health lost");
        assert!(tick.thermal.battery_temp > 0.0, "thermal lost");
        assert_eq!(tick.top_processes.len(), 3);
        assert!(tick.top_processes[0].memory_bytes > 0, "process memory lost");

        let out = serde_json::to_value(&tick).expect("serializes");
        for key in [
            "healthScore",
            "healthScoreMsg",
            "topProcesses",
            "hardware",
            "cpu",
        ] {
            assert!(out.get(key).is_some(), "frontend key {key} missing");
        }
        assert!(out["cpu"].get("perCore").is_some(), "cpu.perCore missing");
        assert!(out["cpu"].get("pCoreCount").is_some(), "cpu.pCoreCount missing");
        assert!(out["memory"].get("usedPercent").is_some(), "memory.usedPercent missing");
        assert!(out["batteries"][0].get("cycleCount").is_some(), "battery.cycleCount missing");
        assert!(out["thermal"].get("batteryTemp").is_some(), "thermal.batteryTemp missing");
        assert!(out["topProcesses"][0].get("memoryBytes").is_some(), "process.memoryBytes missing");

        // Nothing should still be snake_case on the way out.
        assert!(out.get("health_score").is_none(), "snake_case leaked to the frontend");
    }
}
