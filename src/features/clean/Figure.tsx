import { splitBytes, splitBytesAt } from "@/lib/format";
import { useAnimatedNumber } from "@/lib/useAnimatedNumber";

type Props = {
  bytes: number;
  /** Sits above the figure, in the label style. */
  label: string;
};

/**
 * The one place the serif face appears.
 *
 * Newsreader has no CJK coverage, so it is used where it actually applies —
 * digits — and the surrounding Chinese text stays in the system face. That
 * split is deliberate: the number is the thing worth setting.
 *
 * The count rises out of zero and eases towards its target. The unit is fixed
 * by the target so the animation never stutters across a unit boundary.
 */
export function Figure({ bytes, label }: Props) {
  const animated = useAnimatedNumber(bytes);
  const { unit } = splitBytes(bytes);
  const { value } = splitBytesAt(animated, unit);

  return (
    <div>
      <p className="type-label">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="type-figure text-[3.4rem] text-ink">{value}</span>
        <span className="text-[1.05rem] font-medium text-ink-muted">{unit}</span>
      </p>
    </div>
  );
}
