import { useSyncExternalStore } from "react";
import { message, on, statusWatchStart, statusWatchStop, Tick } from "@/lib/ipc";

/** Samples kept for the activity trace — one per second, so one minute. */
const WINDOW = 60;

type State = {
  tick: Tick | null;
  cpu: number[];
  memory: number[];
  error: string | null;
};

let state: State = { tick: null, cpu: [], memory: [], error: null };

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

export function useStatus() {
  return useSyncExternalStore(subscribe, () => state);
}

const push = (series: number[], value: number) =>
  [...series, value].slice(-WINDOW);

void on("status://tick", Tick, (tick) => {
  set({
    tick,
    cpu: push(state.cpu, tick.cpu.usage),
    memory: push(state.memory, tick.memory.usedPercent),
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start and stop are serialized.
 *
 * The view acquires the stream on mount and releases it on unmount, which under
 * Strict Mode happens as mount/unmount/mount in quick succession. Without a
 * queue those async calls can interleave and leave a poller running with nobody
 * listening — it wakes every second, so that matters.
 */
let queue: Promise<unknown> = Promise.resolve();
let holders = 0;

function enqueue(work: () => Promise<unknown>) {
  queue = queue.then(work, work);
  return queue;
}

/** Keeps the metrics stream alive for as long as at least one caller holds it. */
export function acquire(): () => void {
  holders += 1;
  if (holders === 1) {
    void enqueue(async () => {
      try {
        await statusWatchStart();
      } catch (e) {
        set({ error: message(e) });
      }
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) {
      void enqueue(async () => {
        await statusWatchStop();
        // The trace describes a session of watching; keeping it across a gap
        // would draw a flat line over time that was never sampled.
        set({ cpu: [], memory: [] });
      });
    }
  };
}
