import { useSyncExternalStore } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { restartApp } from "@/lib/ipc";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "none" }
  | { status: "available"; version: string }
  | { status: "installing" }
  | { status: "installed" }
  | { status: "error"; message: string };

let state: UpdateState = { status: "idle" };

const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdate() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Checks the GitHub release endpoint for a newer version. Runs at launch. */
export async function checkForUpdates() {
  if (state.status === "installing") return;
  set({ status: "checking" });
  try {
    // Guard against a hung check (the Rust side has its own 15s timeout).
    const update = await Promise.race([
      check(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("检查超时")), 5_000),
      ),
    ]);
    if (update) set({ status: "available", version: update.version });
    else set({ status: "none" });
  } catch (e) {
    set({ status: "error", message: String(e) });
  }
}

/** Downloads and installs the update in place; the app restarts afterwards. */
export async function installUpdate() {
  if (state.status !== "available") return;
  set({ status: "installing" });
  try {
    const update = await check();
    if (!update) {
      set({ status: "none" });
      return;
    }
    await update.downloadAndInstall();
    set({ status: "installed" });
    // The bundle has been replaced; restart so the new version runs. The beat
    // of delay lets the UI show "更新完成" before the window closes.
    setTimeout(() => void restartApp(), 1200);
  } catch (e) {
    set({ status: "error", message: String(e) });
  }
}
