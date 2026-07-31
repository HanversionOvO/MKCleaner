import { useEffect, useMemo, useState } from "react";
import { Page } from "@/app/Page";
import { Button } from "@/components/Button";
import { FadeIn } from "@/components/FadeIn";
import { formatBytes, formatCount, shortenPath } from "@/lib/format";
import type { CleanHistoryEntry, CleanScan, CleanSummary, DiskSummary } from "@/lib/ipc";
import { CapacityBar } from "./CapacityBar";
import { CategoryList } from "./CategoryList";
import { categoryName } from "./categories";
import { Figure } from "./Figure";
import { refreshDisk, selection, startClean, startScan, toggle, useClean } from "./store";

export function CleanView() {
  const state = useClean();
  const { phase, scan, excluded, disk, error } = state;

  // The capacity bar needs the disk once. Re-read it if we arrive without it,
  // for example after the engine was unavailable at launch.
  useEffect(() => {
    if (!disk) void refreshDisk();
  }, [disk]);

  const selected = useMemo(() => selection(state), [state]);
  const busy = phase.name === "scanning" || phase.name === "cleaning";

  return (
    <Page
      title="清理"
      lede="扫描可以安全回收的缓存、日志和临时文件。"
      actions={
        scan && !busy ? (
          <Button variant="quiet" onClick={() => void startScan()}>
            重新扫描
          </Button>
        ) : null
      }
    >
      {error && (
        <p className="selectable mb-5 rounded-card border border-hairline bg-clay-soft px-4 py-3 text-ink">
          {error}
        </p>
      )}

      <div
        className={[
          "relative overflow-hidden rounded-card border border-hairline bg-surface p-7 transition-colors duration-[var(--slow)]",
          // While cleanup runs the card warms — a clay wash, not a colour
          // swap, and it recedes the moment the work is done.
          phase.name === "cleaning" &&
            "bg-[color-mix(in_srgb,var(--clay-soft)_45%,var(--surface))]",
        ].join(" ")}
      >
        {/* A clay mist breathes over the card for the whole scan. */}
        {phase.name === "scanning" && <div className="scan-mist" aria-hidden="true" />}

        <FadeIn key={phase.name}>
          {phase.name === "idle" && <Idle disk={disk} />}

          {phase.name === "scanning" && <Scanning section={phase.section} disk={disk} />}

          {phase.name === "ready" && scan && (
            <>
              <div className="flex items-end justify-between gap-6">
                <div>
                  <Figure bytes={selected.bytes} label="可回收" />
                  <p className="mt-2 text-ink-muted">
                    {formatCount(selected.count)} 项 · {scan.categories.length} 个分类
                    {excluded.size > 0 && ` · 已跳过 ${formatCount(excluded.size)} 项`}
                  </p>
                </div>
                <Button onClick={() => void startClean()} disabled={selected.count === 0}>
                  开始清理
                </Button>
              </div>
              {disk && (
                <div className="mt-7">
                  <CapacityBar total={disk.total} used={disk.used} reclaimable={selected.bytes} />
                </div>
              )}
            </>
          )}

          {(phase.name === "cleaning" || phase.name === "completing") && (
            <div className={phase.name === "completing" ? "exit-fade" : ""}>
              <Cleaning
                freed={phase.freed}
                done={phase.done}
                total={scan?.itemCount ?? 0}
                removed={phase.removed}
                scan={scan}
              />
            </div>
          )}

          {phase.name === "done" && <Done summary={phase.summary} disk={disk} />}
        </FadeIn>
      </div>

      {phase.name === "ready" && scan && (
        <div className="mt-5">
          <p className="type-label mb-2.5">按分类查看</p>
          <CategoryList
            categories={scan.categories}
            excluded={excluded}
            onToggle={(paths, exclude) => void toggle(paths, exclude)}
            home={scan.home}
          />
          <p className="mt-3 text-[12.5px] text-ink-faint">
            取消勾选的路径会写入 Mole 白名单，之后的清理都会跳过它们。
          </p>
        </div>
      )}

      <History entries={state.history} />
    </Page>
  );
}

function Idle({ disk }: { disk: DiskSummary | null }) {
  return (
    <>
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="type-label">启动磁盘</p>
          <p className="mt-1.5 text-ink-muted">扫描不会删除任何东西，你会先看到完整清单。</p>
        </div>
        <Button onClick={() => void startScan()}>开始扫描</Button>
      </div>
      {disk && (
        <div className="mt-7">
          <CapacityBar total={disk.total} used={disk.used} reclaimable={0} />
        </div>
      )}
    </>
  );
}

function Scanning({ section, disk }: { section: string; disk: DiskSummary | null }) {
  return (
    <>
      <div>
        <p className="type-label">正在扫描</p>
        {section ? (
          <ScanName key={section} name={section} />
        ) : (
          <p className="mt-1.5 text-ink-muted">读取磁盘…</p>
        )}
      </div>

      {disk && (
        <div className="mt-7 opacity-55">
          <CapacityBar total={disk.total} used={disk.used} reclaimable={0} />
        </div>
      )}
    </>
  );
}

/**
 * One line: 检查 {name}…, always in the same place.
 *
 * When the engine moves to the next directory, the old name dissolves in a
 * swell of gaussian blur instead of the line growing — the next name fades in
 * exactly where it was.
 */
function ScanName({ name }: { name: string }) {
  // The previous name is kept just long enough to play its dissolve, then
  // dropped. Holding it here (rather than keying the text span) is what lets
  // the old and new names overlap in place.
  const [leaving, setLeaving] = useState<string | null>(null);
  const [shown, setShown] = useState(name);

  useEffect(() => {
    if (name === shown) return;
    setLeaving(shown);
    setShown(name);
    const timer = setTimeout(() => setLeaving(null), 520);
    return () => clearTimeout(timer);
  }, [name, shown]);

  return (
    <p className="mt-1.5 text-ink-muted">
      检查
      <span className="relative inline-block">
        {leaving && (
          <span className="scan-name-leaving" aria-hidden="true">
            {leaving}
          </span>
        )}
        <span className="fade-in inline-block">{shown}</span>
      </span>
      …
    </p>
  );
}

function Cleaning({
  freed,
  done,
  total,
  removed,
  scan,
}: {
  freed: number;
  done: number;
  total: number;
  removed: string[];
  scan: CleanScan | null;
}) {
  // The whole checklist starts visible; an entry is struck the moment the
  // engine removes a file inside it, and fades away.
  const handled = useMemo(() => {
    const set = new Set<string>();
    if (!scan) return set;
    for (const path of removed) {
      for (const category of scan.categories) {
        for (const item of category.items) {
          if (
            !set.has(item.path) &&
            (path === item.path || path.startsWith(`${item.path}/`))
          ) {
            set.add(item.path);
          }
        }
      }
    }
    return set;
  }, [removed, scan]);

  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;

  return (
    <>
      <div className="flex items-end justify-between gap-6">
        <div>
          <Figure bytes={freed} label="正在释放" />
          <p className="type-data mt-2 text-ink-muted">
            已处理 {formatCount(done)} / {formatCount(total)} 项
          </p>
        </div>
      </div>

      <div className="mt-7 h-[9px] w-full overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full bg-clay transition-[width] duration-[var(--fast)] ease-[var(--ease)]"
          style={{ width: `${pct}%` }}
        />
      </div>

      {scan && <CleanList scan={scan} handled={handled} home={scan.home} />}
    </>
  );
}

/**
 * The scan's checklist, still complete when the cleanup starts. Each entry
 * the engine finishes with dims and recedes; the list empties as the run
 * proceeds.
 */
function CleanList({
  scan,
  handled,
  home,
}: {
  scan: CleanScan;
  handled: Set<string>;
  home: string;
}) {
  return (
    <div className="mt-6 overflow-hidden rounded-card border border-hairline bg-surface">
      {scan.categories.map((category, i) => {
        const remaining = category.items.filter((item) => !handled.has(item.path)).length;
        return (
          <section key={category.name} className={i === 0 ? "" : "border-t border-hairline"}>
            <div className="flex items-baseline gap-2.5 px-5 py-2.5">
              <span className="font-medium">{categoryName(category.name)}</span>
              <span className="type-data text-ink-faint">{remaining} 项</span>
            </div>
            <ul>
              {category.items.map((item) => (
                <li
                  key={item.path}
                  className={
                    handled.has(item.path)
                      ? "clean-item-done"
                      : "flex items-center gap-4 px-5 py-[5px] text-[12.5px]"
                  }
                >
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      handled.has(item.path) ? "" : "text-ink-muted"
                    }`}
                    dir="rtl"
                  >
                    <span dir="ltr">{shortenPath(item.path, home)}</span>
                  </span>
                  <span
                    className={`type-data shrink-0 ${
                      handled.has(item.path) ? "" : "text-ink-faint"
                    }`}
                  >
                    {formatBytes(item.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The last few cleanups, from the engine's own history. Keeps the space below
 * the scan card purposeful between scans.
 */
function History({ entries }: { entries: CleanHistoryEntry[] | null }) {
  if (!entries) return null;

  return (
    <section className="mt-6">
      <p className="type-label mb-2.5">最近清理</p>
      <div className="overflow-hidden rounded-card border border-hairline bg-surface">
        {entries.length === 0 ? (
          <p className="px-5 py-4 text-ink-faint">还没有清理记录。</p>
        ) : (
          entries.slice(0, 3).map((entry, i) => (
            <div
              key={`${entry.startedAt}-${entry.command}`}
              className={`flex items-center gap-4 px-5 py-2.5 ${i === 0 ? "" : "border-t border-hairline"}`}
            >
              <span className="w-8 shrink-0 text-ink-muted">
                {entry.command === "clean" ? "清理" : "卸载"}
              </span>
              <span className="type-data min-w-0 flex-1 text-ink-muted">
                {formatCount(entry.items)} 项
              </span>
              <span className="type-data shrink-0 text-ink">{formatBytes(entry.bytes)}</span>
              <span className="type-data w-[9.5rem] shrink-0 text-right text-ink-faint">
                {shortWhen(entry.startedAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** `2026-07-31 23:27:48` → `07-31 23:27`. */
function shortWhen(timestamp: string): string {
  const match = /^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/.exec(timestamp);
  return match ? `${match[1]} ${match[2]}` : timestamp;
}

function Done({ summary, disk }: { summary: CleanSummary; disk: DiskSummary | null }) {
  return (
    <>
      <div className="flex items-end justify-between gap-6">
        <div>
          <Figure bytes={summary.freedBytes} label="已释放" />
          <p className="mt-2 text-ink-muted">
            清理 {formatCount(summary.items)} 项
            {summary.skipped > 0 && ` · 跳过 ${formatCount(summary.skipped)} 项`}
            {summary.failed > 0 && (
              <span className="text-rust"> · {formatCount(summary.failed)} 项未能删除</span>
            )}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void startScan()}>
          再次扫描
        </Button>
      </div>
      {disk && (
        <div className="mt-7">
          <CapacityBar total={disk.total} used={disk.used} reclaimable={0} />
        </div>
      )}
    </>
  );
}
