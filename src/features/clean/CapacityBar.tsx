import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/format";

type Props = {
  /** Boot volume capacity. */
  total: number;
  used: number;
  /** The part of `used` this cleanup would give back. */
  reclaimable: number;
};

/**
 * The disk as one continuous measure, with the reclaimable part called out
 * inside the used portion.
 *
 * Cleanup tools usually open with an alarm — a red gauge and a problem count.
 * The honest framing is the opposite: this much of your disk is in use, and
 * this slice of it is yours to take back. Showing the slice against the whole
 * volume is also what answers the only question worth asking here, which is
 * whether cleaning is worth doing at all.
 */
export function CapacityBar({ total, used, reclaimable }: Props) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (total <= 0) return null;

  const claimed = Math.min(reclaimable, used);
  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div>
      <div className="flex h-[9px] w-full overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full bg-[color-mix(in_srgb,var(--ink)_22%,transparent)]"
          style={{ width: pct(used - claimed) }}
        />
        {/* A few GB out of a few hundred is a sliver, so it gets a floor —
            otherwise the one thing this bar exists to show disappears. */}
        <div
          className="h-full bg-clay transition-[width] ease-[var(--ease)]"
          style={{
            width: revealed ? `max(${pct(claimed)}, ${claimed > 0 ? "5px" : "0px"})` : "0px",
            transitionDuration: "var(--slow)",
          }}
        />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-7 gap-y-1.5">
        <Legend
          swatch="bg-[color-mix(in_srgb,var(--ink)_22%,transparent)]"
          label="已用"
          value={used - claimed}
        />
        {/* Before a scan there is nothing to reclaim, and a "可回收 0 B" row
            reads as a finding rather than an absence of one. */}
        {claimed > 0 && <Legend swatch="bg-clay" label="可回收" value={claimed} emphasis />}
        <Legend swatch="bg-sunken" label="空闲" value={total - used} />
      </dl>
    </div>
  );
}

function Legend({
  swatch,
  label,
  value,
  emphasis = false,
}: {
  swatch: string;
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-[2.5px] ${swatch}`} aria-hidden="true" />
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`type-data ${emphasis ? "font-medium text-ink" : "text-ink-muted"}`}>
        {formatBytes(Math.max(0, value))}
      </dd>
    </div>
  );
}
