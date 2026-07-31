import { useSyncExternalStore } from "react";
import {
  cleanHistory,
  cleanRun,
  cleanScan,
  cleanSetExclusions,
  diskSummary,
  message,
  onCleanProgress,
  onCleanScanning,
  type CleanHistoryEntry,
  type CleanScan,
  type CleanSummary,
  type DiskSummary,
  type Exclusion,
} from "@/lib/ipc";

export type Phase =
  | { name: "idle" }
  | { name: "scanning"; section: string }
  | { name: "ready" }
  | {
      name: "cleaning";
      freed: number;
      done: number;
      /** Every path the engine has removed so far, so the checklist can fade
          each entry the moment its files are gone. */
      removed: string[];
    }
  /** The cleanup finished; the working view plays its exit before the result. */
  | {
      name: "completing";
      freed: number;
      done: number;
      removed: string[];
    }
  | { name: "done"; summary: CleanSummary };

type State = {
  phase: Phase;
  scan: CleanScan | null;
  excluded: Set<string>;
  disk: DiskSummary | null;
  history: CleanHistoryEntry[] | null;
  error: string | null;
};

/**
 * Cleanup state, kept outside React.
 *
 * A scan takes the better part of a minute and a cleanup longer, and both keep
 * running in Rust no matter which tab is open. Holding this in `CleanView` meant
 * navigating away threw the results out and detached the progress listener, so
 * coming back showed an empty screen while the engine was still working. Living
 * here, the state and its subscriptions outlast any view.
 */
let state: State = {
  phase: { name: "idle" },
  scan: null,
  excluded: new Set(),
  disk: null,
  history: null,
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

const snapshot = () => state;

export function useClean() {
  return useSyncExternalStore(subscribe, snapshot);
}

// --- engine events --------------------------------------------------------
// Registered once, at module load, so they are never attached twice by Strict
// Mode and never detached by navigation.

void onCleanScanning((section) => {
  if (state.phase.name !== "scanning") return;
  set({ phase: { name: "scanning", section } });
});

// Past cleanups, read once at launch and refreshed after each run.
void cleanHistory()
  .then((history) => set({ history }))
  .catch(() => set({ history: null }));

void onCleanProgress((progress) => {
  const phase = state.phase;
  if (phase.name !== "cleaning") return;
  const removedPaths = progress.entries
    .filter((e) => e.action === "REMOVED" || e.action === "TRASHED")
    .map((e) => e.path);
  set({
    phase: {
      name: "cleaning",
      freed: progress.freedBytes,
      done: progress.removed + progress.skipped + progress.failed,
      removed: [...phase.removed, ...removedPaths].filter(
        (path, i, all) => all.indexOf(path) === i,
      ),
    },
  });
});

// --- actions --------------------------------------------------------------

export async function refreshDisk() {
  try {
    set({ disk: await diskSummary() });
  } catch {
    set({ disk: null });
  }
}

export async function startScan() {
  if (state.phase.name === "scanning" || state.phase.name === "cleaning") return;
  set({ error: null, phase: { name: "scanning", section: "" } });
  try {
    const scan = await cleanScan();
    set({
      scan,
      excluded: new Set(
        scan.categories.flatMap((c) => c.items.filter((i) => i.excluded).map((i) => i.path)),
      ),
      phase: { name: "ready" },
    });
  } catch (e) {
    set({ error: message(e), phase: { name: "idle" } });
  }
}

export async function toggle(paths: string[], exclude: boolean) {
  const scan = state.scan;
  if (!scan) return;

  const excluded = new Set(state.excluded);
  for (const path of paths) {
    if (exclude) excluded.add(path);
    else excluded.delete(path);
  }
  set({ excluded });

  const payload: Exclusion[] = [];
  for (const category of scan.categories) {
    for (const item of category.items) {
      if (excluded.has(item.path)) {
        payload.push({ path: item.path, category: category.name, bytes: item.bytes });
      }
    }
  }

  try {
    await cleanSetExclusions(payload);
  } catch (e) {
    set({ error: message(e) });
  }
}

/** Narrowing through a parameter, which TypeScript tracks reliably where a
 *  closure variable's property narrowing is lost across `await`. */
function asCleaning(phase: Phase): Extract<Phase, { name: "cleaning" }> | null {
  return phase.name === "cleaning" ? phase : null;
}

export async function startClean() {
  if (state.phase.name === "cleaning") return;
  set({ error: null, phase: { name: "cleaning", freed: 0, done: 0, removed: [] } });
  try {
    const summary = await cleanRun();
    // Hold the working view for one exit beat so the run does not just
    // vanish into the result card.
    const cleaning = asCleaning(state.phase);
    if (cleaning) {
      set({
        phase: {
          name: "completing",
          freed: cleaning.freed,
          done: cleaning.done,
          removed: cleaning.removed,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    set({ phase: { name: "done", summary }, scan: null });
    void refreshDisk();
    void cleanHistory()
      .then((history) => set({ history }))
      .catch(() => {});
  } catch (e) {
    set({ error: message(e), phase: { name: "ready" } });
  }
}

/** Total that would actually be freed, given what is currently unchecked. */
export function selection(s: State) {
  if (!s.scan) return { bytes: 0, count: 0 };
  let bytes = 0;
  let count = 0;
  for (const category of s.scan.categories) {
    for (const item of category.items) {
      if (s.excluded.has(item.path)) continue;
      bytes += item.bytes;
      count += 1;
    }
  }
  return { bytes, count };
}
