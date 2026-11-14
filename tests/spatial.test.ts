import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { SpatialHash } from '../src/sim/spatial';

function bruteForce(
  n: number,
  alive: Uint8Array,
  x: Float32Array,
  y: Float32Array,
  qx: number,
  qy: number,
  r: number,
) {
  const found: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const dx = x[i] - qx;
    const dy = y[i] - qy;
    if (dx * dx + dy * dy <= r * r) found.push(i);
  }
  return found;
}

describe('SpatialHash', () => {
  const rng = new Rng(3);
  const n = 3000;
  const alive = new Uint8Array(n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    alive[i] = rng.chance(0.85) ? 1 : 0;
    x[i] = rng.range(0, 2000);
    y[i] = rng.range(0, 2000);
  }
  const hash = new SpatialHash(2000, 40);
  hash.build(n, alive, x, y);
  const scratch = new Int32Array(n);

  it('truy vấn bán kính khớp với duyệt toàn bộ', () => {
    for (let q = 0; q < 300; q++) {
      const qx = rng.range(-50, 2050);
      const qy = rng.range(-50, 2050);
      const r = rng.range(1, 260);
      const candidates = hash.query(qx, qy, r, scratch);
      const found: number[] = [];
      for (let k = 0; k < candidates; k++) {
        const i = scratch[k];
        const dx = x[i] - qx;
        const dy = y[i] - qy;
        if (dx * dx + dy * dy <= r * r) found.push(i);
      }
      found.sort((a, b) => a - b);
      expect(found).toEqual(bruteForce(n, alive, x, y, qx, qy, r));
    }
  });

  it('không trả về phần tử đã chết', () => {
    const candidates = hash.query(1000, 1000, 3000, scratch);
    for (let k = 0; k < candidates; k++) expect(alive[scratch[k]]).toBe(1);
    expect(candidates).toBe(alive.reduce((s, v) => s + v, 0));
  });

  it('số ứng viên nhỏ hơn nhiều so với n (không phải O(n²))', () => {
    let total = 0;
    for (let q = 0; q < 200; q++) total += hash.query(rng.range(0, 2000), rng.range(0, 2000), 60, scratch);
    expect(total / 200).toBeLessThan(n * 0.03);
  });

  it('dựng lại sau khi phần tử di chuyển', () => {
    x[0] = 5;
    y[0] = 5;
    alive[0] = 1;
    hash.build(n, alive, x, y);
    const candidates = hash.query(5, 5, 1, scratch);
    expect(Array.from(scratch.subarray(0, candidates))).toContain(0);
  });
});
