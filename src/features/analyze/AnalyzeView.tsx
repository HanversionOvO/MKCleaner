import { useEffect, type MouseEvent } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Page } from "@/app/Page";
import { Button } from "@/components/Button";
import { formatBytes, formatCount, shortenPath, splitBytes } from "@/lib/format";
import type { Analysis } from "@/lib/ipc";
import { onMenuReveal, showTileMenu } from "@/lib/ipc";
import { Treemap } from "./Treemap";
import { drillInto, goTo, open, reload, useAnalyze, type Crumb } from "./store";

export function AnalyzeView() {
  const { crumbs, current, loading, error } = useAnalyze();

  useEffect(() => {
    open();
  }, []);

  const reveal = (path: string) => {
    void revealItemInDir(path);
  };

  // A native menu is popped at the cursor by Rust; its one item comes back
  // here as the reveal event.
  useEffect(() => {
    const off = onMenuReveal(reveal);
    return () => {
      off.then((unlisten) => unlisten());
    };
  }, []);

  const onContext = (_x: number, _y: number, path: string) => {
    void showTileMenu(path);
  };

  return (
    <Page
      title="空间"
      lede="看清磁盘被什么占满，逐层下钻。"
      actions={
        current ? (
          <Button variant="quiet" onClick={reload}>
            重新扫描
          </Button>
        ) : null
      }
      toolbar={<Breadcrumbs crumbs={crumbs} onJump={goTo} />}
    >
      {error && (
        <p className="selectable mb-5 rounded-card border border-hairline bg-clay-soft px-4 py-3 text-ink">
          {error}
        </p>
      )}

      {loading && !current && (
        <div className="mt-4 rounded-card border border-hairline bg-surface px-6 py-10 text-center text-ink-faint">
          正在统计…
        </div>
      )}

      {current && (
        <div className="mt-4 flex flex-col gap-5">
          {current.overview ? (
            <Overview current={current} onContext={onContext} />
          ) : (
            <Level current={current} onReveal={reveal} onContext={onContext} />
          )}
          <LargeFiles current={current} onReveal={reveal} />
        </div>
      )}
    </Page>
  );
}

/**
 * The curated top level.
 *
 * Deliberately not a treemap. These entries overlap — User Library sits inside
 * Home, Xcode Simulators inside User Library — so they are a list of places
 * worth looking, not a partition of the disk. Drawing them as areas would claim
 * they are disjoint, and the engine's `total_size` for this view is a naive sum
 * that counts the same bytes several times, so neither is shown.
 */
function Overview({
  current,
  onContext,
}: {
  current: Analysis;
  onContext: (x: number, y: number, path: string) => void;
}) {
  const largest = Math.max(...current.entries.map((e) => e.size), 1);

  return (
    <section>
      <p className="type-label mb-2.5">这些地方值得看看</p>
      <div className="overflow-hidden rounded-card border border-hairline bg-surface">
        {current.entries.map((entry, i) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => drillInto(entry)}
            onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
              e.preventDefault();
              onContext(e.clientX, e.clientY, entry.path);
            }}
            className={[
              "flex w-full items-center gap-4 px-5 py-3 text-left transition-colors",
              "duration-[var(--fast)] ease-[var(--ease)] hover:bg-sunken",
              i === 0 ? "" : "border-t border-hairline",
            ].join(" ")}
          >
            <span className="w-[13rem] shrink-0 truncate font-medium">
              {entry.name}
              {entry.insight && <Insight />}
            </span>
            <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
              <span
                className="block h-full rounded-full bg-clay"
                style={{ width: `${(entry.size / largest) * 100}%` }}
              />
            </span>
            <span className="type-data w-20 shrink-0 text-right text-ink-muted">
              {formatBytes(entry.size)}
            </span>
            <Chevron />
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-ink-faint">
        这些位置互有包含关系（例如「用户资源库」在「个人文件夹」里），所以不做总计。
      </p>
    </section>
  );
}

/** A real directory: its children do partition it, so a treemap is honest here. */
function Level({
  current,
  onReveal,
  onContext,
}: {
  current: Analysis;
  onReveal: (path: string) => void;
  onContext: (x: number, y: number, path: string) => void;
}) {
  const { value, unit } = splitBytes(current.totalSize);

  return (
    <section className="relative z-10 rounded-card border border-hairline bg-surface p-6">
      <div className="flex items-end justify-between gap-6">
        <p className="flex items-baseline gap-2">
          <span className="type-figure text-[2.4rem] text-ink">{value}</span>
          <span className="font-medium text-ink-muted">{unit}</span>
        </p>
        <p className="text-ink-muted">
          {current.entries.length > 0 && `${formatCount(current.entries.length)} 项`}
          {current.totalFiles > 0 && ` · ${formatCount(current.totalFiles)} 个文件`}
        </p>
      </div>

      {current.entries.length > 0 ? (
        <div className="mt-5">
          <Treemap
            entries={current.entries}
            onOpen={drillInto}
            onReveal={onReveal}
            onContext={onContext}
          />
          <p className="mt-3 text-[12.5px] text-ink-faint">
            点击文件夹继续下钻，右键在访达中打开。
          </p>
        </div>
      ) : (
        <p className="mt-4 text-ink-faint">这里是空的。</p>
      )}
    </section>
  );
}

/**
 * The path, living in the page's top bar. It is part of the bar — the bar's
 * frosted backing covers it when content scrolls, so it needs no backing of
 * its own.
 */
function Breadcrumbs({ crumbs, onJump }: { crumbs: Crumb[]; onJump: (i: number) => void }) {
  return (
    <nav aria-label="路径" className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span
            key={`${crumb.path ?? "root"}-${i}`}
            className="fade-in flex items-center gap-1.5"
          >
            {i > 0 && <span className="text-ink-faint">›</span>}
            <button
              type="button"
              disabled={last}
              onClick={() => onJump(i)}
              className={
                last
                  ? "font-medium text-ink"
                  : "text-ink-muted transition-colors duration-[var(--fast)] hover:text-clay"
              }
            >
              {crumb.label}
            </button>
            {/* How much of its parent this branch turned out to be — the number
                that tells you whether you have drilled somewhere that matters. */}
            {crumb.share !== null && (
              <span className="type-data text-[11.5px] text-ink-faint">
                {(crumb.share * 100).toFixed(0)}%
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function LargeFiles({
  current,
  onReveal,
}: {
  current: Analysis;
  onReveal: (path: string) => void;
}) {
  if (current.largeFiles.length === 0) return null;

  return (
    <section>
      <p className="type-label mb-2.5">最大的单个文件</p>
      <div className="overflow-hidden rounded-card border border-hairline bg-surface">
        {current.largeFiles.map((file, i) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onReveal(file.path)}
            title="在访达中显示"
            className={[
              "flex w-full items-center gap-4 px-5 py-2.5 text-left transition-colors",
              "duration-[var(--fast)] ease-[var(--ease)] hover:bg-sunken",
              i === 0 ? "" : "border-t border-hairline",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{file.name}</span>
              <span className="block truncate text-[11.5px] text-ink-faint" dir="rtl">
                <span dir="ltr">{shortenPath(dirname(file.path), current.home)}</span>
              </span>
            </span>
            <span className="type-data shrink-0 text-ink-muted">{formatBytes(file.size)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The engine flagged this as somewhere worth cleaning. */
function Insight() {
  return (
    <span
      title="可以清理"
      className="ml-1.5 inline-block h-[5px] w-[5px] rounded-full bg-clay align-middle"
    />
  );
}

function Chevron() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      className="shrink-0 text-ink-faint"
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

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : path;
}
