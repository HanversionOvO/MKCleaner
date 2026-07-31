import { useEffect, useMemo, useState } from "react";
import { Page } from "@/app/Page";
import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { formatBytes, formatCount, splitBytes } from "@/lib/format";
import type { App, Preview, UninstallSummary } from "@/lib/ipc";
import {
  backToList,
  clearSelection,
  load,
  preview,
  remove,
  selectedBytes,
  setFilter,
  toggle,
  useUninstall,
  visible,
} from "./store";
import { useAppIcon } from "./useAppIcon";

export function UninstallView() {
  const state = useUninstall();
  const { step, loading, error, selected, filter } = state;

  useEffect(() => {
    void load();
  }, []);

  const apps = useMemo(() => visible(state), [state]);
  const bytes = useMemo(() => selectedBytes(state), [state]);

  return (
    <Page
      title="卸载"
      lede="彻底移除应用，连同它留下的文件。"
      actions={
        step.name === "list" && !loading ? (
          <Button variant="quiet" onClick={() => void load({ fresh: true })}>
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

      {step.name === "list" && (
        <>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            placeholder="搜索应用"
            className="selectable mb-4 w-full rounded-control border border-hairline bg-surface px-3.5 py-2 outline-none placeholder:text-ink-faint focus:border-clay"
          />

          {loading && apps.length === 0 ? (
            <Empty>正在读取已安装的应用…</Empty>
          ) : apps.length === 0 ? (
            <Empty>没有匹配的应用。</Empty>
          ) : (
            <div className="overflow-hidden rounded-card border border-hairline bg-surface">
              {apps.map((app, i) => (
                <Row
                  key={app.path}
                  app={app}
                  checked={selected.has(app.uninstallName)}
                  onToggle={() => toggle(app.uninstallName)}
                  first={i === 0}
                />
              ))}
            </div>
          )}

          {/* Always mounted, so clearing the selection can play the exit
              animation instead of vanishing. */}
          <SelectionBar count={selected.size} bytes={bytes} />
        </>
      )}

      {step.name === "previewing" && <Empty>正在确认要删除的文件…</Empty>}

      {step.name === "preview" && <Confirm preview={step.preview} />}

      {step.name === "removing" && <Empty>正在移到废纸篓…</Empty>}

      {step.name === "done" && <Done summary={step.summary} />}
    </Page>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-hairline bg-surface px-6 py-10 text-center text-ink-faint">
      {children}
    </div>
  );
}

function Row({
  app,
  checked,
  onToggle,
  first,
}: {
  app: App;
  checked: boolean;
  onToggle: () => void;
  first: boolean;
}) {
  const icon = useAppIcon(app.path);

  return (
    <div
      className={`flex items-center gap-3.5 px-4 py-2.5 ${first ? "" : "border-t border-hairline"}`}
    >
      <Checkbox checked={checked} onChange={onToggle} label={`选择 ${app.name}`} />
      <div className="grid h-7 w-7 shrink-0 place-items-center">
        {icon ? (
          <img src={icon} alt="" className="h-7 w-7" />
        ) : (
          <span className="h-7 w-7 rounded-[6px] bg-sunken" />
        )}
      </div>
      <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium">{app.name}</span>
        <span className="selectable block truncate text-[11.5px] text-ink-faint">
          {app.bundleId}
        </span>
      </button>
      <span className="type-data shrink-0 text-ink-muted">
        {app.bytes === null ? "—" : formatBytes(app.bytes)}
      </span>
    </div>
  );
}

function SelectionBar({ count, bytes }: { count: number; bytes: number }) {
  // Stays mounted while the selection is cleared so the exit animation plays,
  // then truly unmounts a beat later.
  const [hidden, setHidden] = useState(count === 0);

  useEffect(() => {
    if (count > 0) {
      setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), 280);
    return () => clearTimeout(timer);
  }, [count]);

  if (hidden) return null;
  const leaving = count === 0;

  return (
    <div
      className={`${leaving ? "rise-out" : "rise-in"} sticky bottom-0 mt-4 flex items-center justify-between gap-4 rounded-card border border-hairline bg-glass px-5 py-3 shadow-[0_-1px_12px_color-mix(in_srgb,var(--ink)_6%,transparent)] backdrop-blur-[16px]`}
    >
      <p className="text-ink-muted">
        已选 <span className="type-data text-ink">{formatCount(count)}</span> 个应用
        {bytes > 0 && <> · 约 <span className="type-data text-ink">{formatBytes(bytes)}</span></>}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="quiet" onClick={clearSelection}>
          取消选择
        </Button>
        <Button onClick={() => void preview()}>查看将删除的文件</Button>
      </div>
    </div>
  );
}

/**
 * The last stop before anything is deleted.
 *
 * Every path here comes from a real dry run of the same command that is about
 * to execute, so this is what will happen rather than a summary of it.
 */
function Confirm({ preview }: { preview: Preview }) {
  return (
    <>
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="type-label">将删除这些文件</p>
          <p className="mt-1.5 text-ink-muted">
            {formatCount(preview.apps.length)} 个应用 · {formatBytes(preview.bytes)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="quiet" onClick={backToList}>
            返回
          </Button>
          <Button onClick={() => void remove()}>移到废纸篓</Button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {preview.apps.map((app) => (
          <section
            key={app.name}
            className="overflow-hidden rounded-card border border-hairline bg-surface"
          >
            <div className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-3">
              <span className="font-medium">{app.name}</span>
              <span className="type-data text-ink-muted">{formatBytes(app.bytes)}</span>
            </div>
            <ul>
              {app.items.map((item) => (
                <li
                  key={item.path}
                  className="flex items-center gap-4 px-5 py-2 text-[12.5px]"
                >
                  <span className="selectable min-w-0 flex-1 truncate text-ink-muted" dir="rtl">
                    <span dir="ltr">{item.path}</span>
                  </span>
                  <span className="type-data shrink-0 text-ink-faint">
                    {item.bytes === null ? "" : formatBytes(item.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-4 text-[12.5px] text-ink-faint">
        文件会移到废纸篓，清空前都可以恢复。部分应用需要管理员权限，届时系统会弹出授权窗口。
      </p>
    </>
  );
}

function Done({ summary }: { summary: UninstallSummary }) {
  const { value, unit } = splitBytes(summary.freedBytes);
  return (
    <div className="rounded-card border border-hairline bg-surface p-7">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="type-label">已移到废纸篓</p>
          <p className="mt-1.5 flex items-baseline gap-2">
            <span className="type-figure text-[2.4rem] text-ink">{value}</span>
            <span className="font-medium text-ink-muted">{unit}</span>
          </p>
          <p className="mt-2 text-ink-muted">
            {formatCount(summary.items)} 项
            {summary.failed > 0 && (
              <span className="text-rust"> · {formatCount(summary.failed)} 项未能删除</span>
            )}
          </p>
        </div>
        <Button variant="secondary" onClick={backToList}>
          返回列表
        </Button>
      </div>
      <p className="mt-5 text-[12.5px] text-ink-faint">
        清空废纸篓后才会真正释放空间。
      </p>
    </div>
  );
}
