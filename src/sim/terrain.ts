/**
 * Sinh địa hình tĩnh từ seed: độ cao, sông, rừng, độ màu mỡ, và các vùng liên thông.
 *
 * Địa hình không đổi sau khi sinh. Phần động (mực nước, cỏ, đất…) nằm trong `World`.
 */
import {
  CELLS,
  CELL_SIZE,
  FISH_MIN_DEPTH,
  FOREST_FRACTION,
  GRID,
  HILL_LEVEL,
  MOUNTAIN_LEVEL,
  RIVER_DEPTH,
  RIVER_FORD_DEPTH,
  RIVER_HALF_WIDTH,
  WADE_DEPTH,
  WATER_LEVEL_BASE,
  WORLD_SIZE,
} from './constants';
import { clamp, clamp01, lerp, smoothstep } from './detmath';
import { fbm, valueNoise } from './noise';
import type { Rng } from './rng';

export interface Terrain {
  /** Độ cao chuẩn hoá theo hạng trong [0, 1]; lòng sông đã được khắc xuống dưới mực nước. */
  readonly elevation: Float32Array;
  /** Độ dày tán rừng trong [0, 1]. Che tầm nhìn, che bóng cỏ. */
  readonly canopy: Float32Array;
  /** Hệ số màu mỡ ban đầu của đất (≈ 0,2–1,45). */
  readonly fertility: Float32Array;
  /** 1 nếu ô thuộc lòng sông. */
  readonly river: Uint8Array;
  /** Nhãn vùng đất liền liên thông (đi bộ được ở mực nước nền); −1 nếu không đi bộ được. */
  readonly landRegion: Int16Array;
  /** Nhãn thuỷ vực liên thông ở mực nước nền; −1 nếu không phải nước. */
  readonly waterRegion: Int16Array;
  /** Nhãn thuỷ vực gần nhất của mọi ô (dùng làm "quần thể con" cho lưỡng cư). */
  readonly shoreRegion: Int16Array;
  readonly landRegionCount: number;
  readonly waterRegionCount: number;
  /** Chỉ số ô kề thấp nhất (để rửa trôi dinh dưỡng xuống dốc); −1 nếu là đáy trũng. */
  readonly downhill: Int32Array;
  /** Màu nền của ô (sắc độ, độ sáng trong [0, 1]) — dùng để tính nguỵ trang. */
  readonly bgHue: Float32Array;
  readonly bgLight: Float32Array;
  /** Đường tâm sông: các cặp (x, y) theo đơn vị bản đồ. */
  readonly riverPath: Float32Array;
  /** Toạ độ y (u) của các chỗ cạn trên sông. */
  readonly fords: Float32Array;
}

/** Chỉ số ô chứa điểm (x, y) theo đơn vị bản đồ. Toạ độ được kẹp vào trong bản đồ. */
export function cellAt(x: number, y: number): number {
  let cx = (x / CELL_SIZE) | 0;
  let cy = (y / CELL_SIZE) | 0;
  if (cx < 0) cx = 0;
  else if (cx >= GRID) cx = GRID - 1;
  if (cy < 0) cy = 0;
  else if (cy >= GRID) cy = GRID - 1;
  return cy * GRID + cx;
}

/** Thay mỗi giá trị bằng hạng chuẩn hoá của nó trong [0, 1) — cho phân bố đều với mọi seed. */
function rankNormalise(values: Float32Array): Float32Array {
  const order = new Uint32Array(values.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  // So sánh phụ theo chỉ số để kết quả không phụ thuộc tính ổn định của thuật toán sắp xếp.
  order.sort((a, b) => values[a] - values[b] || a - b);
  const ranked = new Float32Array(values.length);
  for (let r = 0; r < order.length; r++) ranked[order[r]] = r / order.length;
  return ranked;
}

/** Gán nhãn các thành phần liên thông (8 hướng) của tập ô thoả `member`. Trả về số thành phần. */
function labelComponents(member: (cell: number) => boolean, labels: Int16Array): number {
  labels.fill(-1);
  const stack = new Int32Array(CELLS);
  let count = 0;
  for (let start = 0; start < CELLS; start++) {
    if (labels[start] !== -1 || !member(start)) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const c = stack[--top];
      const cx = c % GRID;
      const cy = (c / GRID) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= GRID) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= GRID) continue;
          const n = ny * GRID + nx;
          if (labels[n] === -1 && member(n)) {
            labels[n] = count;
            stack[top++] = n;
          }
        }
      }
    }
    count++;
  }
  return count;
}

/**
 * Sinh địa hình đầy đủ: hồ, một con sông lớn Bắc–Nam chia đôi bản đồ, đồng cỏ, rừng, đồi núi.
 * @param rng RNG của mô phỏng — hàm này tiêu thụ một lượng số ngẫu nhiên cố định.
 */
export function generateTerrain(rng: Rng): Terrain {
  const seedElevation = rng.nextU32();
  const seedForest = rng.nextU32();
  const seedFertility = rng.nextU32();
  const seedRiver = rng.nextU32();

  // 1. Độ cao thô → chuẩn hoá theo hạng.
  const raw = new Float32Array(CELLS);
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const x = (cx + 0.5) * CELL_SIZE;
      const y = (cy + 0.5) * CELL_SIZE;
      raw[cy * GRID + cx] = fbm(x / 620, y / 620, seedElevation, 5, 0.5);
    }
  }
  const elevation = rankNormalise(raw);

  // 2. Sông: đường tâm uốn khúc từ mép Bắc tới mép Nam.
  const pathStep = 2;
  const pathPoints = Math.floor(WORLD_SIZE / pathStep) + 1;
  const riverPath = new Float32Array(pathPoints * 2);
  for (let k = 0; k < pathPoints; k++) {
    const y = k * pathStep;
    const meander =
      400 * (2 * fbm(0.5, y / 900, seedRiver, 3, 0.5) - 1) +
      90 * (2 * valueNoise(7.5, y / 240, seedRiver) - 1);
    riverPath[k * 2] = clamp(WORLD_SIZE / 2 + meander, 280, WORLD_SIZE - 280);
    riverPath[k * 2 + 1] = y;
  }
  // Ba chỗ cạn: bình thường vẫn sâu quá mức lội được, chỉ hở ra khi hạn hán.
  const fords = new Float32Array(3);
  for (let f = 0; f < fords.length; f++) {
    fords[f] = WORLD_SIZE * ((f + 0.25 + 0.5 * rng.next()) / fords.length);
  }

  const riverDistance = new Float32Array(CELLS).fill(1e9);
  const riverHalf = new Float32Array(CELLS);
  const riverDepth = new Float32Array(CELLS);
  for (let k = 0; k < pathPoints; k++) {
    const px = riverPath[k * 2];
    const py = riverPath[k * 2 + 1];
    const half = RIVER_HALF_WIDTH * (0.85 + 0.4 * valueNoise(3.5, py / 300, seedRiver + 17));
    let fordWeight = 0;
    for (let f = 0; f < fords.length; f++) {
      fordWeight = Math.max(fordWeight, 1 - smoothstep(25, 55, Math.abs(py - fords[f])));
    }
    const depth = lerp(RIVER_DEPTH, RIVER_FORD_DEPTH, fordWeight);
    const reach = half + 45;
    const cx0 = Math.max(0, Math.floor((px - reach) / CELL_SIZE));
    const cx1 = Math.min(GRID - 1, Math.floor((px + reach) / CELL_SIZE));
    const cy0 = Math.max(0, Math.floor((py - reach) / CELL_SIZE));
    const cy1 = Math.min(GRID - 1, Math.floor((py + reach) / CELL_SIZE));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = (cx + 0.5) * CELL_SIZE - px;
        const dy = (cy + 0.5) * CELL_SIZE - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        const c = cy * GRID + cx;
        if (d < riverDistance[c]) {
          riverDistance[c] = d;
          riverHalf[c] = half;
          riverDepth[c] = depth;
        }
      }
    }
  }
  const river = new Uint8Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const d = riverDistance[c];
    const half = riverHalf[c];
    if (d < half) {
      const q = d / half;
      river[c] = 1;
      elevation[c] = WATER_LEVEL_BASE - (riverDepth[c] * (1 - q * q) + 0.004);
    } else if (d < half + 40) {
      // Thung lũng ven sông: hạ dần độ cao để bờ không dựng đứng và núi không chặn dòng.
      const bank = WATER_LEVEL_BASE + 0.004 + ((d - half) / 40) * 0.5;
      if (elevation[c] > bank) elevation[c] = bank;
      else if (elevation[c] < WATER_LEVEL_BASE + 0.004) elevation[c] = WATER_LEVEL_BASE + 0.004;
    }
  }

  // 3. Rừng và độ màu mỡ.
  const forestRaw = new Float32Array(CELLS);
  const fertility = new Float32Array(CELLS);
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const x = (cx + 0.5) * CELL_SIZE;
      const y = (cy + 0.5) * CELL_SIZE;
      const c = cy * GRID + cx;
      forestRaw[c] = fbm(x / 330, y / 330, seedForest, 4, 0.55);
      const e = elevation[c];
      let fert = 0.55 + 0.9 * fbm(x / 280, y / 280, seedFertility, 3, 0.5);
      if (e > MOUNTAIN_LEVEL) fert *= 0.2;
      else if (e > HILL_LEVEL) fert *= lerp(1, 0.55, (e - HILL_LEVEL) / (MOUNTAIN_LEVEL - HILL_LEVEL));
      fertility[c] = fert;
    }
  }
  const forestRank = rankNormalise(forestRaw);
  const canopy = new Float32Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const e = elevation[c];
    if (e < WATER_LEVEL_BASE || e > MOUNTAIN_LEVEL) continue;
    let cover = smoothstep(1 - FOREST_FRACTION - 0.07, 1 - FOREST_FRACTION + 0.07, forestRank[c]);
    if (e > HILL_LEVEL) cover *= 1 - 0.6 * ((e - HILL_LEVEL) / (MOUNTAIN_LEVEL - HILL_LEVEL));
    canopy[c] = cover;
  }

  return finishTerrain(elevation, canopy, fertility, river, riverPath, fords);
}

/** Địa hình phẳng toàn đồng cỏ cho chế độ thí nghiệm Lotka–Volterra: không nước, rừng hay núi. */
export function generateFlatTerrain(): Terrain {
  const elevation = new Float32Array(CELLS).fill(0.5);
  const canopy = new Float32Array(CELLS);
  const fertility = new Float32Array(CELLS).fill(1);
  return finishTerrain(
    elevation,
    canopy,
    fertility,
    new Uint8Array(CELLS),
    new Float32Array(0),
    new Float32Array(0),
  );
}

/** Tính các dữ liệu suy ra từ độ cao: vùng liên thông, hướng dốc, màu nền. */
function finishTerrain(
  elevation: Float32Array,
  canopy: Float32Array,
  fertility: Float32Array,
  river: Uint8Array,
  riverPath: Float32Array,
  fords: Float32Array,
): Terrain {
  const landRegion = new Int16Array(CELLS);
  const waterRegion = new Int16Array(CELLS);
  const landRegionCount = labelComponents(
    (c) => elevation[c] < MOUNTAIN_LEVEL && elevation[c] >= WATER_LEVEL_BASE - WADE_DEPTH,
    landRegion,
  );
  const waterRegionCount = labelComponents(
    (c) => elevation[c] < WATER_LEVEL_BASE - FISH_MIN_DEPTH,
    waterRegion,
  );

  // Thuỷ vực gần nhất của mọi ô: BFS đa nguồn từ các ô nước.
  const shoreRegion = new Int16Array(CELLS).fill(-1);
  const queue = new Int32Array(CELLS);
  let head = 0;
  let tail = 0;
  for (let c = 0; c < CELLS; c++) {
    if (waterRegion[c] >= 0) {
      shoreRegion[c] = waterRegion[c];
      queue[tail++] = c;
    }
  }
  while (head < tail) {
    const c = queue[head++];
    const cx = c % GRID;
    const cy = (c / GRID) | 0;
    if (cx > 0 && shoreRegion[c - 1] === -1) {
      shoreRegion[c - 1] = shoreRegion[c];
      queue[tail++] = c - 1;
    }
    if (cx < GRID - 1 && shoreRegion[c + 1] === -1) {
      shoreRegion[c + 1] = shoreRegion[c];
      queue[tail++] = c + 1;
    }
    if (cy > 0 && shoreRegion[c - GRID] === -1) {
      shoreRegion[c - GRID] = shoreRegion[c];
      queue[tail++] = c - GRID;
    }
    if (cy < GRID - 1 && shoreRegion[c + GRID] === -1) {
      shoreRegion[c + GRID] = shoreRegion[c];
      queue[tail++] = c + GRID;
    }
  }
  if (tail === 0) shoreRegion.fill(0); // bản đồ không có nước

  const downhill = new Int32Array(CELLS).fill(-1);
  const bgHue = new Float32Array(CELLS);
  const bgLight = new Float32Array(CELLS);
  for (let c = 0; c < CELLS; c++) {
    const cx = c % GRID;
    const cy = (c / GRID) | 0;
    let lowest = elevation[c];
    if (cx > 0 && elevation[c - 1] < lowest) {
      lowest = elevation[c - 1];
      downhill[c] = c - 1;
    }
    if (cx < GRID - 1 && elevation[c + 1] < lowest) {
      lowest = elevation[c + 1];
      downhill[c] = c + 1;
    }
    if (cy > 0 && elevation[c - GRID] < lowest) {
      lowest = elevation[c - GRID];
      downhill[c] = c - GRID;
    }
    if (cy < GRID - 1 && elevation[c + GRID] < lowest) downhill[c] = c + GRID;

    // Màu nền: đồng cỏ xanh‑vàng sáng, rừng xanh thẫm, đồi nâu, núi xám, bờ nước màu cát.
    const e = elevation[c];
    let hue: number;
    let light: number;
    if (e < WATER_LEVEL_BASE) {
      hue = 0.56;
      light = 0.4;
    } else if (e > MOUNTAIN_LEVEL) {
      hue = 0.08;
      light = 0.62;
    } else {
      const hill = clamp01((e - HILL_LEVEL) / (MOUNTAIN_LEVEL - HILL_LEVEL));
      const shore = 1 - clamp01((e - WATER_LEVEL_BASE) / 0.015);
      hue = lerp(lerp(0.27, 0.34, canopy[c]), 0.1, Math.max(hill, shore * 0.8));
      light = lerp(lerp(0.52, 0.26, canopy[c]), 0.5, hill);
      light = lerp(light, 0.68, shore * 0.8);
    }
    bgHue[c] = hue;
    bgLight[c] = light;
  }

  return {
    elevation,
    canopy,
    fertility,
    river,
    landRegion,
    waterRegion,
    shoreRegion,
    landRegionCount,
    waterRegionCount,
    downhill,
    bgHue,
    bgLight,
    riverPath,
    fords,
  };
}
