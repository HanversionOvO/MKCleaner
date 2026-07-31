import { describe, expect, it } from "vitest";
import { squarify, type Rect } from "./squarify";

const BOUNDS: Rect = { x: 0, y: 0, w: 600, h: 340 };

const area = (r: Rect) => r.w * r.h;

describe("squarify", () => {
  it("gives every item area in proportion to its value", () => {
    const items = [100, 50, 25, 25];
    const tiles = squarify(items, (v) => v, BOUNDS);

    const total = items.reduce((a, b) => a + b, 0);
    for (const tile of tiles) {
      const expected = (tile.item / total) * area(BOUNDS);
      expect(area(tile)).toBeCloseTo(expected, 6);
    }
  });

  it("fills the bounds exactly", () => {
    const tiles = squarify([90, 40, 30, 12, 8, 5, 3, 1], (v) => v, BOUNDS);
    const covered = tiles.reduce((sum, t) => sum + area(t), 0);
    expect(covered).toBeCloseTo(area(BOUNDS), 4);
  });

  it("keeps every tile inside the bounds", () => {
    const tiles = squarify([90, 40, 30, 12, 8, 5, 3, 1], (v) => v, BOUNDS);
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(BOUNDS.x - 1e-9);
      expect(tile.y).toBeGreaterThanOrEqual(BOUNDS.y - 1e-9);
      expect(tile.x + tile.w).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.w + 1e-9);
      expect(tile.y + tile.h).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.h + 1e-9);
    }
  });

  it("produces tiles that do not overlap", () => {
    const tiles = squarify([90, 40, 30, 12, 8, 5, 3, 1], (v) => v, BOUNDS);
    for (let i = 0; i < tiles.length; i += 1) {
      for (let j = i + 1; j < tiles.length; j += 1) {
        const a = tiles[i];
        const b = tiles[j];
        const overlaps =
          a.x < b.x + b.w - 1e-9 &&
          b.x < a.x + a.w - 1e-9 &&
          a.y < b.y + b.h - 1e-9 &&
          b.y < a.y + a.h - 1e-9;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("keeps aspect ratios reasonable for a realistic spread", () => {
    // Sizes from a real home directory: one dominant entry and a long tail.
    const sizes = [17841373184, 8435344774, 1673650176, 1658957824, 1456356134, 902052319];
    const tiles = squarify(sizes, (v) => v, BOUNDS);
    for (const tile of tiles) {
      const ratio = Math.max(tile.w / tile.h, tile.h / tile.w);
      expect(ratio).toBeLessThan(8);
    }
  });

  it("drops items with no size rather than dividing by zero", () => {
    const tiles = squarify([50, 0, 25, 0], (v) => v, BOUNDS);
    expect(tiles).toHaveLength(2);
    expect(tiles.every((t) => Number.isFinite(area(t)) && area(t) > 0)).toBe(true);
  });

  it("returns nothing when there is nothing to lay out", () => {
    expect(squarify([], (v: number) => v, BOUNDS)).toEqual([]);
    expect(squarify([0, 0], (v) => v, BOUNDS)).toEqual([]);
    expect(squarify([10], (v) => v, { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
  });
});
