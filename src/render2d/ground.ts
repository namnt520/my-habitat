/**
 * Lớp nền 2D: một ảnh 200×200 (mỗi ô lưới một điểm ảnh) tô theo địa hình, mực nước, thảm thực vật, mùa.
 * Được vẽ lại mỗi khi Worker gửi trường mới (vài lần mỗi giây), rồi phóng to mượt lên màn hình.
 */
import { CELLS, GRID, HILL_LEVEL, MOUNTAIN_LEVEL } from '../sim/constants';
import type { FieldSnapshot, RenderSnapshot } from '../sim/snapshot';
import type { WorldMeta } from '../worker/protocol';

type Rgb = readonly [number, number, number];
const SOIL: Rgb = [148, 128, 92];
const SAND: Rgb = [208, 194, 146];
const ROCK: Rgb = [128, 126, 130];
const SNOW: Rgb = [240, 244, 250];
const WATER_SHALLOW: Rgb = [112, 186, 204];
const WATER_DEEP: Rgb = [28, 82, 146];
const ASH: Rgb = [70, 62, 58];

/** Màu cỏ và tán rừng theo pha năm (0 = đầu xuân). */
function seasonalGreens(yearPhase: number, wetness: number): { grass: Rgb; forest: Rgb } {
  // Bốn mốc màu: xuân tươi, hạ đậm, thu vàng, đông úa — nội suy vòng tròn.
  const grassStops: Rgb[] = [
    [120, 178, 72],
    [92, 160, 60],
    [168, 160, 70],
    [150, 156, 110],
  ];
  const forestStops: Rgb[] = [
    [52, 118, 60],
    [36, 96, 50],
    [150, 104, 44],
    [70, 88, 70],
  ];
  const position = yearPhase * 4;
  const from = Math.floor(position) % 4;
  const to = (from + 1) % 4;
  const t = position - Math.floor(position);
  const mix = (stops: Rgb[]): Rgb => [
    stops[from][0] + (stops[to][0] - stops[from][0]) * t,
    stops[from][1] + (stops[to][1] - stops[from][1]) * t,
    stops[from][2] + (stops[to][2] - stops[from][2]) * t,
  ];
  const grass = mix(grassStops);
  // Đất khô thì cỏ ngả vàng.
  const dry = Math.max(0, 0.35 - wetness) / 0.35;
  return {
    grass: [
      grass[0] + (190 - grass[0]) * dry * 0.6,
      grass[1] + (170 - grass[1]) * dry * 0.4,
      grass[2] * (1 - dry * 0.3),
    ],
    forest: mix(forestStops),
  };
}

export class GroundLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private meta: WorldMeta | null = null;
  /** Bóng đổ địa hình tính sẵn (hệ số nhân độ sáng của mỗi ô). */
  private shade = new Float32Array(CELLS).fill(1);
  private lastFields: FieldSnapshot | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = GRID;
    this.canvas.height = GRID;
    this.context = this.canvas.getContext('2d')!;
    this.image = this.context.createImageData(GRID, GRID);
  }

  setWorld(meta: WorldMeta): void {
    this.meta = meta;
    this.lastFields = null;
    const e = meta.elevation;
    for (let c = 0; c < CELLS; c++) {
      const cx = c % GRID;
      const cy = (c / GRID) | 0;
      const west = e[cx > 0 ? c - 1 : c];
      const east = e[cx < GRID - 1 ? c + 1 : c];
      const north = e[cy > 0 ? c - GRID : c];
      const south = e[cy < GRID - 1 ? c + GRID : c];
      // Ánh sáng từ hướng Tây Bắc; núi đồi dốc hơn nên bóng rõ hơn.
      const relief = e[c] > HILL_LEVEL ? 9 : 3.5;
      this.shade[c] = Math.max(0.72, Math.min(1.28, 1 + relief * (east - west + south - north)));
    }
  }

  /** Vẽ lại ảnh nền từ ảnh chụp mới nhất (dùng lại trường cũ nếu ảnh chụp này không kèm trường). */
  update(snapshot: RenderSnapshot): void {
    const meta = this.meta;
    if (!meta) return;
    if (snapshot.fields) this.lastFields = snapshot.fields;
    const fields = this.lastFields;
    const { elevation, canopy } = meta;
    const climate = snapshot.climate;
    const level = climate.waterLevel;
    const greens = seasonalGreens(climate.yearPhase, climate.soilWetness);
    const snow = climate.snow ? 0.6 : 0;
    const data = this.image.data;

    for (let c = 0; c < CELLS; c++) {
      const e = elevation[c];
      const depth = level - e;
      let r: number;
      let g: number;
      let b: number;
      if (depth > 0) {
        const t = Math.min(1, depth / 0.06);
        r = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * t;
        g = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * t;
        b = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * t;
        if (fields) {
          // Tảo nhuộm xanh lục vùng nước nông.
          const algae = (fields.algae[c] / 255) * 0.45;
          r += (70 - r) * algae;
          g += (170 - g) * algae;
          b += (110 - b) * algae;
        }
      } else if (e > MOUNTAIN_LEVEL) {
        const height = (e - MOUNTAIN_LEVEL) / (1 - MOUNTAIN_LEVEL);
        const cap = Math.max(snow, height > 0.55 ? (height - 0.55) / 0.45 : 0);
        r = ROCK[0] + 40 * height + (SNOW[0] - ROCK[0]) * cap;
        g = ROCK[1] + 40 * height + (SNOW[1] - ROCK[1]) * cap;
        b = ROCK[2] + 40 * height + (SNOW[2] - ROCK[2]) * cap;
      } else {
        const grass = fields ? fields.grass[c] / 255 : 0.5;
        const cover = Math.min(1, grass * 1.5);
        r = SOIL[0] + (greens.grass[0] - SOIL[0]) * cover;
        g = SOIL[1] + (greens.grass[1] - SOIL[1]) * cover;
        b = SOIL[2] + (greens.grass[2] - SOIL[2]) * cover;
        if (fields) {
          const shrub = (fields.shrub[c] / 255) * 0.35;
          r += (58 - r) * shrub;
          g += (104 - g) * shrub;
          b += (62 - b) * shrub;
          const litter = (fields.detritus[c] / 255) * 0.18;
          r += (96 - r) * litter;
          g += (72 - g) * litter;
          b += (50 - b) * litter;
        }
        const trees = canopy[c] * 0.82;
        r += (greens.forest[0] - r) * trees;
        g += (greens.forest[1] - g) * trees;
        b += (greens.forest[2] - b) * trees;
        if (e > HILL_LEVEL) {
          const hill = ((e - HILL_LEVEL) / (MOUNTAIN_LEVEL - HILL_LEVEL)) * 0.55;
          r += (ROCK[0] + 14 - r) * hill;
          g += (ROCK[1] - g) * hill;
          b += (ROCK[2] - 26 - b) * hill;
        }
        // Bãi cát ven nước (cũng là lòng hồ lộ ra khi hạn).
        const shore = 1 - Math.min(1, -depth / 0.014);
        if (shore > 0) {
          r += (SAND[0] - r) * shore * 0.8;
          g += (SAND[1] - g) * shore * 0.8;
          b += (SAND[2] - b) * shore * 0.8;
        }
        if (snow > 0) {
          const white = snow * (1 - canopy[c] * 0.5);
          r += (SNOW[0] - r) * white;
          g += (SNOW[1] - g) * white;
          b += (SNOW[2] - b) * white;
        }
        if (fields && fields.fire[c] > 0) {
          r = 255;
          g = 120 + 20 * fields.fire[c];
          b = 30;
        } else if (fields && grass < 0.03 && fields.detritus[c] < 8 && canopy[c] < 0.2 && shore <= 0) {
          // Đất trụi sau cháy: ám tro.
          r += (ASH[0] - r) * 0.35;
          g += (ASH[1] - g) * 0.35;
          b += (ASH[2] - b) * 0.35;
        }
      }
      const shade = this.shade[c];
      const o = c * 4;
      data[o] = r * shade;
      data[o + 1] = g * shade;
      data[o + 2] = b * shade;
      data[o + 3] = 255;
    }
    this.context.putImageData(this.image, 0, 0);
  }

  /** Trường gần nhất đã nhận (để renderer vẽ chi tiết: bụi cây, quả…). */
  get fields(): FieldSnapshot | null {
    return this.lastFields;
  }
}
