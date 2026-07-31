import { useSyncExternalStore } from "react";
import {
  analyze,
  message,
  on,
  AnalyzeProgress,
  type Analysis,
} from "@/lib/ipc";

/** One step of the path the user has drilled through. */
export type Crumb = {
  label: string;
  /** null is the curated overview, which has no path of its own. */
  path: string | null;
  /** This entry's share of its parent, or null at the root. */
  share: number | null;
};

type State = {
  crumbs: Crumb[];
  current: Analysis | null;
  loading: boolean;
  error: string | null;
};

const ROOT: Crumb = { label: "启动磁盘", path: null, share: null };

let state: State = { crumbs: [ROOT], current: null, loading: false, error: null };

/**
 * Results by path.
 *
 * Every level costs a subprocess and a directory walk, so going back up should
 * not pay for it again. Sizes drift slowly enough that a cached level is still
 * a fair answer; `reload` exists for when it is not.
 */
const cache = new Map<string, Analysis>();

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

export function useAnalyze() {
  return useSyncExternalStore(subscribe, () => state);
}

// Live scan progress: while a level is loading, each block's size settles as
// its directory finishes being measured, so the treemap grows and reorders
// instead of appearing all at once.
void on("analyze://progress", AnalyzeProgress, (progress) => {
  if (!state.loading || state.crumbs.length === 0) return;
  const target = state.crumbs[state.crumbs.length - 1].path;
  if (!target) return; // the overview is not measured live

  const merged = [...(state.current?.entries ?? [])];
  for (const entry of progress.entries) {
    const at = merged.findIndex((e) => e.path === entry.path);
    if (at >= 0) merged[at] = { ...merged[at], size: entry.size };
    else
      merged.push({
        name: entry.name,
        path: entry.path,
        size: entry.size,
        isDir: true,
        insight: false,
      });
  }
  merged.sort((a, b) => b.size - a.size);

  set({
    current: {
      path: target,
      overview: false,
      entries: merged,
      largeFiles: state.current?.largeFiles ?? [],
      totalSize: merged.reduce((sum, e) => sum + e.size, 0),
      totalFiles: state.current?.totalFiles ?? 0,
      home: state.current?.home ?? "",
    },
  });
});

/** Guards against a slow level arriving after the user has moved on. */
let generation = 0;

async function load(crumbs: Crumb[], { fresh = false } = {}) {
  const target = crumbs[crumbs.length - 1].path;
  const key = target ?? "";
  const mine = ++generation;

  const cached = fresh ? undefined : cache.get(key);
  if (cached) {
    set({ crumbs, current: cached, loading: false, error: null });
    return;
  }

  set({ crumbs, current: null, loading: true, error: null });
  try {
    const result = await analyze(target ?? undefined);
    cache.set(key, result);
    if (generation === mine) set({ current: result, loading: false });
  } catch (e) {
    if (generation === mine) set({ error: message(e), loading: false });
  }
}

/** Loads the overview, unless a level is already showing. */
export function open() {
  if (state.current || state.loading) return;
  void load(state.crumbs);
}

export function drillInto(entry: { name: string; path: string; size: number }) {
  const total = state.current?.totalSize ?? 0;
  void load([
    ...state.crumbs,
    {
      label: entry.name,
      path: entry.path,
      share: total > 0 ? entry.size / total : null,
    },
  ]);
}

export function goTo(index: number) {
  if (index >= state.crumbs.length - 1) return;
  void load(state.crumbs.slice(0, index + 1));
}

export function reload() {
  void load(state.crumbs, { fresh: true });
}
