import { useSyncExternalStore } from "react";
import {
  message,
  uninstallList,
  uninstallPreview,
  uninstallRun,
  type App,
  type Preview,
  type UninstallSummary,
} from "@/lib/ipc";

export type Step =
  | { name: "list" }
  | { name: "previewing" }
  | { name: "preview"; preview: Preview }
  | { name: "removing" }
  | { name: "done"; summary: UninstallSummary };

type State = {
  apps: App[];
  loading: boolean;
  /** Keyed by `uninstallName`, which is what the engine matches on. */
  selected: Set<string>;
  filter: string;
  step: Step;
  error: string | null;
};

let state: State = {
  apps: [],
  loading: false,
  selected: new Set(),
  filter: "",
  step: { name: "list" },
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

export function useUninstall() {
  return useSyncExternalStore(subscribe, () => state);
}

export async function load({ fresh = false } = {}) {
  if (state.loading) return;
  if (state.apps.length > 0 && !fresh) return;

  set({ loading: true, error: null });
  try {
    set({ apps: await uninstallList(), loading: false });
  } catch (e) {
    set({ error: message(e), loading: false });
  }
}

export function toggle(uninstallName: string) {
  const selected = new Set(state.selected);
  if (selected.has(uninstallName)) selected.delete(uninstallName);
  else selected.add(uninstallName);
  set({ selected });
}

export function clearSelection() {
  set({ selected: new Set() });
}

export function setFilter(filter: string) {
  set({ filter });
}

export function backToList() {
  set({ step: { name: "list" }, error: null });
}

/**
 * Runs the removal under `--dry-run` and shows exactly what it would delete.
 *
 * This is the confirmation. The engine's own prompts are answered from here, so
 * this list is the last point at which anything can be reconsidered.
 */
export async function preview() {
  const names = [...state.selected];
  if (names.length === 0) return;

  set({ step: { name: "previewing" }, error: null });
  try {
    set({ step: { name: "preview", preview: await uninstallPreview(names) } });
  } catch (e) {
    set({ error: message(e), step: { name: "list" } });
  }
}

export async function remove() {
  const names = [...state.selected];
  if (names.length === 0 || state.step.name !== "preview") return;

  set({ step: { name: "removing" }, error: null });
  try {
    const summary = await uninstallRun(names);
    set({ step: { name: "done", summary }, selected: new Set() });
    void load({ fresh: true });
  } catch (e) {
    set({ error: message(e), step: { name: "list" } });
  }
}

/** Apps matching the current filter, by name or bundle id. */
export function visible(s: State): App[] {
  const needle = s.filter.trim().toLowerCase();
  if (!needle) return s.apps;
  return s.apps.filter(
    (app) =>
      app.name.toLowerCase().includes(needle) ||
      app.bundleId.toLowerCase().includes(needle),
  );
}

export function selectedBytes(s: State): number {
  return s.apps
    .filter((app) => s.selected.has(app.uninstallName))
    .reduce((sum, app) => sum + (app.bytes ?? 0), 0);
}
