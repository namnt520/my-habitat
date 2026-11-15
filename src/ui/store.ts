/**
 * Kho lịch sử thống kê phía giao diện: gom các khung thống kê Worker gửi về thành chuỗi thời gian
 * cho biểu đồ, lưới thức ăn, cây phân loài và xuất CSV.
 */
import type { LineageNode } from '../sim/speciation';
import type { StatsFrame } from '../sim/stats';
import type { FromWorker, WorldMeta } from '../worker/protocol';

type StatsMessage = Extract<FromWorker, { type: 'stats' }>;

/** Số mẫu tối đa giữ lại; vượt quá thì gộp đôi (giữ một mẫu trong mỗi hai mẫu). */
const MAX_SAMPLES = 4000;

export interface HistogramSample {
  tick: number;
  /** [loài][gen][ô] */
  bins: number[][][];
}

export class History {
  ticks: number[] = [];
  /** populations[loài][mẫu] */
  populations: number[][] = [];
  fields: Record<string, number[]> = {};
  /** geneMean[loài][gen][mẫu], geneSd tương tự. */
  geneMean: number[][][] = [];
  geneSd: number[][][] = [];
  /** Chuỗi số cá thể theo dòng (phân loài): mã dòng → mảng song song với `ticks` (NaN trước khi dòng ra đời). */
  lineageSeries = new Map<number, number[]>();
  climate: StatsFrame['climate'][] = [];
  histograms: HistogramSample[] = [];
  lineages: LineageNode[] = [];
  latest: StatsFrame | null = null;
  /** Tốc độ dòng năng lượng (E/tick), làm mượt: ma trận sổ cái và ma trận "ai ăn ai". */
  flowRate: Float64Array | null = null;
  intakeRate: Float64Array | null = null;
  private lastFlows: Float64Array | null = null;
  private lastIntake: Float64Array | null = null;
  private lastFlowTick = 0;
  private stride = 1;
  private skipped = 0;

  constructor(readonly meta: WorldMeta) {
    this.populations = meta.animals.map(() => []);
    this.geneMean = meta.animals.map((species) => species.genes.map(() => []));
    this.geneSd = meta.animals.map((species) => species.genes.map(() => []));
    for (const key of [
      'grass',
      'shrub',
      'fruit',
      'algae',
      'insects',
      'fungi',
      'detritus',
      'corpses',
      'soilN',
    ])
      this.fields[key] = [];
  }

  push(message: StatsMessage): void {
    const frame = message.frame;
    this.latest = frame;
    this.lineages = message.lineages;

    if (message.flows && message.intake) {
      const elapsed = frame.tick - this.lastFlowTick;
      if (this.lastFlows && this.lastIntake && elapsed > 0) {
        const flowRate = this.flowRate ?? new Float64Array(message.flows.length);
        const intakeRate = this.intakeRate ?? new Float64Array(message.intake.length);
        for (let k = 0; k < flowRate.length; k++) {
          flowRate[k] = flowRate[k] * 0.6 + ((message.flows[k] - this.lastFlows[k]) / elapsed) * 0.4;
          intakeRate[k] = intakeRate[k] * 0.6 + ((message.intake[k] - this.lastIntake[k]) / elapsed) * 0.4;
        }
        this.flowRate = flowRate;
        this.intakeRate = intakeRate;
      }
      this.lastFlows = message.flows;
      this.lastIntake = message.intake;
      this.lastFlowTick = frame.tick;
    }
    if (message.histograms) {
      this.histograms.push({ tick: frame.tick, bins: message.histograms });
      if (this.histograms.length > 600)
        this.histograms = this.histograms.filter((_, index) => index % 2 === 0);
    }

    // Lấy mẫu thưa dần khi chạy rất lâu.
    if (this.skipped + 1 < this.stride) {
      this.skipped++;
      return;
    }
    this.skipped = 0;
    this.ticks.push(frame.tick);
    frame.populations.forEach((count, species) => this.populations[species].push(count));
    for (const key of Object.keys(this.fields))
      this.fields[key].push(frame.fields[key as keyof StatsFrame['fields']]);
    frame.geneMean.forEach((genes, species) =>
      genes.forEach((value, gene) => this.geneMean[species][gene].push(value)),
    );
    frame.geneSd.forEach((genes, species) =>
      genes.forEach((value, gene) => this.geneSd[species][gene].push(value)),
    );
    this.climate.push(frame.climate);
    const present = new Map(frame.lineages);
    for (const [lineage, count] of present) {
      let series = this.lineageSeries.get(lineage);
      if (!series) {
        series = new Array<number>(this.ticks.length - 1).fill(NaN);
        this.lineageSeries.set(lineage, series);
      }
      series.push(count);
    }
    for (const [lineage, series] of this.lineageSeries) {
      if (!present.has(lineage))
        series.push(series.length > 0 && !Number.isNaN(series[series.length - 1]) ? 0 : NaN);
    }
    if (this.ticks.length > MAX_SAMPLES) this.decimate();
  }

  private decimate(): void {
    const keep = <T>(array: T[]): T[] => array.filter((_, index) => index % 2 === 0);
    this.ticks = keep(this.ticks);
    this.populations = this.populations.map(keep);
    for (const key of Object.keys(this.fields)) this.fields[key] = keep(this.fields[key]);
    this.geneMean = this.geneMean.map((genes) => genes.map(keep));
    this.geneSd = this.geneSd.map((genes) => genes.map(keep));
    this.climate = keep(this.climate);
    for (const [lineage, series] of this.lineageSeries) this.lineageSeries.set(lineage, keep(series));
    this.stride *= 2;
  }

  /** Xuất chuỗi thời gian thành CSV. */
  toCsv(): string {
    const meta = this.meta;
    const header = ['tick', 'year', 'season', 'temperature', 'rain', 'drought', 'waterLevel', 'soilWetness'];
    for (const species of meta.animals) header.push(`pop_${species.key}`);
    for (const key of Object.keys(this.fields)) header.push(`field_${key}`);
    for (const species of meta.animals)
      for (const gene of species.genes) header.push(`gene_${species.key}_${gene.name}`);
    const lineageIds = [...this.lineageSeries.keys()].sort((a, b) => a - b);
    for (const id of lineageIds)
      header.push(`lineage_${id}_${(this.lineages[id]?.name ?? '').replace(/[, ]+/g, '_')}`);
    const rows = [header.join(',')];
    for (let k = 0; k < this.ticks.length; k++) {
      const climate = this.climate[k];
      const row: (number | string)[] = [
        this.ticks[k],
        (this.ticks[k] / 2400).toFixed(3),
        climate.season,
        climate.temperature.toFixed(2),
        climate.rain.toFixed(2),
        climate.drought ? 1 : 0,
        climate.waterLevel.toFixed(4),
        climate.soilWetness.toFixed(3),
      ];
      for (const series of this.populations) row.push(series[k]);
      for (const key of Object.keys(this.fields)) row.push(this.fields[key][k].toFixed(1));
      for (const genes of this.geneMean) for (const series of genes) row.push(series[k].toFixed(4));
      for (const id of lineageIds) {
        const value = this.lineageSeries.get(id)![k];
        row.push(Number.isNaN(value) ? '' : value);
      }
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }

  /** Xuất cây phát sinh chủng loại thành CSV. */
  lineagesCsv(): string {
    const rows = ['id,name,species,parent,bornTick,extinctTick,founders,region,geneticDistance,population'];
    for (const node of this.lineages) {
      rows.push(
        [
          node.id,
          node.name,
          this.meta.animals[node.species].key,
          node.parent,
          node.bornTick,
          node.extinctTick,
          node.founders,
          node.region,
          node.distance.toFixed(3),
          node.population,
        ].join(','),
      );
    }
    return rows.join('\n');
  }
}
