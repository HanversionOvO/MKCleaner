type Series = {
  points: number[];
  stroke: string;
  /** Area under the line, for the series that should read as primary. */
  fill?: string;
  width?: number;
};

type Props = {
  series: Series[];
  /** Samples the chart is wide, whether or not that many have arrived yet. */
  capacity: number;
  max?: number;
  className?: string;
};

/**
 * A right-anchored trace of the last `capacity` samples.
 *
 * The newest sample sits at the right edge and history scrolls left, which is
 * how a live reading is read. Before a full window has accumulated the line
 * starts partway across rather than stretching to fit — a short trace should
 * look short, not like a full minute of flat data.
 */
export function Trace({ series, capacity, max = 100, className = "" }: Props) {
  const span = Math.max(1, capacity - 1);

  const path = (points: number[]) =>
    points
      .map((value, i) => {
        const x = span - (points.length - 1 - i);
        const y = 100 - (Math.min(Math.max(value, 0), max) / max) * 100;
        return `${x},${y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <svg
      viewBox={`0 0 ${span} 100`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="50"
        x2={span}
        y2="50"
        stroke="var(--hairline)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {series.map((s, i) => {
        if (s.points.length < 2) return null;
        const points = path(s.points);
        const firstX = span - (s.points.length - 1);
        return (
          <g key={i}>
            {s.fill && (
              <polygon
                points={`${firstX},100 ${points} ${span},100`}
                fill={s.fill}
                stroke="none"
              />
            )}
            <polyline
              points={points}
              fill="none"
              stroke={s.stroke}
              strokeWidth={s.width ?? 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}
