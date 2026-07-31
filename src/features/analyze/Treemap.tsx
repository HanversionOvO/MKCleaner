import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import type { AnalyzeEntry } from "@/lib/ipc";
import { squarify } from "./squarify";

/** Beyond this the tail is slivers nobody can read or hit. */
const SHOWN = 14;

type Props = {
  entries: AnalyzeEntry[];
  onOpen: (entry: AnalyzeEntry) => void;
  /** Left-click on a file tile: reveal it in Finder. */
  onReveal: (path: string) => void;
  /** Right-click on a tile, with its screen position and path. */
  onContext: (x: number, y: number, path: string) => void;
};

export function Treemap({ entries, onOpen, onReveal, onContext }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The long tail is folded into one block so it still accounts for its space
  // without becoming unreadable.
  const shown = useMemo(() => {
    if (entries.length <= SHOWN) return entries;
    const head = entries.slice(0, SHOWN);
    const rest = entries.slice(SHOWN);
    const restSize = rest.reduce((sum, e) => sum + e.size, 0);
    if (restSize <= 0) return head;
    return [
      ...head,
      {
        name: `其余 ${rest.length} 项`,
        path: "",
        size: restSize,
        isDir: false,
        insight: false,
      } satisfies AnalyzeEntry,
    ];
  }, [entries]);

  const tiles = useMemo(
    () => squarify(shown, (e) => e.size, { x: 0, y: 0, w: size.w, h: size.h }),
    [shown, size],
  );

  return (
    <div ref={box} className="relative h-[320px] w-full">
      {tiles.map(({ item, x, y, w, h }, rank) => {
        const aggregate = item.path === "";
        const roomy = w >= 74 && h >= 36;

        return (
          <button
            key={item.path || item.name}
            type="button"
            disabled={aggregate}
            title={`${item.name} · ${formatBytes(item.size)}`}
            onClick={() => {
              if (aggregate) return;
              if (item.isDir) onOpen(item);
              else onReveal(item.path);
            }}
            onContextMenu={(e) => {
              if (aggregate) return;
              e.preventDefault();
              onContext(e.clientX, e.clientY, item.path);
            }}
            style={{
              left: x,
              top: y,
              width: Math.max(0, w - 2),
              height: Math.max(0, h - 2),
              background: tint(rank, tiles.length, aggregate),
            }}
            className={[
              "absolute overflow-hidden rounded-[5px] px-2 py-1.5 text-left",
              // Geometry transitions too, so blocks grow and reorder smoothly
              // while the scan measures them live.
              "transition-[left,top,width,height,box-shadow] duration-[320ms] ease-[var(--ease)]",
              aggregate
                ? "cursor-default"
                : "hover:shadow-[inset_0_0_0_1.5px_var(--clay)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--clay)]",
            ].join(" ")}
          >
            {roomy && (
              <>
                <span className="block truncate font-medium leading-tight text-ink">
                  {item.name}
                  {item.insight && <Insight />}
                </span>
                <span className="type-data block truncate text-[11.5px] text-ink-muted">
                  {formatBytes(item.size)}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tint by rank, over the sunken surface.
 *
 * The range stops well short of full clay so that `--ink` stays legible on
 * every tile in both themes — a treemap that needs two text colours to be
 * readable is a treemap with too much colour in it.
 */
function tint(rank: number, count: number, aggregate: boolean): string {
  if (aggregate) return "var(--sunken)";
  const t = count <= 1 ? 1 : 1 - rank / (count - 1);
  const pct = 12 + t * 46;
  return `color-mix(in srgb, var(--clay) ${pct.toFixed(1)}%, var(--sunken))`;
}

/** The engine flagged this as somewhere worth cleaning. */
function Insight() {
  return (
    <span
      title="可以清理"
      className="ml-1.5 inline-block h-[5px] w-[5px] rounded-full align-middle bg-clay"
    />
  );
}
