/**
 * Lớp `Simulation`: điểm vào duy nhất của lõi mô phỏng.
 *
 * Thuần TypeScript, không DOM, không đồng hồ thực. Cùng `SimulationOptions` ⇒ cùng diễn biến tới từng bit,
 * dù chạy trong Node (CLI, test) hay trong Web Worker.
 */
import {
  CELLS,
  CELL_SIZE,
  CORPSE_DECAY,
  FIELD_STRIPES,
  FIRE_INTERVAL,
  GRID,
  GROUP_INTERVAL,
  HASH_CELL,
  HILL_LEVEL,
  MAX_GENES,
  MOUNTAIN_LEVEL,
  NUTRIENT_PER_ENERGY,
  SPECIATION_INTERVAL,
  WATER_LEVEL_BASE,
  WORLD_SIZE,
} from './constants';
import { capacityOf, passable, removeCorpse } from './actions';
import { stepAnimals } from './animals';
import { type ThinkContext, createContext } from './context';
import { clamp, clamp01 } from './detmath';
import { type SimEvent, applyEvent, updateFire } from './disasters';
import { AnimalStore, CorpseStore, State } from './entities';
import { updateEnvironment } from './environment';
import { initFields, updateFields } from './fields';
import { GENE_SIZE, GENOME_STRIDE, expressGenome, randomGenome } from './genetics';
import { GroupTable } from './groups';
import { Ledger, POOL_CORPSE, POOL_DETRITUS, POOL_EXTERNAL, type PoolAudit } from './ledger';
import { DEFAULT_PARAMS, type SimParams } from './params';
import { Rng } from './rng';
import { LOTKA_VOLTERRA_COUNTS, lotkaVolterraData } from './scenario';
import { type RenderSnapshot, takeSnapshot } from './snapshot';
import { SpatialHash } from './spatial';
import { LineageTree } from './speciation';
import { stateHash } from './statehash';
import { Pedigree, type StatsFrame, StatsCollector } from './stats';
import { type Terrain, cellAt, generateFlatTerrain, generateTerrain } from './terrain';
import { World } from './world';
import { SPECIES_DATA } from '../species/data';
import { type SpeciesRegistry, createRegistry } from '../species/registry';
import { LOCO_AIR, LOCO_AMPHIBIOUS, LOCO_WATER, type SpeciesRuntime } from '../species/runtime';
import type { Habitat, SpeciesDef } from '../species/types';

/** Kịch bản: hệ sinh thái đầy đủ, hoặc thí nghiệm con mồi–kẻ săn trên đồng cỏ phẳng. */
export type Scenario = 'default' | 'lotka-volterra';

export interface SimulationOptions {
  seed: number;
  params?: Partial<SimParams>;
  scenario?: Scenario;
  /** Chỉ thả các loài động vật này lúc khởi đầu (mặc định: mọi loài có `starting: true`). */
  species?: readonly string[];
  /** Ghi đè số lượng khởi đầu theo khoá loài. */
  counts?: Readonly<Record<string, number>>;
  /** Dữ liệu loài (mặc định: bộ đi kèm trong `src/species/data`). */
  data?: readonly SpeciesDef[];
}

/** Cá thể của quần thể khởi tạo bắt đầu với dự trữ đầy tới mức này. */
const INITIAL_RESERVE = 0.85;

/** Tham số bị ép trong kịch bản Lotka–Volterra: tắt mùa, ngày/đêm, thời tiết, khát, biến dị, phân loài. */
const LOTKA_VOLTERRA_PARAMS: Partial<SimParams> = {
  seasons: false,
  dayNight: false,
  weather: false,
  thirst: false,
  geneticVariation: false,
  speciation: false,
  mutationRate: 0,
};

export interface AuditReport {
  pools: PoolAudit[];
  /** Sai số tương đối lớn nhất giữa sổ cái và tồn kho đo được. */
  maxEnergyError: number;
  /** Tổng N hiện tại, tổng N kỳ vọng (ban đầu + đưa từ ngoài vào), và sai số tương đối. */
  nutrientTotal: number;
  nutrientExpected: number;
  nutrientError: number;
}

/** Thông tin chi tiết của một cá thể cho inspector. */
export interface InspectInfo {
  id: number;
  alive: boolean;
  species: string;
  speciesIndex: number;
  lineage: number;
  lineageName: string;
  sex: 'cái' | 'đực';
  state: number;
  age: number;
  lifespan: number;
  adult: boolean;
  generation: number;
  energy: number;
  capacity: number;
  structure: number;
  water: number;
  health: number;
  pregnant: boolean;
  sick: boolean;
  x: number;
  y: number;
  group: number;
  genes: {
    name: string;
    label: string;
    value: number;
    alleles: [number, number];
    min: number;
    max: number;
  }[];
  /** Tổ tiên theo từng đời: [bố mẹ, ông bà…]; mỗi phần tử là mã định danh hoặc 0 nếu không rõ. */
  ancestors: { id: number; born: number; died: number; lineage: number }[][];
  offspringAlive: number;
}

export class Simulation {
  readonly seed: number;
  readonly scenario: Scenario;
  readonly params: SimParams;
  readonly rng: Rng;
  readonly registry: SpeciesRegistry;
  readonly world: World;
  readonly ledger: Ledger;
  readonly animals = new AnimalStore();
  readonly corpses = new CorpseStore();
  readonly hash = new SpatialHash(WORLD_SIZE, HASH_CELL);
  readonly corpseHash = new SpatialHash(WORLD_SIZE, HASH_CELL * 2);
  readonly groups = new GroupTable();
  readonly lineages: LineageTree;
  readonly stats: StatsCollector;
  readonly pedigree = new Pedigree();
  /** Danh sách khe theo loài (dựng lại mỗi tick): items[start[s] .. start[s+1]) là các cá thể của loài s. */
  readonly members: { start: Int32Array; items: Int32Array };
  /** Kho sổ cái của từng trường thức ăn, theo thứ tự FOOD_FIELDS (quả thuộc kho cây bụi). */
  readonly foodPools: number[];
  /** Bộ đệm nháp cho truy vấn spatial hash. */
  scratch = new Int32Array(4096);
  readonly context: ThinkContext;
  tick = 0;

  private readonly initialNutrient: number;
  private externalNutrient = 0;

  constructor(options: SimulationOptions) {
    this.seed = options.seed >>> 0;
    this.scenario = options.scenario ?? 'default';
    this.params = {
      ...DEFAULT_PARAMS,
      ...options.params,
      ...(this.scenario === 'lotka-volterra' ? LOTKA_VOLTERRA_PARAMS : {}),
    };
    this.rng = new Rng(this.seed);
    const data = options.data ?? SPECIES_DATA;
    this.registry = createRegistry(this.scenario === 'lotka-volterra' ? lotkaVolterraData(data) : data);
    const terrain: Terrain =
      this.scenario === 'lotka-volterra' ? generateFlatTerrain() : generateTerrain(this.rng);
    this.world = new World(terrain);
    this.ledger = new Ledger(this.registry.poolNames);
    this.lineages = new LineageTree(this.registry.animals.map((species) => species.def.name));
    this.stats = new StatsCollector(this.registry.animals.length, this.ledger.poolCount);
    this.members = { start: new Int32Array(this.registry.animals.length + 1), items: new Int32Array(4096) };
    const pools = this.registry.pools;
    this.foodPools = [pools.grass, pools.shrub, pools.shrub, pools.algae, pools.insects];
    this.context = createContext(this);

    const full = this.scenario === 'default';
    initFields(this.world, this.registry.fields, this.registry.pools, this.ledger, {
      shrubs: full,
      insects: full,
    });
    updateEnvironment(this.world, 0, this.params, this.rng);
    this.populate(options);
    this.rebuildIndexes();
    this.initialNutrient = this.measureNutrient();
  }

  // ───────────────────────────── Vòng lặp chính ─────────────────────────────

  /** Tiến mô phỏng đúng một tick. */
  step(): void {
    updateEnvironment(this.world, this.tick, this.params, this.rng);
    this.rebuildIndexes();
    updateFields(this.world, this.tick, this.params, this.registry.fields, this.registry.pools, this.ledger);
    if (this.world.burning.length > 0 && this.tick % FIRE_INTERVAL === 0) updateFire(this);
    stepAnimals(this);
    this.decayCorpses();
    if (this.tick % GROUP_INTERVAL === 0) this.groups.update(this);
    if (this.tick % SPECIATION_INTERVAL === 0 && this.tick > 0)
      this.lineages.check(this, this.params.speciation);
    this.tick++;
  }

  /** Tiến mô phỏng `ticks` tick. */
  run(ticks: number): void {
    for (let k = 0; k < ticks; k++) this.step();
  }

  private rebuildIndexes(): void {
    const a = this.animals;
    const needed = Math.max(a.high, this.corpses.high) + 16;
    if (this.scratch.length < needed) this.scratch = new Int32Array(needed * 2);
    this.hash.build(a.high, a.alive, a.x, a.y);
    this.corpseHash.build(this.corpses.high, this.corpses.alive, this.corpses.x, this.corpses.y);

    // Danh sách theo loài bằng counting sort.
    const members = this.members;
    const start = members.start;
    start.fill(0);
    for (let i = 0; i < a.high; i++) if (a.alive[i] === 1) start[a.species[i] + 1]++;
    for (let s = 0; s < start.length - 1; s++) start[s + 1] += start[s];
    if (members.items.length < a.count) members.items = new Int32Array(a.count * 2);
    const fill = new Int32Array(start.length);
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 0) continue;
      const s = a.species[i];
      members.items[start[s] + fill[s]++] = i;
    }
  }

  /** Xác rữa dần thành mùn (nhanh hơn khi ấm). Mỗi xác được xử lý mỗi FIELD_STRIPES tick. */
  private decayCorpses(): void {
    const corpses = this.corpses;
    const stripe = this.tick % FIELD_STRIPES;
    const warmth = 0.3 + 0.7 * clamp01(this.world.climate.temperatureDaily / 20);
    const rate = CORPSE_DECAY * FIELD_STRIPES * warmth;
    let rotted = 0;
    for (let c = stripe; c < corpses.high; c += FIELD_STRIPES) {
      if (corpses.alive[c] === 0) continue;
      const loss = corpses.energy[c] * rate;
      corpses.energy[c] -= loss;
      corpses.age[c] += FIELD_STRIPES;
      this.world.detritus[cellAt(corpses.x[c], corpses.y[c])] += loss;
      rotted += loss;
      if (corpses.energy[c] < 0.05) removeCorpse(this, c);
    }
    this.ledger.flow(POOL_CORPSE, POOL_DETRITUS, rotted);
  }

  // ───────────────────────────── Khởi tạo quần thể ─────────────────────────────

  private populate(options: SimulationOptions): void {
    const scenarioCounts = this.scenario === 'lotka-volterra' ? LOTKA_VOLTERRA_COUNTS : null;
    const defaults = scenarioCounts ? Object.keys(scenarioCounts) : null;
    const wanted = options.species ?? defaults;
    const habitats = this.habitatCells();
    for (const species of this.registry.animals) {
      const included = wanted ? wanted.includes(species.key) : species.def.starting;
      if (!included) continue;
      const total =
        options.counts?.[species.key] ?? scenarioCounts?.[species.key] ?? species.def.initialCount;
      const cells = habitats[species.def.habitat];
      if (cells.length === 0) continue;
      const cluster = Math.max(1, species.def.spawnCluster);
      let placed = 0;
      while (placed < total) {
        const centre = cells[this.rng.int(cells.length)];
        const cx = ((centre % GRID) + this.rng.next()) * CELL_SIZE;
        const cy = (((centre / GRID) | 0) + this.rng.next()) * CELL_SIZE;
        const group = species.usesGroups ? this.groups.create() : -1;
        const size = Math.min(cluster, total - placed);
        for (let k = 0; k < size; k++) {
          let x = cx;
          let y = cy;
          if (k > 0) {
            // Thành viên cụm rải quanh tâm; nếu rơi vào chỗ không sống được thì đứng ngay tâm.
            const tx = cx + (this.rng.next() - 0.5) * 50;
            const ty = cy + (this.rng.next() - 0.5) * 50;
            if (
              tx > 1 &&
              ty > 1 &&
              tx < WORLD_SIZE - 1 &&
              ty < WORLD_SIZE - 1 &&
              passable(this, species, cellAt(tx, ty))
            ) {
              x = tx;
              y = ty;
            }
          }
          // Trong bầy có tổ chức, giới tính xen kẽ để bầy nào cũng sinh sản được.
          this.spawn(species, x, y, group, group >= 0 ? k & 1 : -1);
          placed++;
        }
      }
    }
  }

  /** Danh sách ô theo sinh cảnh, để rải quần thể khởi tạo. */
  private habitatCells(): Record<Habitat, number[]> {
    const { elevation, canopy } = this.world.terrain;
    const result: Record<Habitat, number[]> = { meadow: [], forest: [], land: [], water: [], shore: [] };
    for (let c = 0; c < CELLS; c++) {
      const e = elevation[c];
      if (e < WATER_LEVEL_BASE - 0.012) {
        result.water.push(c);
        continue;
      }
      if (e < WATER_LEVEL_BASE + 0.002 || e >= MOUNTAIN_LEVEL) continue;
      result.land.push(c);
      if (canopy[c] > 0.5) result.forest.push(c);
      else if (canopy[c] < 0.35 && e < HILL_LEVEL) result.meadow.push(c);
      const distance = this.world.waterDistance[c];
      if (distance >= 1 && distance <= 3) result.shore.push(c);
    }
    if (result.forest.length === 0) result.forest = result.land;
    if (result.meadow.length === 0) result.meadow = result.land;
    return result;
  }

  /**
   * Tạo một cá thể mới từ "bên ngoài hệ" (quần thể khởi tạo hoặc loài xâm lấn).
   * Năng lượng của nó được ghi vào sổ cái là đến từ nguồn EXTERNAL.
   * @param forcedSex 0/1 để ép giới tính, −1 để ngẫu nhiên
   */
  private spawn(species: SpeciesRuntime, x: number, y: number, group: number, forcedSex: number): number {
    const a = this.animals;
    const rng = this.rng;
    const slot = a.allocate();
    a.species[slot] = species.index;
    randomGenome(a.alleles, slot * GENOME_STRIDE, species.genes, rng, this.params.geneticVariation ? 1 : 0);
    expressGenome(a.alleles, slot * GENOME_STRIDE, a.phenotype, slot * MAX_GENES);
    const sexRoll = rng.nextU32() & 1;
    a.sex[slot] = forcedSex >= 0 ? forcedSex : sexRoll;
    a.lineage[slot] = species.index;
    a.x[slot] = clamp(x, 1, WORLD_SIZE - 1);
    a.y[slot] = clamp(y, 1, WORLD_SIZE - 1);
    a.targetX[slot] = a.x[slot];
    a.targetY[slot] = a.y[slot];
    a.homeX[slot] = a.x[slot];
    a.homeY[slot] = a.y[slot];
    a.group[slot] = group;

    // Tuổi rải từ vừa cai sữa tới trung niên để quần thể có cấu trúc tuổi ngay từ đầu.
    const youngest = Math.max(species.weanAge, species.larvaUntil, 0.3 * species.maturity);
    const age = youngest + rng.next() * (0.45 * species.lifespan - youngest);
    a.age[slot] = age;
    const adultMass = species.mass * a.phenotype[slot * MAX_GENES + GENE_SIZE];
    const grown = clamp01(species.birthMass + (1 - species.birthMass) * (age / species.maturity));
    a.structure[slot] = adultMass * grown;
    a.energy[slot] = INITIAL_RESERVE * capacityOf(this, slot);
    a.reproCooldown[slot] = rng.next() * species.cooldown * 0.5;
    this.ledger.flow(POOL_EXTERNAL, species.pool, a.energy[slot] + a.structure[slot]);

    const cell = cellAt(a.x[slot], a.y[slot]);
    const terrain = this.world.terrain;
    let region = 0;
    if (species.locomotion === LOCO_WATER) region = terrain.waterRegion[cell];
    else if (species.locomotion === LOCO_AMPHIBIOUS) region = terrain.shoreRegion[cell];
    else if (species.locomotion !== LOCO_AIR) region = terrain.landRegion[cell];
    a.region[slot] = region;
    a.natalRegion[slot] = region;
    this.pedigree.add(a.id[slot], 0, 0, species.index, species.index, this.tick);
    return slot;
  }

  /** Thả `count` cá thể của một loài quanh điểm (x, y) — dùng cho thảm hoạ "loài xâm lấn". */
  introduce(speciesIndex: number, count: number, x: number, y: number, radius: number): number {
    const species = this.registry.animals[speciesIndex];
    const group = species.usesGroups ? this.groups.create() : -1;
    let placed = 0;
    for (let k = 0; k < count; k++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const tx = x + (this.rng.next() - 0.5) * 2 * radius;
        const ty = y + (this.rng.next() - 0.5) * 2 * radius;
        if (tx < 2 || ty < 2 || tx > WORLD_SIZE - 2 || ty > WORLD_SIZE - 2) continue;
        if (!passable(this, species, cellAt(tx, ty))) continue;
        const slot = this.spawn(species, tx, ty, group, -1);
        this.externalNutrient +=
          NUTRIENT_PER_ENERGY * (this.animals.energy[slot] + this.animals.structure[slot]);
        placed++;
        break;
      }
    }
    return placed;
  }

  // ───────────────────────────── Đầu vào khi đang chạy ─────────────────────────────

  /** Áp dụng một sự kiện thảm hoạ. */
  applyEvent(event: SimEvent): void {
    applyEvent(this, event);
  }

  /** Đổi một tham số khi đang chạy. */
  setParam<K extends keyof SimParams>(key: K, value: SimParams[K]): void {
    this.params[key] = value;
  }

  // ───────────────────────────── Đọc trạng thái ─────────────────────────────

  /** Chuỗi băm 64‑bit của toàn bộ trạng thái. */
  stateHash(): string {
    return stateHash(this);
  }

  /** Số liệu thống kê hiện tại. */
  collectStats(): StatsFrame {
    return this.stats.collect(this);
  }

  /** Ảnh chụp để vẽ. */
  snapshot(includeFields: boolean): RenderSnapshot {
    return takeSnapshot(this, includeFields);
  }

  /** Số cá thể còn sống của từng loài động vật. */
  populations(): number[] {
    const counts = new Array<number>(this.registry.animals.length).fill(0);
    const a = this.animals;
    for (let i = 0; i < a.high; i++) if (a.alive[i] === 1) counts[a.species[i]]++;
    return counts;
  }

  /** Tồn kho năng lượng đo trực tiếp từ trạng thái, theo chỉ số kho của sổ cái. */
  measureStocks(): Float64Array {
    const stocks = new Float64Array(this.ledger.poolCount);
    const world = this.world;
    const pools = this.registry.pools;
    for (let c = 0; c < CELLS; c++) {
      stocks[pools.grass] += world.grass[c];
      stocks[pools.shrub] += world.shrub[c] + world.fruit[c];
      stocks[pools.algae] += world.algae[c];
      stocks[pools.insects] += world.insects[c];
      stocks[pools.fungi] += world.fungi[c];
      stocks[POOL_DETRITUS] += world.detritus[c];
    }
    const corpses = this.corpses;
    for (let c = 0; c < corpses.high; c++)
      if (corpses.alive[c] === 1) stocks[POOL_CORPSE] += corpses.energy[c];
    const a = this.animals;
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 1) stocks[this.registry.animals[a.species[i]].pool] += a.energy[i] + a.structure[i];
    }
    return stocks;
  }

  /** Tổng dinh dưỡng của hệ: N khoáng trong đất/nước + N trong mọi chất hữu cơ. */
  measureNutrient(): number {
    let mineral = 0;
    for (let c = 0; c < CELLS; c++) mineral += this.world.soilN[c];
    const stocks = this.measureStocks();
    let organic = 0;
    for (let pool = POOL_CORPSE; pool < stocks.length; pool++) organic += stocks[pool];
    return mineral + NUTRIENT_PER_ENERGY * organic;
  }

  /** Kiểm toán: đối chiếu sổ cái năng lượng với tồn kho thật, và kiểm tra bảo toàn dinh dưỡng. */
  audit(): AuditReport {
    const pools = this.ledger.audit(this.measureStocks());
    let maxEnergyError = 0;
    for (const pool of pools) if (pool.relativeError > maxEnergyError) maxEnergyError = pool.relativeError;
    const nutrientTotal = this.measureNutrient();
    const nutrientExpected = this.initialNutrient + this.externalNutrient;
    return {
      pools,
      maxEnergyError,
      nutrientTotal,
      nutrientExpected,
      nutrientError: Math.abs(nutrientTotal - nutrientExpected) / nutrientExpected,
    };
  }

  /** Tìm khe của cá thể theo mã định danh; −1 nếu không còn sống. */
  findSlot(id: number): number {
    const a = this.animals;
    for (let i = 0; i < a.high; i++) if (a.alive[i] === 1 && a.id[i] === id) return i;
    return -1;
  }

  /** Thông tin chi tiết của một cá thể (gen, trạng thái, phả hệ). */
  inspect(id: number): InspectInfo | null {
    const a = this.animals;
    const slot = this.findSlot(id);
    const record = this.pedigree.get(id);
    if (slot < 0 && !record) return null;

    const ancestors: InspectInfo['ancestors'] = [];
    let generation: number[] = record ? [record.mother, record.father] : [];
    for (let depth = 0; depth < 3 && generation.length > 0; depth++) {
      const row = generation.map((ancestor) => {
        const r = this.pedigree.get(ancestor);
        return r
          ? { id: r.id, born: r.born, died: r.died, lineage: r.lineage }
          : { id: 0, born: -1, died: -1, lineage: -1 };
      });
      ancestors.push(row);
      generation = generation.flatMap((ancestor) => {
        const r = this.pedigree.get(ancestor);
        return r ? [r.mother, r.father] : [0, 0];
      });
      if (generation.every((ancestor) => ancestor === 0)) break;
    }

    if (slot < 0) {
      const species = this.registry.animals[record!.species];
      return {
        id,
        alive: false,
        species: species.def.name,
        speciesIndex: species.index,
        lineage: record!.lineage,
        lineageName: this.lineages.nodes[record!.lineage]?.name ?? '?',
        sex: 'cái',
        state: State.IDLE,
        age: record!.died - record!.born,
        lifespan: species.lifespan,
        adult: false,
        generation: 0,
        energy: 0,
        capacity: 1,
        structure: 0,
        water: 0,
        health: 0,
        pregnant: false,
        sick: false,
        x: 0,
        y: 0,
        group: -1,
        genes: [],
        ancestors,
        offspringAlive: 0,
      };
    }

    const species = this.registry.animals[a.species[slot]];
    let offspringAlive = 0;
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 1 && (a.motherId[i] === id || a.fatherId[i] === id)) offspringAlive++;
    }
    return {
      id,
      alive: true,
      species: species.def.name,
      speciesIndex: species.index,
      lineage: a.lineage[slot],
      lineageName: this.lineages.nodes[a.lineage[slot]].name,
      sex: a.sex[slot] === 0 ? 'cái' : 'đực',
      state: a.state[slot],
      age: a.age[slot],
      lifespan: species.lifespan,
      adult: a.age[slot] >= species.maturity,
      generation: a.generation[slot],
      energy: a.energy[slot],
      capacity: capacityOf(this, slot),
      structure: a.structure[slot],
      water: a.water[slot],
      health: a.health[slot],
      pregnant: a.gestation[slot] > 0,
      sick: a.sick[slot] > 0,
      x: a.x[slot],
      y: a.y[slot],
      group: a.group[slot],
      genes: species.genes.map((gene, k) => ({
        name: gene.name,
        label: gene.label,
        value: a.phenotype[slot * MAX_GENES + k],
        alleles: [a.alleles[slot * GENOME_STRIDE + k * 2], a.alleles[slot * GENOME_STRIDE + k * 2 + 1]],
        min: gene.min,
        max: gene.max,
      })),
      ancestors,
      offspringAlive,
    };
  }
}
