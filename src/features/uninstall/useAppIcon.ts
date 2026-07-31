import { useEffect, useState } from "react";
import { appIcon } from "@/lib/ipc";

/**
 * App icons, fetched once per path and kept for the session.
 *
 * Rust already caches the rendered PNG; this avoids even the round trip when a
 * row re-renders or the view is revisited.
 */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function fetchIcon(path: string): Promise<string | null> {
  const existing = inflight.get(path);
  if (existing) return existing;

  const request = appIcon(path)
    .catch(() => null)
    .then((icon) => {
      cache.set(path, icon);
      inflight.delete(path);
      return icon;
    });

  inflight.set(path, request);
  return request;
}

export function useAppIcon(path: string): string | null {
  const [icon, setIcon] = useState<string | null>(() => cache.get(path) ?? null);

  useEffect(() => {
    if (cache.has(path)) {
      setIcon(cache.get(path) ?? null);
      return;
    }
    let live = true;
    void fetchIcon(path).then((next) => {
      if (live) setIcon(next);
    });
    return () => {
      live = false;
    };
  }, [path]);

  return icon;
}
