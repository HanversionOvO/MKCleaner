import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";

/**
 * Calls a Rust command and validates the result.
 *
 * The Rust side reshapes the engine's output, but that output originates from
 * shell scripts and can drift between engine versions. Validating at the
 * boundary turns a drift into one legible error instead of `undefined` surfacing
 * three components deep.
 */
export async function call<T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> {
  const raw = await invoke(command, args);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${command} returned an unexpected shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

/** Errors cross the bridge as plain strings; this keeps `catch` blocks readable. */
export function message(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

// --- engine ---------------------------------------------------------------

export const EngineInfo = z.object({
  version: z.string(),
  path: z.string(),
});
export type EngineInfo = z.infer<typeof EngineInfo>;

export const engineInfo = () => call("engine_info", EngineInfo);

export const licensePath = () => invoke<string | null>("license_path");

// --- disk -----------------------------------------------------------------

export const DiskSummary = z.object({
  used: z.number(),
  total: z.number(),
});
export type DiskSummary = z.infer<typeof DiskSummary>;

export const diskSummary = () => call("disk_summary", DiskSummary);

// --- clean ----------------------------------------------------------------

export const CleanItem = z.object({
  path: z.string(),
  bytes: z.number(),
  excluded: z.boolean(),
});
export type CleanItem = z.infer<typeof CleanItem>;

export const CleanCategory = z.object({
  name: z.string(),
  items: z.array(CleanItem),
  bytes: z.number(),
});
export type CleanCategory = z.infer<typeof CleanCategory>;

export const CleanScan = z.object({
  categories: z.array(CleanCategory),
  bytes: z.number(),
  itemCount: z.number(),
  excludedBytes: z.number(),
  excludedCount: z.number(),
  home: z.string(),
});
export type CleanScan = z.infer<typeof CleanScan>;

export const CleanSummary = z.object({
  freedBytes: z.number(),
  items: z.number(),
  removed: z.number(),
  skipped: z.number(),
  failed: z.number(),
});
export type CleanSummary = z.infer<typeof CleanSummary>;

export type Exclusion = { path: string; category: string; bytes: number };

export const OptimizeItem = z.object({
  title: z.string(),
  details: z.array(z.string()),
});
export type OptimizeItem = z.infer<typeof OptimizeItem>;

export const OptimizeSummary = z.object({
  items: z.number(),
  bytes: z.number(),
});
export type OptimizeSummary = z.infer<typeof OptimizeSummary>;

export const optimizeScan = () => call("optimize_scan", z.array(OptimizeItem));
export const optimizeRun = () => call("optimize_run", OptimizeSummary);

export const OptimizeProgress = z.object({
  title: z.string(),
  detail: z.string().nullable(),
});
export type OptimizeProgress = z.infer<typeof OptimizeProgress>;

export const onOptimizeScanning = (handler: (item: OptimizeItem) => void) =>
  on("optimize://scanning", OptimizeItem, handler);
export const onOptimizeProgress = (handler: (progress: OptimizeProgress) => void) =>
  on("optimize://progress", OptimizeProgress, handler);

export const CleanHistoryEntry = z.object({
  command: z.string(),
  startedAt: z.string(),
  items: z.number(),
  bytes: z.number(),
});
export type CleanHistoryEntry = z.infer<typeof CleanHistoryEntry>;

export const cleanScan = () => call("clean_scan", CleanScan);
export const cleanRun = () => call("clean_run", CleanSummary);
export const cleanHistory = () => call("clean_history", z.array(CleanHistoryEntry));
export const cleanSetExclusions = (items: Exclusion[]) =>
  invoke<void>("clean_set_exclusions", { items });

// --- events ---------------------------------------------------------------

export const CleanProgress = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      path: z.string(),
      bytes: z.number().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  freedBytes: z.number(),
  removed: z.number(),
  skipped: z.number(),
  failed: z.number(),
});
export type CleanProgress = z.infer<typeof CleanProgress>;

/** Subscribes to a Rust event, dropping payloads that fail validation. */
export function on<T>(
  event: string,
  schema: z.ZodType<T>,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen(event, (e) => {
    const parsed = schema.safeParse(e.payload);
    if (parsed.success) handler(parsed.data);
  });
}

export const onCleanScanning = (handler: (section: string) => void) =>
  on("clean://scanning", z.string(), handler);

export const onCleanProgress = (handler: (progress: CleanProgress) => void) =>
  on("clean://progress", CleanProgress, handler);

// --- terminal -------------------------------------------------------------

export const terminalPtyStart = (input: string) =>
  invoke<void>("terminal_pty_start", { input });
export const terminalPtyWrite = (data: string) =>
  invoke<void>("terminal_pty_write", { data });
export const terminalPtyResize = (cols: number, rows: number) =>
  invoke<void>("terminal_pty_resize", { cols, rows });
export const terminalPtyKill = () => invoke<void>("terminal_pty_kill");

export const onTerminalData = (handler: (chunk: string) => void) =>
  on("terminal://data", z.string(), handler);
export const onTerminalExit = (handler: () => void) =>
  on("terminal://exit", z.unknown(), handler);

/** The tray's "开始扫描" item: jump to the clean view and start a scan. */
export const onTrayScan = (handler: () => void) =>
  on("tray://scan", z.unknown(), handler);

/** The tray's navigate items: jump to a view (optimize / analyze / uninstall). */
export const onTrayNavigate = (handler: (view: string) => void) =>
  on("tray://navigate", z.string(), handler);

// --- status ---------------------------------------------------------------

export const Tick = z.object({
  uptime: z.string(),
  procs: z.number(),
  healthScore: z.number(),
  healthScoreMsg: z.string(),
  hardware: z.object({
    model: z.string(),
    cpuModel: z.string(),
    totalRam: z.string(),
    osVersion: z.string(),
  }),
  cpu: z.object({
    usage: z.number(),
    perCore: z.array(z.number()),
    load1: z.number(),
    coreCount: z.number(),
    pCoreCount: z.number(),
    eCoreCount: z.number(),
  }),
  memory: z.object({
    used: z.number(),
    total: z.number(),
    available: z.number(),
    cached: z.number(),
    usedPercent: z.number(),
    swapUsed: z.number(),
    swapTotal: z.number(),
  }),
  disks: z.array(
    z.object({
      mount: z.string(),
      used: z.number(),
      total: z.number(),
      external: z.boolean(),
    }),
  ),
  network: z.array(
    z.object({
      name: z.string(),
      rxRateMbs: z.number(),
      txRateMbs: z.number(),
    }),
  ),
  batteries: z.array(
    z.object({
      percent: z.number(),
      status: z.string(),
      timeLeft: z.string(),
      health: z.string(),
      cycleCount: z.number(),
    }),
  ),
  thermal: z.object({
    cpuTemp: z.number(),
    batteryTemp: z.number(),
    fanSpeed: z.number(),
    systemPower: z.number(),
    thermalLevel: z.number(),
  }),
  topProcesses: z.array(
    z.object({
      pid: z.number(),
      name: z.string(),
      cpu: z.number(),
      memoryBytes: z.number(),
    }),
  ),
});
export type Tick = z.infer<typeof Tick>;

export const statusWatchStart = () => invoke<void>("status_watch_start");
export const statusWatchStop = () => invoke<void>("status_watch_stop");

// --- analyze --------------------------------------------------------------

export const AnalyzeEntry = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number(),
  isDir: z.boolean(),
  insight: z.boolean(),
});
export type AnalyzeEntry = z.infer<typeof AnalyzeEntry>;

export const Analysis = z.object({
  path: z.string(),
  overview: z.boolean(),
  entries: z.array(AnalyzeEntry),
  largeFiles: z.array(
    z.object({ name: z.string(), path: z.string(), size: z.number() }),
  ),
  totalSize: z.number(),
  totalFiles: z.number(),
  home: z.string(),
});
export type Analysis = z.infer<typeof Analysis>;

export const analyze = (path?: string) => call("analyze", Analysis, { path });

// --- native context menu --------------------------------------------------

export const showTileMenu = (path: string) => invoke<void>("show_tile_menu", { path });

export const onMenuReveal = (handler: (path: string) => void) =>
  on("menu://reveal", z.string(), handler);

/** A scan in progress: the directories measured so far, largest first. */
export const AnalyzeProgress = z.object({
  entries: z.array(z.object({ name: z.string(), path: z.string(), size: z.number() })),
});
export type AnalyzeProgress = z.infer<typeof AnalyzeProgress>;

// --- uninstall ------------------------------------------------------------

export const App = z.object({
  name: z.string(),
  bundleId: z.string(),
  /** The exact string the engine matches on — not always the display name. */
  uninstallName: z.string(),
  path: z.string(),
  bytes: z.number().nullable(),
});
export type App = z.infer<typeof App>;

export const Preview = z.object({
  apps: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      items: z.array(
        z.object({ path: z.string(), bytes: z.number().nullable() }),
      ),
    }),
  ),
  bytes: z.number(),
});
export type Preview = z.infer<typeof Preview>;

export const UninstallSummary = z.object({
  freedBytes: z.number(),
  items: z.number(),
  removed: z.number(),
  failed: z.number(),
});
export type UninstallSummary = z.infer<typeof UninstallSummary>;

export const uninstallList = () => call("uninstall_list", z.array(App));
export const uninstallPreview = (names: string[]) =>
  call("uninstall_preview", Preview, { names });
export const uninstallRun = (names: string[]) =>
  call("uninstall_run", UninstallSummary, { names });
export const appIcon = (path: string) =>
  invoke<string | null>("app_icon", { path });
