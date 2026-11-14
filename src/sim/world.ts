/**
 * Trạng thái động của thế giới: các trường trên lưới, khí hậu, mực nước.
 * Mọi đại lượng năng lượng/dinh dưỡng dùng Float64Array để kiểm toán bảo toàn tới ~1e‑9.
 */
import { CELLS, GRID, MOUNTAIN_LEVEL, SOIL_NUTRIENT_INITIAL, WATER_LEVEL_BASE } from './constants';
import type { Terrain } from './terrain';

/** Khí hậu và thời tiết hiện tại (cập nhật mỗi tick bởi `environment.ts`). */
export interface Climate {
  /** Vị trí trong năm [0, 1): 0 = đầu xuân. */
  yearPhase: number;
  /** Mùa: 0 xuân, 1 hạ, 2 thu, 3 đông. */
  season: number;
  /** Dao động mùa trong [−1, 1]: +1 giữa hạ, −1 giữa đông. */
  seasonal: number;
  /** Độ sáng ban ngày trong [0, 1]. */
  daylight: number;
  /** Nhiệt độ không khí hiện tại ở độ cao trung bình (°C), gồm cả dao động ngày/đêm. */
  temperature: number;
  /** Nhiệt độ trung bình ngày (°C) — thực vật và việc ngủ đông dùng giá trị này. */
  temperatureDaily: number;
  /** Nhiệt độ nước (°C) — biến thiên chậm hơn không khí. */
  temperatureWater: number;
  /** Cường độ mưa hiện tại [0, 1]. */
  rain: number;
  /** Số tick còn lại của đợt hạn (0 = không hạn) và của đợt lũ. */
  droughtTicks: number;
  floodTicks: number;
  /** Độ ẩm đất toàn cục [0, 1]. */
  soilWetness: number;
  /** Mực nước hiện tại (đơn vị độ cao chuẩn hoá). */
  waterLevel: number;
}

export class World {
  readonly terrain: Terrain;
  readonly climate: Climate;

  /** N khoáng trong đất/nước của mỗi ô (N). */
  readonly soilN = new Float64Array(CELLS);
  /** Sinh khối cỏ (E/ô). */
  readonly grass = new Float64Array(CELLS);
  /** Sinh khối thân lá cây bụi (E/ô) và quả trên cây (E/ô). */
  readonly shrub = new Float64Array(CELLS);
  readonly fruit = new Float64Array(CELLS);
  /** Ngân hàng hạt cây bụi (đơn vị: E quả tương đương; hạt không mang năng lượng trong sổ cái). */
  readonly seedBank = new Float32Array(CELLS);
  /** Tảo (E/ô nước). */
  readonly algae = new Float64Array(CELLS);
  /** Côn trùng (E/ô). */
  readonly insects = new Float64Array(CELLS);
  /** Mùn bã: phân, lá rụng, xác đã rữa (E/ô). */
  readonly detritus = new Float64Array(CELLS);
  /** Sợi nấm (E/ô). */
  readonly fungi = new Float64Array(CELLS);
  /** Các trường thức ăn theo thứ tự FOOD_FIELDS (cỏ, lá bụi, quả, tảo, côn trùng) — để tra bằng chỉ số. */
  readonly foodFields: Float64Array[] = [this.grass, this.shrub, this.fruit, this.algae, this.insects];
  /** Số chu kỳ cháy còn lại của ô (0 = không cháy). */
  readonly fire = new Uint8Array(CELLS);
  /** Danh sách ô đang cháy (để không phải quét cả lưới). */
  burning: number[] = [];

  /** Khoảng cách tới nước gần nhất (số ô, tối đa 255) và ô kế tiếp trên đường tới nước (−1 nếu đã kề nước). */
  readonly waterDistance = new Uint8Array(CELLS);
  readonly waterNext = new Int32Array(CELLS);
  /** Mực nước tại lần tính trường khoảng cách gần nhất. */
  waterFieldLevel = -1;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.climate = {
      yearPhase: 0,
      season: 0,
      seasonal: 0,
      daylight: 1,
      temperature: 12,
      temperatureDaily: 12,
      temperatureWater: 12,
      rain: 0,
      droughtTicks: 0,
      floodTicks: 0,
      soilWetness: 0.55,
      waterLevel: WATER_LEVEL_BASE,
    };
    for (let c = 0; c < CELLS; c++) this.soilN[c] = SOIL_NUTRIENT_INITIAL * terrain.fertility[c];
    this.updateWaterField();
  }

  /** Độ sâu nước tại ô (≤ 0 nghĩa là đất khô). */
  depthAt(cell: number): number {
    return this.climate.waterLevel - this.terrain.elevation[cell];
  }

  /**
   * Tính lại trường khoảng cách tới nước bằng BFS từ các ô đang có nước, đi qua các ô không phải núi.
   * Động vật khát đi theo `waterNext` — một dạng "trí nhớ địa hình" rẻ thay cho tìm đường.
   */
  updateWaterField(): void {
    const { elevation } = this.terrain;
    const level = this.climate.waterLevel;
    const dist = this.waterDistance;
    const next = this.waterNext;
    dist.fill(255);
    next.fill(-1);
    const queue = new Int32Array(CELLS);
    let head = 0;
    let tail = 0;
    for (let c = 0; c < CELLS; c++) {
      if (elevation[c] < level) {
        dist[c] = 0;
        queue[tail++] = c;
      }
    }
    while (head < tail) {
      const c = queue[head++];
      const d = dist[c];
      if (d >= 254) continue;
      const cx = c % GRID;
      const cy = (c / GRID) | 0;
      for (let k = 0; k < 4; k++) {
        let n: number;
        if (k === 0) {
          if (cx === 0) continue;
          n = c - 1;
        } else if (k === 1) {
          if (cx === GRID - 1) continue;
          n = c + 1;
        } else if (k === 2) {
          if (cy === 0) continue;
          n = c - GRID;
        } else {
          if (cy === GRID - 1) continue;
          n = c + GRID;
        }
        if (dist[n] !== 255 || elevation[n] >= MOUNTAIN_LEVEL) continue;
        dist[n] = d + 1;
        next[n] = c;
        queue[tail++] = n;
      }
    }
    // Lượt hai: các ô chưa tới được (núi, túi đất bị núi vây kín) nối vào vùng đã tới, để loài bay đang ở trên núi
    // vẫn biết hướng về phía nước. Đường đi của thú trên cạn (lượt một) không bao giờ xuyên qua núi.
    head = 0;
    while (head < tail) {
      const c = queue[head++];
      const d = dist[c];
      if (d >= 254) continue;
      const cx = c % GRID;
      const cy = (c / GRID) | 0;
      if (cx > 0 && dist[c - 1] === 255) {
        dist[c - 1] = d + 1;
        next[c - 1] = c;
        queue[tail++] = c - 1;
      }
      if (cx < GRID - 1 && dist[c + 1] === 255) {
        dist[c + 1] = d + 1;
        next[c + 1] = c;
        queue[tail++] = c + 1;
      }
      if (cy > 0 && dist[c - GRID] === 255) {
        dist[c - GRID] = d + 1;
        next[c - GRID] = c;
        queue[tail++] = c - GRID;
      }
      if (cy < GRID - 1 && dist[c + GRID] === 255) {
        dist[c + GRID] = d + 1;
        next[c + GRID] = c;
        queue[tail++] = c + GRID;
      }
    }
    this.waterFieldLevel = level;
  }
}
