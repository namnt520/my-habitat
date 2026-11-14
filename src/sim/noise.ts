/**
 * Value noise 2D theo seed, không trạng thái. Chỉ dùng số học nguyên + nội suy nên tất định.
 */

/** Băm toạ độ lưới nguyên thành số thực trong [0, 1). */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise mượt trong [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal Brownian motion: cộng nhiều quãng tám của value noise. Kết quả trong [0, 1). */
export function fbm(x: number, y: number, seed: number, octaves: number, gain = 0.5): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(fx, fy, seed + o * 1013);
    total += amplitude;
    amplitude *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum / total;
}
