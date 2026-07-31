import { useSyncExternalStore } from "react";
import { check } from "@tauri-apps/plugin-updater";

export type UpdateState =
  | { status: "checking" }
  | { status: "none" }
  | { status: "available"; version: string }
  | { status: "installing" }
  | { status: "installed" }
  | { status: "error"; message: string };

let state: UpdateState = { status: "checking" };

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
  if (state.status === "checking" || state.status === "installing") return;
  set({ status: "checking" });
  try {
    const update = await check();
    if (update) set({ status: "available", version: update.version });
    else set({ status: "none" });
  } catch (e) {
    // No release yet (404) or offline — a quiet failure, not an error state.
    set({ status: "none" });
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
  } catch (e) {
    set({ status: "error", message: String(e) });
  }
}
