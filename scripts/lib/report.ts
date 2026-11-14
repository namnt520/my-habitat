/**
 * Chạy mô phỏng không giao diện và gom kết quả thành một báo cáo JSON.
 * Dùng chung cho CLI (`pnpm sim`), chạy ổn định nhiều seed (`pnpm stability`) và test.
 */
import { DEATH_CAUSES, DEATH_LABELS } from '../../src/sim/entities';
import { POOL_CORPSE, POOL_DETRITUS, POOL_EXTERNAL, POOL_HEAT, POOL_SUN } from '../../src/sim/ledger';
import type { SimParams } from '../../src/sim/params';
import { type Scenario, Simulation } from '../../src/sim/simulation';
import type { StatsFrame } from '../../src/sim/stats';

export interface RunOptions {
  seed: number;
  ticks: number;
  scenario?: Scenario;
  species?: string[];
  counts?: Record<string, number>;
  params?: Partial<SimParams>;
  /** Khoảng lấy mẫu chuỗi thời gian (tick). */
  sampleEvery?: number;
  /** Dừng sớm khi một loài khởi đầu tuyệt chủng. */
  stopOnExtinction?: boolean;
  /** Gọi sau mỗi lần lấy mẫu (để in tiến độ). */
  onSample?: (frame: StatsFrame, sim: Simulation) => void;
}

export interface SpeciesReport {
  key: string;
  name: string;
  initial: number;
  final: number;
  min: number;
  max: number;
  mean: number;
  /** Tick tuyệt chủng, hoặc −1 nếu còn sống tới cuối. */
  extinctAt: number;
  births: number;
  deaths: Record<string, number>;
  /** Dòng năng lượng tích luỹ (E): ăn vào, hô hấp, thải, thành xác. */
  intake: number;
  respiration: number;
  egestion: number;
  toCorpse: number;
  /** Hiệu suất sản xuất = (ăn vào − hô hấp − thải) / ăn vào. */
  productionEfficiency: number;
  /** Trung bình kiểu hình các gen lúc đầu và lúc cuối. */
  genesStart: Record<string, number>;
  genesEnd: Record<string, number>;
}

export interface RunReport {
  seed: number;
  scenario: Scenario;
  ticksRequested: number;
  ticksRun: number;
  wallMs: number;
  msPerTick: number;
  stateHash: string;
  /** Mọi loài khởi đầu (động vật lẫn trường) đều còn sống tới cuối. */
  survived: boolean;
  extinctions: { key: string; tick: number }[];
  animals: SpeciesReport[];
  fields: { key: string; name: string; initial: number; final: number; min: number; extinctAt: number }[];
  peakAnimals: number;
  energy: {
    maxLedgerError: number;
    nutrientError: number;
    npp: number;
    herbivoreIntake: number;
    carnivoreIntake: number;
    /** Hiệu suất truyền giữa các bậc dinh dưỡng (Lindeman). */
    efficiencyProducerToHerbivore: number;
    efficiencyHerbivoreToCarnivore: number;
    totalHeat: number;
    flows: { from: string; to: string; amount: number }[];
  };
  /** Số con mồi bị giết, theo cặp kẻ săn → con mồi. */
  kills: { hunter: string; prey: string; count: number }[];
  speciation: {
    events: number;
    lineages: {
      id: number;
      name: string;
      parent: number;
      bornTick: number;
      extinctTick: number;
      founders: number;
      distance: number;
      population: number;
    }[];
  };
  series: { tick: number[]; populations: Record<string, number[]>; fields: Record<string, number[]> };
}

const FIELD_KEYS = ['grass', 'shrub', 'algae', 'insects', 'fungi'] as const;
/** Một trường coi là tuyệt chủng khi tổng sinh khối toàn bản đồ dưới ngưỡng này (E). */
const FIELD_EXTINCT_BELOW = 1;

/** Chạy mô phỏng và trả về báo cáo. `now` là đồng hồ thực (ms) — truyền vào để lõi không phụ thuộc thời gian. */
export function runSimulation(options: RunOptions, now: () => number = () => performance.now()): RunReport {
  const sampleEvery = options.sampleEvery ?? 100;
  const sim = new Simulation({
    seed: options.seed,
    scenario: options.scenario,
    species: options.species,
    counts: options.counts,
    params: options.params,
  });
  const registry = sim.registry;
  const first = sim.collectStats();
  // "Loài khởi đầu" = loài động vật có mặt ở tick 0 + mọi trường có sinh khối ở tick 0.
  const startingAnimals = registry.animals.filter((species) => first.populations[species.index] > 0);
  const fieldTotal = (frame: StatsFrame, key: (typeof FIELD_KEYS)[number]): number =>
    key === 'shrub' ? frame.fields.shrub + frame.fields.fruit : frame.fields[key];
  const startingFields = FIELD_KEYS.filter((key) => fieldTotal(first, key) > FIELD_EXTINCT_BELOW);

  const series: RunReport['series'] = { tick: [], populations: {}, fields: {} };
  for (const species of startingAnimals) series.populations[species.key] = [];
  for (const key of FIELD_KEYS) series.fields[key] = [];
  series.fields.detritus = [];
  series.fields.corpses = [];

  const min = new Map<string, number>();
  const max = new Map<string, number>();
  const sum = new Map<string, number>();
  const extinctAt = new Map<string, number>();
  let peakAnimals = 0;
  let samples = 0;
  const record = (frame: StatsFrame): void => {
    series.tick.push(frame.tick);
    samples++;
    let total = 0;
    for (const species of registry.animals) total += frame.populations[species.index];
    if (total > peakAnimals) peakAnimals = total;
    for (const species of startingAnimals) {
      const n = frame.populations[species.index];
      series.populations[species.key].push(n);
      min.set(species.key, Math.min(min.get(species.key) ?? n, n));
      max.set(species.key, Math.max(max.get(species.key) ?? n, n));
      sum.set(species.key, (sum.get(species.key) ?? 0) + n);
      if (n === 0 && !extinctAt.has(species.key)) extinctAt.set(species.key, frame.tick);
    }
    for (const key of FIELD_KEYS) {
      const value = fieldTotal(frame, key);
      series.fields[key].push(Math.round(value));
      min.set(key, Math.min(min.get(key) ?? value, value));
      if (startingFields.includes(key) && value < FIELD_EXTINCT_BELOW && !extinctAt.has(key))
        extinctAt.set(key, frame.tick);
    }
    series.fields.detritus.push(Math.round(frame.fields.detritus));
    series.fields.corpses.push(Math.round(frame.fields.corpses));
  };
  record(first);
  options.onSample?.(first, sim);

  const started = now();
  let last = first;
  while (sim.tick < options.ticks) {
    sim.run(Math.min(sampleEvery, options.ticks - sim.tick));
    last = sim.collectStats();
    record(last);
    options.onSample?.(last, sim);
    if (options.stopOnExtinction && extinctAt.size > 0) break;
  }
  const wallMs = now() - started;

  const ledger = sim.ledger;
  const audit = sim.audit();
  const flow = (from: number, to: number): number => ledger.flows[from * ledger.poolCount + to];
  const pools = registry.pools;
  const producers = [pools.grass, pools.shrub, pools.algae];
  const consumers = [pools.insects, ...registry.animals.map((species) => species.pool)];
  let npp = 0;
  for (const producer of producers) npp += flow(POOL_SUN, producer);
  let herbivoreIntake = 0;
  for (const producer of producers)
    for (const consumer of consumers) herbivoreIntake += flow(producer, consumer);
  let carnivoreIntake = 0;
  for (const species of registry.animals)
    carnivoreIntake += flow(POOL_CORPSE, species.pool) + flow(pools.insects, species.pool);

  const animals: SpeciesReport[] = startingAnimals.map((species) => {
    let intake = 0;
    for (let from = 0; from < ledger.poolCount; from++) {
      if (from !== POOL_EXTERNAL) intake += flow(from, species.pool);
    }
    const respiration = flow(species.pool, POOL_HEAT);
    const egestion = flow(species.pool, POOL_DETRITUS);
    const deaths: Record<string, number> = {};
    for (let cause = 0; cause < DEATH_CAUSES; cause++) {
      const count = sim.stats.deaths[species.index * DEATH_CAUSES + cause];
      if (count > 0) deaths[DEATH_LABELS[cause]] = count;
    }
    const genes = (frame: StatsFrame): Record<string, number> =>
      Object.fromEntries(
        species.genes.map((gene, k) => [gene.name, Number(frame.geneMean[species.index][k].toFixed(4))]),
      );
    return {
      key: species.key,
      name: species.def.name,
      initial: first.populations[species.index],
      final: last.populations[species.index],
      min: min.get(species.key) ?? 0,
      max: max.get(species.key) ?? 0,
      mean: Math.round((sum.get(species.key) ?? 0) / samples),
      extinctAt: extinctAt.get(species.key) ?? -1,
      births: sim.stats.births[species.index],
      deaths,
      intake,
      respiration,
      egestion,
      toCorpse: flow(species.pool, POOL_CORPSE),
      productionEfficiency: intake > 0 ? (intake - respiration - egestion) / intake : 0,
      genesStart: genes(first),
      genesEnd: genes(last),
    };
  });

  const flows: RunReport['energy']['flows'] = [];
  for (let from = 0; from < ledger.poolCount; from++) {
    for (let to = 0; to < ledger.poolCount; to++) {
      const amount = flow(from, to);
      if (amount > 0)
        flows.push({ from: ledger.names[from], to: ledger.names[to], amount: Math.round(amount) });
    }
  }
  const kills: RunReport['kills'] = [];
  const speciesCount = registry.animals.length;
  for (const hunter of registry.animals) {
    for (const prey of registry.animals) {
      const count = sim.stats.kills[hunter.index * speciesCount + prey.index];
      if (count > 0) kills.push({ hunter: hunter.key, prey: prey.key, count });
    }
  }
  const extinctions = [...extinctAt.entries()].map(([key, tick]) => ({ key, tick }));
  return {
    seed: options.seed,
    scenario: sim.scenario,
    ticksRequested: options.ticks,
    ticksRun: sim.tick,
    wallMs,
    msPerTick: wallMs / Math.max(1, sim.tick),
    stateHash: sim.stateHash(),
    survived: extinctions.length === 0,
    extinctions,
    animals,
    fields: FIELD_KEYS.map((key) => ({
      key,
      name: registry.fieldDefs.find((def) => def.key === key)!.name,
      initial: Math.round(fieldTotal(first, key)),
      final: Math.round(fieldTotal(last, key)),
      min: Math.round(min.get(key) ?? 0),
      extinctAt: extinctAt.get(key) ?? -1,
    })),
    peakAnimals,
    kills,
    energy: {
      maxLedgerError: audit.maxEnergyError,
      nutrientError: audit.nutrientError,
      npp,
      herbivoreIntake,
      carnivoreIntake,
      efficiencyProducerToHerbivore: npp > 0 ? herbivoreIntake / npp : 0,
      efficiencyHerbivoreToCarnivore: herbivoreIntake > 0 ? carnivoreIntake / herbivoreIntake : 0,
      totalHeat: ledger.inflow(POOL_HEAT),
      flows,
    },
    speciation: {
      events: sim.stats.speciations,
      lineages: sim.lineages.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        parent: node.parent,
        bornTick: node.bornTick,
        extinctTick: node.extinctTick,
        founders: node.founders,
        distance: Number(node.distance.toFixed(3)),
        population: node.population,
      })),
    },
    series,
  };
}

/** Phân tích tham số dòng lệnh dạng `--khoá giá_trị` và cờ `--khoá`. */
export function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let k = 0; k < argv.length; k++) {
    const token = argv[k];
    if (!token.startsWith('--')) continue;
    const next = argv[k + 1];
    if (next === undefined || next.startsWith('--')) {
      args.set(token.slice(2), 'true');
    } else {
      args.set(token.slice(2), next);
      k++;
    }
  }
  return args;
}
