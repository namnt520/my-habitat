import { describe, expect, it } from 'vitest';
import { CELLS, GRID, MOUNTAIN_LEVEL, WADE_DEPTH, WATER_LEVEL_BASE } from '../src/sim/constants';
import { Rng } from '../src/sim/rng';
import { generateTerrain } from '../src/sim/terrain';

describe('terrain', () => {
  it('cùng seed sinh cùng địa hình', () => {
    const a = generateTerrain(new Rng(11));
    const b = generateTerrain(new Rng(11));
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
    expect(Array.from(a.canopy)).toEqual(Array.from(b.canopy));
  });

  it.each([1, 2, 3, 7, 42, 1234])('seed %i: sông chia đôi bản đồ với loài không biết bơi', (seed) => {
    const t = generateTerrain(new Rng(seed));
    // Loang từ mọi ô đi bộ được ở mép Tây; không được chạm tới mép Đông.
    const walkable = (c: number) =>
      t.elevation[c] < MOUNTAIN_LEVEL && t.elevation[c] >= WATER_LEVEL_BASE - WADE_DEPTH;
    const seen = new Uint8Array(CELLS);
    const stack: number[] = [];
    for (let cy = 0; cy < GRID; cy++) {
      const c = cy * GRID;
      if (walkable(c)) {
        seen[c] = 1;
        stack.push(c);
      }
    }
    while (stack.length > 0) {
      const c = stack.pop()!;
      const cx = c % GRID;
      const cy = (c / GRID) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
          const n = ny * GRID + nx;
          if (!seen[n] && walkable(n)) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    let reachedEast = 0;
    for (let cy = 0; cy < GRID; cy++) reachedEast += seen[cy * GRID + GRID - 1];
    expect(reachedEast).toBe(0);

    // Hai bờ đều phải là vùng đất lớn (mỗi bờ ít nhất 15% bản đồ).
    const sizes = new Map<number, number>();
    for (let c = 0; c < CELLS; c++) {
      const r = t.landRegion[c];
      if (r >= 0) sizes.set(r, (sizes.get(r) ?? 0) + 1);
    }
    const big = [...sizes.values()].filter((s) => s > CELLS * 0.15);
    expect(big.length).toBeGreaterThanOrEqual(2);
  });

  it('tỉ lệ sinh cảnh ổn định giữa các seed', () => {
    for (const seed of [5, 6, 7]) {
      const t = generateTerrain(new Rng(seed));
      let water = 0;
      let mountain = 0;
      let forest = 0;
      for (let c = 0; c < CELLS; c++) {
        if (t.elevation[c] < WATER_LEVEL_BASE) water++;
        else if (t.elevation[c] > MOUNTAIN_LEVEL) mountain++;
        if (t.canopy[c] > 0.5) forest++;
      }
      expect(water / CELLS).toBeGreaterThan(0.08);
      expect(water / CELLS).toBeLessThan(0.2);
      expect(mountain / CELLS).toBeGreaterThan(0.03);
      expect(mountain / CELLS).toBeLessThan(0.08);
      expect(forest / CELLS).toBeGreaterThan(0.15);
      expect(forest / CELLS).toBeLessThan(0.35);
    }
  });
});
