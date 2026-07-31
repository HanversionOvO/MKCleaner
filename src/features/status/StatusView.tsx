import { useEffect } from "react";
import { Page } from "@/app/Page";
import { formatBytes, formatCount } from "@/lib/format";
import type { Tick } from "@/lib/ipc";
import { Trace } from "./Trace";
import { acquire, useStatus } from "./store";

const WINDOW = 60;

export function StatusView() {
  const { tick, cpu, memory, error } = useStatus();

  // The engine polls the system every second; hold the stream only while this
  // view is on screen.
  useEffect(() => acquire(), []);

  return (
    <Page
      title="状态"
      lede="实时查看 CPU、内存、磁盘和电池。"
      actions={tick ? <Live /> : null}
    >
      {error && (
        <p className="selectable mb-5 rounded-card border border-hairline bg-clay-soft px-4 py-3 text-ink">
          {error}
        </p>
      )}

      {!tick ? (
        <div className="rounded-card border border-hairline bg-surface px-6 py-10 text-center text-ink-faint">
          正在读取系统指标…
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Identity tick={tick} />
          <Activity tick={tick} cpu={cpu} memory={memory} />
          <div className="grid grid-cols-3 gap-5">
            <BootDisk tick={tick} />
            <BatteryCard tick={tick} />
            <NetworkCard tick={tick} />
          </div>
          <Processes tick={tick} />
        </div>
      )}
    </Page>
  );
}

function Live() {
  return (
    <span className="flex items-center gap-2 text-ink-faint">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-clay" aria-hidden="true" />
      实时
    </span>
  );
}

function Card({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-card border border-hairline bg-surface p-5 ${className}`}>
      <p className="type-label">{label}</p>
      {children}
    </section>
  );
}

function Identity({ tick }: { tick: Tick }) {
  const { model, cpuModel, totalRam, osVersion } = tick.hardware;
  const specs = [model, cpuModel, totalRam, osVersion].filter(Boolean).join(" · ");

  return (
    <section className="rounded-card border border-hairline bg-surface px-5 py-4">
      <p className="font-medium text-ink">{specs || "这台 Mac"}</p>
      <p className="mt-1 text-ink-muted">
        已运行 {tick.uptime} · {formatCount(tick.procs)} 个进程 · 健康度{" "}
        <span className="type-data text-ink">{tick.healthScore}</span>
        {tick.healthScoreMsg && ` ${tick.healthScoreMsg}`}
      </p>
    </section>
  );
}

/**
 * The one thing in the app that moves.
 *
 * CPU and memory share an axis because both are percentages of the same
 * machine, and together they answer the only question this view exists for:
 * how hard is it working right now, and is that new. CPU is the volatile
 * series so it gets the weight; memory is the steady one and stays a hairline.
 */
function Activity({ tick, cpu, memory }: { tick: Tick; cpu: number[]; memory: number[] }) {
  const cores = tick.cpu;

  return (
    <section className="rounded-card border border-hairline bg-surface p-6">
      <div className="flex items-start justify-between gap-6">
        <div className="flex gap-10">
          <Reading label="CPU" value={tick.cpu.usage} swatch="bg-clay" />
          <Reading label="内存" value={tick.memory.usedPercent} swatch="bg-ink-faint" />
        </div>
        <p className="type-label pt-1">近 60 秒</p>
      </div>

      <Trace
        className="mt-5 h-[92px] w-full"
        capacity={WINDOW}
        series={[
          {
            points: memory,
            stroke: "color-mix(in srgb, var(--ink) 30%, transparent)",
            width: 1,
          },
          {
            points: cpu,
            stroke: "var(--clay)",
            fill: "color-mix(in srgb, var(--clay) 12%, transparent)",
            width: 1.6,
          },
        ]}
      />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t border-hairline pt-4">
        <CoreBars values={cores.perCore} />
        <p className="text-ink-muted">
          {cores.coreCount > 0 && `${cores.coreCount} 核`}
          {cores.pCoreCount > 0 &&
            cores.eCoreCount > 0 &&
            `（${cores.pCoreCount} 性能 + ${cores.eCoreCount} 能效）`}
          {" · 负载 "}
          <span className="type-data text-ink">{cores.load1.toFixed(2)}</span>
        </p>
        <p className="text-ink-muted">
          内存 <span className="type-data text-ink">{formatBytes(tick.memory.used)}</span> /{" "}
          {formatBytes(tick.memory.total)}
          {tick.memory.cached > 0 && ` · 缓存 ${formatBytes(tick.memory.cached)}`}
          {tick.memory.swapUsed > 0 && ` · 交换 ${formatBytes(tick.memory.swapUsed)}`}
        </p>
      </div>
    </section>
  );
}

function Reading({ label, value, swatch }: { label: string; value: number; swatch: string }) {
  return (
    <div>
      <p className="flex items-center gap-2 type-label">
        <span className={`h-2 w-2 rounded-[2.5px] ${swatch}`} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="type-figure text-[2.1rem] text-ink">{value.toFixed(1)}</span>
        <span className="font-medium text-ink-muted">%</span>
      </p>
    </div>
  );
}

/**
 * Per-core load in the engine's own index order.
 *
 * Deliberately not grouped into performance and efficiency clusters: the engine
 * reports how many of each exist but never which index belongs to which, so any
 * grouping here would be a guess dressed up as a reading.
 */
function CoreBars({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-hidden="true">
      {values.map((value, i) => (
        <span
          key={i}
          className="w-[5px] rounded-[1.5px] bg-clay transition-[height] duration-[var(--fast)] ease-[var(--ease)]"
          style={{ height: `${Math.max(6, Math.min(100, value))}%`, opacity: 0.25 + value / 160 }}
        />
      ))}
    </div>
  );
}

function BootDisk({ tick }: { tick: Tick }) {
  const disk = tick.disks.find((d) => d.mount === "/" && !d.external);
  if (!disk || disk.total === 0) return null;
  const pct = (disk.used / disk.total) * 100;

  return (
    <Card label="启动磁盘">
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="type-figure text-[1.9rem] text-ink">{pct.toFixed(0)}</span>
        <span className="font-medium text-ink-muted">%</span>
      </p>
      <div className="mt-3 h-[7px] w-full overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full bg-[color-mix(in_srgb,var(--ink)_22%,transparent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2.5 text-ink-muted">
        <span className="type-data">{formatBytes(disk.used)}</span> /{" "}
        {formatBytes(disk.total)}
      </p>
    </Card>
  );
}

const BATTERY_STATUS: Record<string, string> = {
  charging: "充电中",
  discharging: "放电中",
  charged: "已充满",
  full: "已充满",
  unknown: "",
};

const BATTERY_HEALTH: Record<string, string> = {
  Good: "良好",
  Fair: "一般",
  Poor: "较差",
};

function BatteryCard({ tick }: { tick: Tick }) {
  const battery = tick.batteries[0];
  if (!battery) return null;

  const status = BATTERY_STATUS[battery.status.toLowerCase()] ?? battery.status;
  const health = BATTERY_HEALTH[battery.health] ?? battery.health;

  return (
    <Card label="电池">
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="type-figure text-[1.9rem] text-ink">{battery.percent.toFixed(0)}</span>
        <span className="font-medium text-ink-muted">%</span>
      </p>
      <p className="mt-3 text-ink-muted">
        {status}
        {battery.timeLeft && ` · 剩余 ${battery.timeLeft}`}
      </p>
      <p className="mt-1 text-ink-muted">
        {health && `健康 ${health}`}
        {battery.cycleCount > 0 && ` · ${formatCount(battery.cycleCount)} 次循环`}
      </p>
      {tick.thermal.batteryTemp > 0 && (
        <p className="mt-1 text-ink-faint">
          <span className="type-data">{tick.thermal.batteryTemp.toFixed(1)}</span> °C
          {tick.thermal.systemPower > 0 &&
            ` · 功耗 ${tick.thermal.systemPower.toFixed(1)} W`}
        </p>
      )}
      {/* The one thermal signal userland can read on Apple Silicon: whether
          the CPU is being throttled for heat. */}
      <p className="mt-1 text-ink-faint">
        {tick.thermal.thermalLevel < 100 ? (
          <span className="text-rust">
            过热降频 · CPU 性能限制 {tick.thermal.thermalLevel}%
          </span>
        ) : (
          "热状态正常"
        )}
      </p>
    </Card>
  );
}

function NetworkCard({ tick }: { tick: Tick }) {
  const rx = tick.network.reduce((sum, n) => sum + n.rxRateMbs, 0);
  const tx = tick.network.reduce((sum, n) => sum + n.txRateMbs, 0);

  return (
    <Card label="网络">
      <div className="mt-1.5 flex gap-6">
        <Rate arrow="↓" value={rx} />
        <Rate arrow="↑" value={tx} />
      </div>
      <p className="mt-3 text-ink-muted">
        {tick.network.length > 0
          ? `${formatCount(tick.network.length)} 个活动接口`
          : "没有活动接口"}
      </p>
    </Card>
  );
}

function Rate({ arrow, value }: { arrow: string; value: number }) {
  return (
    <p className="flex items-baseline gap-1">
      <span className="text-ink-faint">{arrow}</span>
      <span className="type-figure text-[1.35rem] text-ink">{value.toFixed(1)}</span>
      <span className="text-[11.5px] text-ink-muted">MB/s</span>
    </p>
  );
}

function Processes({ tick }: { tick: Tick }) {
  if (tick.topProcesses.length === 0) return null;

  return (
    <section>
      <p className="type-label mb-2.5">占用最高的进程</p>
      <div className="overflow-hidden rounded-card border border-hairline bg-surface">
        {tick.topProcesses.map((process, i) => (
          <div
            key={process.pid}
            className={`flex items-center gap-4 px-5 py-2.5 ${
              i === 0 ? "" : "border-t border-hairline"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{process.name}</span>
            <span className="type-data w-16 shrink-0 text-right text-ink-muted">
              {process.cpu.toFixed(1)} %
            </span>
            <span className="type-data w-20 shrink-0 text-right text-ink-muted">
              {formatBytes(process.memoryBytes)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
