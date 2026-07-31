export type Rect = { x: number; y: number; w: number; h: number };
export type Tile<T> = Rect & { item: T };

/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk).
 *
 * Fills `bounds` with one rectangle per item, area proportional to its value,
 * laying out rows against the shorter side and closing a row as soon as adding
 * to it would make the aspect ratios worse. Items must be sorted largest first,
 * which is what the algorithm assumes and what makes the result stable.
 *
 * Zero-valued items are dropped: they would be rectangles of no area, and
 * keeping them only risks dividing by zero.
 */
export function squarify<T>(items: T[], value: (item: T) => number, bounds: Rect): Tile<T>[] {
  const usable = items.filter((item) => value(item) > 0);
  const total = usable.reduce((sum, item) => sum + value(item), 0);
  if (usable.length === 0 || total <= 0 || bounds.w <= 0 || bounds.h <= 0) return [];

  const scale = (bounds.w * bounds.h) / total;
  const areas = usable.map((item) => value(item) * scale);

  const tiles: Tile<T>[] = [];
  let rect: Rect = { ...bounds };
  let i = 0;

  while (i < areas.length) {
    const side = Math.min(rect.w, rect.h);

    // Grow the row while the worst aspect ratio in it keeps improving.
    let end = i + 1;
    let row = areas.slice(i, end);
    while (end < areas.length) {
      const grown = areas.slice(i, end + 1);
      if (worstRatio(grown, side) > worstRatio(row, side)) break;
      row = grown;
      end += 1;
    }

    const sum = row.reduce((a, b) => a + b, 0);

    if (rect.w >= rect.h) {
      // Row runs down the left edge of what is left.
      const w = sum / rect.h;
      let y = rect.y;
      for (let k = 0; k < row.length; k += 1) {
        const h = row[k] / w;
        tiles.push({ x: rect.x, y, w, h, item: usable[i + k] });
        y += h;
      }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      // Row runs along the top edge.
      const h = sum / rect.w;
      let x = rect.x;
      for (let k = 0; k < row.length; k += 1) {
        const w = row[k] / h;
        tiles.push({ x, y: rect.y, w, h, item: usable[i + k] });
        x += w;
      }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }

    i = end;
  }

  return tiles;
}

/** The worst aspect ratio a row would have if laid out along `side`. */
function worstRatio(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum <= 0 || side <= 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = sum * sum;
  const l2 = side * side;
  return Math.max((l2 * max) / s2, s2 / (l2 * min));
}
