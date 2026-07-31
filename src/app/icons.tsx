/**
 * Sidebar icons.
 *
 * Each glyph shows what its view does rather than a generic symbol: nested
 * rectangles for the treemap, a load trace for the live metrics, an app tile
 * losing a piece for uninstall, a stack shedding its top layer for cleanup.
 */

type IconProps = { className?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function CleanIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M2.5 10.2 8 12.8l5.5-2.6" />
      <path d="M2.5 6.9 8 9.5l5.5-2.6" />
      <path d="M11 3.4 8 1.8 2.5 4.4" strokeDasharray="1.6 1.8" opacity="0.55" />
      <path d="M12.6 2.6v3.2M11 4.2h3.2" />
    </svg>
  );
}

/** A refresh cycle — optimization keeps the system's services fresh. */
export function OptimizeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M10.8 2.9A5.8 5.8 0 1 0 13.4 8" />
      <path d="M10.4 1.2v2.9h2.9" />
      <path d="M8.8 6.2l3.1 2.2" strokeDasharray="0.9 1.1" opacity="0.55" />
    </svg>
  );
}

export function AnalyzeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="1.9" y="2.4" width="12.2" height="11.2" rx="1.4" />
      <path d="M8.6 2.4v11.2M8.6 8.6h5.5" />
      <path d="M1.9 6.1h6.7" />
    </svg>
  );
}

export function StatusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M1.6 8.6h2.7l1.5-4.4 2.4 7.6 1.5-3.2h4.7" />
    </svg>
  );
}

/** A prompt: the terminal's `mo ❯`. */
export function TerminalIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M2.4 3.2 5.8 8 2.4 12.8" />
      <path d="M8.2 12.6h5.4" />
    </svg>
  );
}

export function UninstallIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M13.6 7V3.9a1.5 1.5 0 0 0-1.5-1.5H3.9a1.5 1.5 0 0 0-1.5 1.5v8.2a1.5 1.5 0 0 0 1.5 1.5H7" />
      <path d="M9.4 11.2h4.9" />
    </svg>
  );
}
