/**
 * Thống kê: bộ đếm tích luỹ (sinh, chết theo nguyên nhân, ai ăn gì) và ảnh chụp số liệu định kỳ.
 * Chỉ ĐỌC trạng thái mô phỏng — không ảnh hưởng tới diễn biến.
 */
import { MAX_GENES } from './constants';
import { DEATH_CAUSES } from './entities';
import type { Simulation } from './simulation';

/** Số ô của histogram gen. */
export const HISTOGRAM_BINS = 24;

/** Số liệu của một thời điểm. */
export interface StatsFrame {
  tick: number;
  /** Số cá thể của từng loài động vật (theo chỉ số loài). */
  populations: number[];
  /** Tổng sinh khối các trường (E): cỏ, cây bụi, quả, tảo, côn trùng, nấm, mùn, xác. */
  fields: {
    grass: number;
    shrub: number;
    fruit: number;
    algae: number;
    insects: number;
    fungi: number;
    detritus: number;
    corpses: number;
    soilN: number;
  };
  /** [mã dòng, số cá thể] cho các dòng còn sống. */
  lineages: [number, number][];
  /** Trung bình và độ lệch chuẩn kiểu hình của từng gen, theo loài: [loài][gen]. */
  geneMean: number[][];
  geneSd: number[][];
  climate: {
    season: number;
    temperature: number;
    daylight: number;
    rain: number;
    drought: boolean;
    waterLevel: number;
    soilWetness: number;
  };
  /** Bộ đếm tích luỹ từ đầu: sinh và chết theo loài. */
  births: number[];
  deaths: number[];
}

/** Bảng "ai nhớ ai": phả hệ lưu trong bộ đệm vòng theo mã định danh. */
export class Pedigree {
  private readonly mask: number;
  private readonly id: Uint32Array;
  private readonly mother: Uint32Array;
  private readonly father: Uint32Array;
  private readonly species: Uint8Array;
  private readonly lineage: Uint16Array;
  private readonly born: Int32Array;
  private readonly died: Int32Array;

  /** @param bits bộ đệm nhớ 2^bits cá thể gần nhất; tổ tiên xa hơn sẽ hiện là "không rõ" */
  constructor(bits = 17) {
    const size = 1 << bits;
    this.mask = size - 1;
    this.id = new Uint32Array(size);
    this.mother = new Uint32Array(size);
    this.father = new Uint32Array(size);
    this.species = new Uint8Array(size);
    this.lineage = new Uint16Array(size);
    this.born = new Int32Array(size);
    this.died = new Int32Array(size);
  }

  add(id: number, mother: number, father: number, species: number, lineage: number, tick: number): void {
    const k = id & this.mask;
    this.id[k] = id;
    this.mother[k] = mother;
    this.father[k] = father;
    this.species[k] = species;
    this.lineage[k] = lineage;
    this.born[k] = tick;
    this.died[k] = -1;
  }

  markDeath(id: number, tick: number): void {
    const k = id & this.mask;
    if (this.id[k] === id) this.died[k] = tick;
  }

  /** Bản ghi của một cá thể, hoặc null nếu đã bị ghi đè/không tồn tại. */
  get(id: number): {
    id: number;
    mother: number;
    father: number;
    species: number;
    lineage: number;
    born: number;
    died: number;
  } | null {
    const k = id & this.mask;
    if (id === 0 || this.id[k] !== id) return null;
    return {
      id,
      mother: this.mother[k],
      father: this.father[k],
      species: this.species[k],
      lineage: this.lineage[k],
      born: this.born[k],
      died: this.died[k],
    };
  }
}

export class StatsCollector {
  readonly births: Float64Array;
  /** deaths[loài * DEATH_CAUSES + nguyên nhân] */
  readonly deaths: Float64Array;
  /** kills[kẻ săn * số loài + con mồi] */
  readonly kills: Float64Array;
  /** Ma trận ăn tích luỹ: intake[kho người ăn * số kho + kho nguồn] (E). Xác do loài khác giết tính vào kho "corpse". */
  readonly intake: Float64Array;
  speciations = 0;
  private readonly speciesCount: number;
  private readonly poolCount: number;

  constructor(speciesCount: number, poolCount: number) {
    this.speciesCount = speciesCount;
    this.poolCount = poolCount;
    this.births = new Float64Array(speciesCount);
    this.deaths = new Float64Array(speciesCount * DEATH_CAUSES);
    this.kills = new Float64Array(speciesCount * speciesCount);
    this.intake = new Float64Array(poolCount * poolCount);
  }

  addBirths(species: number, count: number): void {
    this.births[species] += count;
  }
  addDeath(species: number, cause: number): void {
    this.deaths[species * DEATH_CAUSES + cause]++;
  }
  addKill(hunter: number, prey: number): void {
    this.kills[hunter * this.speciesCount + prey]++;
  }
  addIntake(consumerPool: number, sourcePool: number, amount: number): void {
    this.intake[consumerPool * this.poolCount + sourcePool] += amount;
  }
  addSpeciation(): void {
    this.speciations++;
  }

  /** Chụp số liệu hiện tại. */
  collect(sim: Simulation): StatsFrame {
    const a = sim.animals;
    const world = sim.world;
    const speciesCount = this.speciesCount;
    const populations = new Array<number>(speciesCount).fill(0);
    const sums = new Float64Array(speciesCount * MAX_GENES);
    const squares = new Float64Array(speciesCount * MAX_GENES);
    const lineageCounts = new Map<number, number>();
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 0) continue;
      const species = a.species[i];
      populations[species]++;
      lineageCounts.set(a.lineage[i], (lineageCounts.get(a.lineage[i]) ?? 0) + 1);
      const g = i * MAX_GENES;
      const s = species * MAX_GENES;
      for (let k = 0; k < MAX_GENES; k++) {
        const value = a.phenotype[g + k];
        sums[s + k] += value;
        squares[s + k] += value * value;
      }
    }
    const geneMean: number[][] = [];
    const geneSd: number[][] = [];
    for (let species = 0; species < speciesCount; species++) {
      const n = populations[species];
      const means: number[] = [];
      const sds: number[] = [];
      const count = sim.registry.animals[species].genes.length;
      for (let k = 0; k < count; k++) {
        const mean = n > 0 ? sums[species * MAX_GENES + k] / n : 0;
        const variance = n > 0 ? Math.max(0, squares[species * MAX_GENES + k] / n - mean * mean) : 0;
        means.push(mean);
        sds.push(Math.sqrt(variance));
      }
      geneMean.push(means);
      geneSd.push(sds);
    }

    const sum = (field: Float64Array): number => {
      let total = 0;
      for (let c = 0; c < field.length; c++) total += field[c];
      return total;
    };
    let corpses = 0;
    for (let c = 0; c < sim.corpses.high; c++)
      if (sim.corpses.alive[c] === 1) corpses += sim.corpses.energy[c];

    const deaths = new Array<number>(speciesCount).fill(0);
    for (let species = 0; species < speciesCount; species++) {
      for (let cause = 0; cause < DEATH_CAUSES; cause++)
        deaths[species] += this.deaths[species * DEATH_CAUSES + cause];
    }
    const climate = world.climate;
    return {
      tick: sim.tick,
      populations,
      fields: {
        grass: sum(world.grass),
        shrub: sum(world.shrub),
        fruit: sum(world.fruit),
        algae: sum(world.algae),
        insects: sum(world.insects),
        fungi: sum(world.fungi),
        detritus: sum(world.detritus),
        corpses,
        soilN: sum(world.soilN),
      },
      lineages: [...lineageCounts.entries()].sort((p, q) => p[0] - q[0]),
      geneMean,
      geneSd,
      climate: {
        season: climate.season,
        temperature: climate.temperature,
        daylight: climate.daylight,
        rain: climate.rain,
        drought: climate.droughtTicks > 0,
        waterLevel: climate.waterLevel,
        soilWetness: climate.soilWetness,
      },
      births: Array.from(this.births),
      deaths,
    };
  }

  /**
   * Histogram kiểu hình của mọi gen của một loài (có thể lọc theo một dòng).
   * @returns mảng [gen][ô] đếm số cá thể; biên histogram là [min, max] của gen
   */
  histogram(sim: Simulation, species: number, lineage = -1): number[][] {
    const a = sim.animals;
    const genes = sim.registry.animals[species].genes;
    const result = genes.map(() => new Array<number>(HISTOGRAM_BINS).fill(0));
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 0 || a.species[i] !== species) continue;
      if (lineage >= 0 && a.lineage[i] !== lineage) continue;
      for (let k = 0; k < genes.length; k++) {
        const spec = genes[k];
        const t = (a.phenotype[i * MAX_GENES + k] - spec.min) / (spec.max - spec.min);
        const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(t * HISTOGRAM_BINS)));
        result[k][bin]++;
      }
    }
    return result;
  }
}
