/**
 * Ảnh chụp trạng thái để vẽ. Renderer (2D lẫn 3D) CHỈ đọc cấu trúc này — không bao giờ chạm vào `Simulation`.
 * Mọi mảng là typed array để chuyển từ Worker sang luồng giao diện mà không cần sao chép (transferable).
 */
import { CELLS, MAX_GENES, SNOW_TEMPERATURE } from './constants';
import { capacityOf } from './actions';
import { clamp01 } from './detmath';
import { GENE_COLD, GENE_HUE, GENE_LIGHT, GENE_SIZE, GENE_SPEED, GENE_VISION } from './genetics';
import type { Simulation } from './simulation';

/** Số số thực mô tả một cá thể trong `animals`. */
export const SNAPSHOT_STRIDE = 18;
export const SNAP_X = 0;
export const SNAP_Y = 1;
export const SNAP_HEADING_X = 2;
export const SNAP_HEADING_Y = 3;
/** Vận tốc hiện tại (u/tick) — renderer dùng để nội suy vị trí giữa hai tick. */
export const SNAP_VX = 4;
export const SNAP_VY = 5;
export const SNAP_SPECIES = 6;
export const SNAP_STATE = 7;
export const SNAP_ID = 8;
export const SNAP_LINEAGE = 9;
/** Khối lượng hiện tại / khối lượng trưởng thành chuẩn của loài (con non < 1; gen kích thước lớn > 1). */
export const SNAP_MASS = 10;
export const SNAP_GENE_SPEED = 11;
export const SNAP_GENE_VISION = 12;
export const SNAP_GENE_HUE = 13;
export const SNAP_GENE_LIGHT = 14;
export const SNAP_GENE_COLD = 15;
/** Gen đặc thù đầu tiên của loài, chuẩn hoá về [0, 1] theo biên của gen. */
export const SNAP_GENE_SPECIAL = 16;
/** Bit 0: đực; bit 1: đang bệnh; bit 2: mang thai; bit 3: con non; phần thập phân ×: tỉ lệ dự trữ. */
export const SNAP_FLAGS = 17;

/** Số số thực mô tả một cái xác: x, y, năng lượng, loài. */
export const CORPSE_STRIDE = 4;

export interface FieldSnapshot {
  /** Mỗi trường lượng tử hoá về 0–255 theo thang ghi trong `fieldScale`. */
  grass: Uint8Array;
  shrub: Uint8Array;
  fruit: Uint8Array;
  algae: Uint8Array;
  insects: Uint8Array;
  fungi: Uint8Array;
  detritus: Uint8Array;
  fire: Uint8Array;
}

export interface RenderSnapshot {
  tick: number;
  count: number;
  animals: Float32Array;
  corpseCount: number;
  corpses: Float32Array;
  /** Chỉ có ở những khung được yêu cầu kèm trường (tốn băng thông hơn). */
  fields: FieldSnapshot | null;
  climate: {
    season: number;
    yearPhase: number;
    daylight: number;
    temperature: number;
    rain: number;
    drought: boolean;
    flood: boolean;
    waterLevel: number;
    soilWetness: number;
    snow: boolean;
  };
}

/** Thang lượng tử hoá của từng trường: giá trị E/ô ứng với 255. */
export const FIELD_SCALE = {
  grass: 300,
  shrub: 260,
  fruit: 90,
  algae: 8,
  insects: 4,
  fungi: 20,
  detritus: 200,
} as const;

function quantise(source: Float64Array, scale: number): Uint8Array {
  const out = new Uint8Array(CELLS);
  const k = 255 / scale;
  for (let c = 0; c < CELLS; c++) {
    const v = source[c] * k;
    out[c] = v > 255 ? 255 : v < 0 ? 0 : v;
  }
  return out;
}

/** Tạo ảnh chụp để vẽ. */
export function takeSnapshot(sim: Simulation, includeFields: boolean): RenderSnapshot {
  const a = sim.animals;
  const species = sim.registry.animals;
  const animals = new Float32Array(a.count * SNAPSHOT_STRIDE);
  let n = 0;
  for (let i = 0; i < a.high; i++) {
    if (a.alive[i] === 0) continue;
    const sp = species[a.species[i]];
    const g = i * MAX_GENES;
    const o = n * SNAPSHOT_STRIDE;
    animals[o + SNAP_X] = a.x[i];
    animals[o + SNAP_Y] = a.y[i];
    animals[o + SNAP_HEADING_X] = a.headingX[i];
    animals[o + SNAP_HEADING_Y] = a.headingY[i];
    animals[o + SNAP_VX] = a.vx[i];
    animals[o + SNAP_VY] = a.vy[i];
    animals[o + SNAP_SPECIES] = sp.index;
    animals[o + SNAP_STATE] = a.state[i];
    animals[o + SNAP_ID] = a.id[i];
    animals[o + SNAP_LINEAGE] = a.lineage[i];
    animals[o + SNAP_MASS] = a.structure[i] / sp.mass;
    animals[o + SNAP_GENE_SPEED] = a.phenotype[g + GENE_SPEED];
    animals[o + SNAP_GENE_VISION] = a.phenotype[g + GENE_VISION];
    animals[o + SNAP_GENE_HUE] = a.phenotype[g + GENE_HUE];
    animals[o + SNAP_GENE_LIGHT] = a.phenotype[g + GENE_LIGHT];
    animals[o + SNAP_GENE_COLD] = a.phenotype[g + GENE_COLD];
    const special = sp.genes[GENE_COLD + 1];
    animals[o + SNAP_GENE_SPECIAL] = special
      ? (a.phenotype[g + GENE_COLD + 1] - special.min) / (special.max - special.min)
      : 0.5;
    const juvenile = a.structure[i] < 0.75 * sp.mass * a.phenotype[g + GENE_SIZE];
    const bits = a.sex[i] | (a.sick[i] > 0 ? 2 : 0) | (a.gestation[i] > 0 ? 4 : 0) | (juvenile ? 8 : 0);
    animals[o + SNAP_FLAGS] = bits + 0.999 * clamp01(a.energy[i] / capacityOf(sim, i));
    n++;
  }

  const corpseStore = sim.corpses;
  const corpses = new Float32Array(corpseStore.count * CORPSE_STRIDE);
  let m = 0;
  for (let c = 0; c < corpseStore.high; c++) {
    if (corpseStore.alive[c] === 0) continue;
    corpses[m * CORPSE_STRIDE] = corpseStore.x[c];
    corpses[m * CORPSE_STRIDE + 1] = corpseStore.y[c];
    corpses[m * CORPSE_STRIDE + 2] = corpseStore.energy[c];
    corpses[m * CORPSE_STRIDE + 3] = corpseStore.species[c];
    m++;
  }

  const world = sim.world;
  const climate = world.climate;
  let fields: FieldSnapshot | null = null;
  if (includeFields) {
    fields = {
      grass: quantise(world.grass, FIELD_SCALE.grass),
      shrub: quantise(world.shrub, FIELD_SCALE.shrub),
      fruit: quantise(world.fruit, FIELD_SCALE.fruit),
      algae: quantise(world.algae, FIELD_SCALE.algae),
      insects: quantise(world.insects, FIELD_SCALE.insects),
      fungi: quantise(world.fungi, FIELD_SCALE.fungi),
      detritus: quantise(world.detritus, FIELD_SCALE.detritus),
      fire: world.fire.slice(),
    };
  }
  return {
    tick: sim.tick,
    count: n,
    animals,
    corpseCount: m,
    corpses,
    fields,
    climate: {
      season: climate.season,
      yearPhase: climate.yearPhase,
      daylight: climate.daylight,
      temperature: climate.temperature,
      rain: climate.rain,
      drought: climate.droughtTicks > 0,
      flood: climate.floodTicks > 0,
      waterLevel: climate.waterLevel,
      soilWetness: climate.soilWetness,
      snow: climate.temperatureDaily < SNOW_TEMPERATURE,
    },
  };
}
