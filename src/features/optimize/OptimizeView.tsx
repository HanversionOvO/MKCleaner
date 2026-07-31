import { useEffect, useState } from "react";
import { Page } from "@/app/Page";
import { Button } from "@/components/Button";
import { formatCount } from "@/lib/format";
import { startOptimize, startScan, useOptimize } from "./store";
import { translateTitle } from "./translate";

export function OptimizeView() {
  const { phase, items, current, error } = useOptimize();

  // How far the run has got: everything before the current section is done.
  const currentIndex =
    phase.name === "optimizing" && current
      ? items.findIndex((item) => item.title === current.title)
      : -1;

  return (
    <Page
      title="优化"
      lede="刷新系统缓存、服务与索引，让 Mac 保持顺畅。"
      actions={
        phase.name === "ready" ? (
          <Button variant="quiet" onClick={() => void startScan()}>
            重新检查
          </Button>
        ) : null
      }
    >
      {error && (
        <p className="selectable mb-5 rounded-card border border-hairline bg-clay-soft px-4 py-3 text-ink">
          {error}
        </p>
      )}

      <div className="relative overflow-hidden rounded-card border border-hairline bg-surface p-7">
        {/* The same clay mist that breathes over the clean card while it works. */}
        {(phase.name === "scanning" || phase.name === "optimizing") && (
          <div className="scan-mist" aria-hidden="true" />
        )}

        {phase.name === "idle" && (
          <div className="flex items-end justify-between gap-6">
            <div>
              <p className="type-label">系统维护</p>
              <p className="mt-1.5 text-ink-muted">
                检查 DNS、Launch Services、Spotlight、内存等 23 项日常维护，全部安全。
              </p>
            </div>
            <Button onClick={() => void startScan()}>开始检查</Button>
          </div>
        )}

        {phase.name === "scanning" && (
          <Header
            label="正在检查"
            count={items.length}
            suffix="项已发现"
            note={current ? translateTitle(current.title) : undefined}
          />
        )}

        {phase.name === "ready" && (
          <Header
            label="将应用这些优化"
            count={items.length}
            suffix="项优化"
            action={<Button onClick={() => void startOptimize()}>开始优化</Button>}
          />
        )}

        {phase.name === "optimizing" && (
          <Header
            label="正在优化"
            count={Math.max(0, currentIndex)}
            suffix={`/ ${items.length} 项`}
            note={current?.detail ?? (current ? translateTitle(current.title) : undefined)}
          />
        )}

        {phase.name === "done" && (
          <Header
            label="优化完成"
            count={phase.summary.items}
            suffix="项已应用"
            cheer
            action={
              <Button variant="secondary" onClick={() => void startScan()}>
                再次检查
              </Button>
            }
          />
        )}
      </div>

      {phase.name !== "idle" && phase.name !== "done" && items.length > 0 && (
        <div className="mt-5">
          <p className="type-label mb-2.5">优化清单</p>
          <ItemList
            items={items}
            currentIndex={phase.name === "optimizing" ? currentIndex : -1}
            detail={phase.name === "optimizing" ? (current?.detail ?? null) : null}
          />
        </div>
      )}

      {phase.name === "optimizing" && (
        <p className="mt-4 text-[12.5px] text-ink-faint">
          部分优化需要管理员权限，系统会弹出授权窗口。
        </p>
      )}
    </Page>
  );
}

/** The card's top line: a counting figure plus the state and its action. */
function Header({
  label,
  count,
  suffix,
  action,
  note,
  cheer = false,
}: {
  label: string;
  count: number;
  suffix: string;
  action?: React.ReactNode;
  note?: string | null;
  /** The count pops once — the quiet cheer when everything is done. */
  cheer?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <p className="type-label">{label}</p>
        <p className="mt-1.5 flex items-baseline gap-2">
          <span className={`type-figure text-[3.4rem] text-ink ${cheer ? "cheer-pop" : ""}`}>
            {formatCount(count)}
          </span>
          <span className="text-[1.05rem] font-medium text-ink-muted">{suffix}</span>
        </p>
        {note && <p className="mt-1 text-ink-faint">{note}</p>}
      </div>
      <div className="flex items-center gap-2">{action}</div>
    </div>
  );
}

type RowState = "pending" | "active" | "done";

/**
 * The checklist as a cast with a lifecycle: pending rows wait, the current
 * row glows, and finished rows wear their check for a moment before drifting
 * away like smoke (`.optimize-item-done`) and leaving the list.
 */
function ItemList({
  items,
  currentIndex,
  detail,
}: {
  items: { title: string; details: string[] }[];
  /** Index of the section the engine is on, or -1 when not running. */
  currentIndex: number;
  detail: string | null;
}) {
  const [rows, setRows] = useState<{ item: (typeof items)[number]; state: RowState }[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (title: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  // A fresh scan starts a fresh cast.
  useEffect(() => {
    setRows(items.map((item) => ({ item, state: "pending" as const })));
    setOpen(new Set());
  }, [items]);

  // As the engine moves past a section, its row is marked done, plays the
  // smoke exit, then leaves the list; the row the engine is on glows.
  useEffect(() => {
    if (currentIndex < 0) return;
    const doneTitles = new Set(items.slice(0, currentIndex).map((i) => i.title));
    const activeTitle = items[currentIndex]?.title;
    setRows((prev) =>
      prev.map((row) => {
        if (doneTitles.has(row.item.title)) {
          return row.state === "done" ? row : { ...row, state: "done" };
        }
        if (row.item.title === activeTitle) {
          return { ...row, state: "active" };
        }
        return row.state === "active" ? { ...row, state: "pending" } : row;
      }),
    );
    const timer = setTimeout(
      () => setRows((prev) => prev.filter((row) => row.state !== "done")),
      700,
    );
    return () => clearTimeout(timer);
  }, [currentIndex, items]);

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      {rows.map((row, i) => {
        const { item, state } = row;
        const active = state === "active";
        const done = state === "done";
        return (
          <div
            key={item.title}
            className={`transition-colors duration-[var(--fast)] ease-[var(--ease)] ${
              i === 0 ? "" : "border-t border-hairline"
            } ${active ? "bg-[color-mix(in_srgb,var(--clay-soft)_40%,transparent)]" : ""} ${
              done ? "optimize-item-done" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(item.title)}
              aria-expanded={open.has(item.title)}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left"
            >
              {done ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  aria-hidden="true"
                  className="shrink-0 text-clay"
                >
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.3" />
                  <path
                    d="M4 6.6 5.9 8.5 9.2 4.9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : active ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-clay"
                  aria-hidden="true"
                />
              ) : (
                <span
                  className="h-1 w-1 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--ink)_25%,transparent)]"
                  aria-hidden="true"
                />
              )}

              <span
                className={`min-w-0 flex-1 truncate font-medium transition-colors duration-[var(--fast)] ${
                  done ? "text-ink-faint" : "text-ink"
                }`}
              >
                {translateTitle(item.title)}
              </span>

              {active && detail && (
                <span className="min-w-0 flex-1 truncate text-right text-[12px] text-ink-faint">
                  {detail}
                </span>
              )}

              {!active && !done && <Chevron open={open.has(item.title)} />}
            </button>

            {open.has(item.title) && (
              <ul className="fade-in border-t border-hairline bg-[color-mix(in_srgb,var(--sunken)_55%,transparent)] px-5 py-1.5">
                {item.details.map((line, j) => (
                  <li
                    key={j}
                    className="py-[3px] text-[12.5px] text-ink-muted"
                    style={{ color: line.startsWith("✓") ? "var(--ink-faint)" : undefined }}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      className="shrink-0 text-ink-faint transition-transform duration-[var(--fast)] ease-[var(--ease)]"
      style={{ transform: open ? "rotate(90deg)" : "none" }}
    >
      <path
        d="M3 1.6 6.2 4.5 3 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
