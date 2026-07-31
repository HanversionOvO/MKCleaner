/**
 * Byte formatting.
 *
 * The engine reports 1024-based sizes and labels them KB/MB/GB, so we match that
 * rather than silently switching to KiB/MiB — a number that disagrees with the
 * engine's own output would be worse than an imprecise unit name.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Splits a size into value and unit so the unit can be set apart typographically. */
export function splitBytes(bytes: number): { value: string; unit: string } {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: "0", unit: "B" };

  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  // Three significant figures reads as precise without being noisy: 6.85 GB,
  // 42.1 MB, 947 KB.
  const digits = unit === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return { value: size.toFixed(digits), unit: UNITS[unit] };
}

export function formatBytes(bytes: number): string {
  const { value, unit } = splitBytes(bytes);
  return `${value} ${unit}`;
}

const UNIT_BYTES: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

/**
 * Formats `bytes` in a fixed unit.
 *
 * For animated figures: the unit is decided once from the target value so the
 * count can scroll without suddenly flipping from `1024 MB` to `1 GB` and
 * jumping backwards.
 */
export function splitBytesAt(bytes: number, unit: string): { value: string; unit: string } {
  const size = bytes / (UNIT_BYTES[unit] ?? 1);
  const digits = unit === "B" ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return { value: size.toFixed(digits), unit };
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("zh-CN").format(n);
}

/** Shortens a path for display, keeping the tail — that's the part that identifies it. */
export function shortenPath(path: string, home?: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
