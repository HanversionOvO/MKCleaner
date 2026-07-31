import { useSyncExternalStore } from "react";
import {
  message,
  onOptimizeProgress,
  onOptimizeScanning,
  optimizeRun,
  optimizeScan,
  type OptimizeItem,
  type OptimizeSummary,
} from "@/lib/ipc";

export type Phase =
  | { name: "idle" }
  | { name: "scanning" }
  | { name: "ready" }
  | { name: "optimizing" }
  | { name: "done"; summary: OptimizeSummary };

type State = {
  phase: Phase;
  items: OptimizeItem[];
  /** The section the engine is on, and its latest detail line. */
  current: { title: string; detail: string | null } | null;
  error: string | null;
};

let state: State = {
  phase: { name: "idle" },
  items: [],
  current: null,
  error: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOptimize() {
  return useSyncExternalStore(subscribe, () => state);
}

// --- engine events --------------------------------------------------------

void onOptimizeScanning((item) => {
  if (state.phase.name !== "scanning") return;
  set({
    items: [...state.items, item],
    current: { title: item.title, detail: null },
  });
});

void onOptimizeProgress((progress) => {
  if (state.phase.name !== "optimizing") return;
  set({ current: { title: progress.title, detail: progress.detail } });
});

// --- actions --------------------------------------------------------------

export async function startScan() {
  if (state.phase.name === "scanning" || state.phase.name === "optimizing") return;
  set({ error: null, phase: { name: "scanning" }, items: [], current: null });
  try {
    const items = await optimizeScan();
    set({ items, phase: { name: "ready" }, current: null });
  } catch (e) {
    set({ error: message(e), phase: { name: "idle" } });
  }
}

export async function startOptimize() {
  if (state.phase.name === "optimizing") return;
  set({ error: null, phase: { name: "optimizing" }, current: null });
  try {
    const summary = await optimizeRun();
    set({ phase: { name: "done", summary } });
  } catch (e) {
    set({ error: message(e), phase: { name: "ready" } });
  }
}
