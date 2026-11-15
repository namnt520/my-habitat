/**
 * Phân loài và cây phát sinh chủng loại.
 *
 * Mỗi cá thể mang mã "dòng" (lineage). Lúc đầu mỗi loài là một dòng. Định kỳ, với mỗi dòng ta chia cá thể
 * theo vùng liên thông đang sống (quần thể con), rồi với mỗi quần thể con kiểm tra hai điều kiện:
 *   1. Cách ly đủ lâu: trong ISOLATION_TICKS tick không có sự kiện dòng gen nào vào/ra vùng đó
 *      (dòng gen = một cá thể sinh ra ở vùng này tham gia sinh sản ở vùng khác);
 *   2. Khoảng cách gen chuẩn hoá giữa quần thể con và PHẦN CÒN LẠI của dòng vượt SPECIATION_DISTANCE.
 * Nếu cả hai thoả, quần thể con tách thành một dòng mới (nhánh con trong cây) và từ đó không
 * giao phối được với dòng gốc nữa.
 *
 * Vì sao so với "phần còn lại" chứ không so từng cặp: một loài có thể có hàng chục quần thể con nhỏ (mỗi ao một
 * quần thể ếch); giữa hàng trăm cặp luôn có vài cặp lệch nhau do ngẫu nhiên lấy mẫu, và sẽ sinh ra phân loài "ảo".
 *
 * Không có gì ở đây "đẩy" các quần thể rời xa nhau: sự phân hoá đến từ đột biến, trôi dạt và chọn lọc khác nhau.
 */
import { ISOLATION_TICKS, MAX_GENES, MIN_DEME_SIZE, SPECIATION_DISTANCE } from './constants';
import { populationDistance } from './genetics';
import type { Simulation } from './simulation';

/** Số vùng tối đa dùng để ghép khoá (vùng là Int16 nên luôn nhỏ hơn giá trị này). */
const REGION_SPAN = 32768;

export interface LineageNode {
  id: number;
  /** Chỉ số loài động vật. */
  species: number;
  /** Dòng cha trong cây; −1 nếu là dòng gốc của loài. */
  parent: number;
  name: string;
  bornTick: number;
  /** Tick tuyệt chủng; −1 nếu còn sống. */
  extinctTick: number;
  /** Số cá thể lúc tách, vùng nơi tách, và khoảng cách gen lúc tách. */
  founders: number;
  region: number;
  distance: number;
  /** Số cá thể ở lần kiểm tra gần nhất. */
  population: number;
  /** Dòng này đã từng có cá thể sống (ở một lần kiểm tra nào đó). */
  seen: boolean;
}

interface Deme {
  lineage: number;
  region: number;
  count: number;
  sum: Float64Array;
  sumSq: Float64Array;
}

export class LineageTree {
  readonly nodes: LineageNode[] = [];
  /** Tick xảy ra dòng gen gần nhất vào/ra một vùng của một dòng (khoá = dòng × REGION_SPAN + vùng). */
  private readonly geneFlow = new Map<number, number>();
  /** Số nhánh con đã tách của mỗi loài (để đặt tên). */
  private readonly branchCount: number[] = [];

  constructor(speciesNames: readonly string[]) {
    speciesNames.forEach((name, species) => {
      this.nodes.push({
        id: species,
        species,
        parent: -1,
        name,
        bornTick: 0,
        extinctTick: -1,
        founders: 0,
        region: -1,
        distance: 0,
        population: 0,
        seen: false,
      });
      this.branchCount.push(0);
    });
  }

  /** Ghi nhận một sự kiện dòng gen giữa hai vùng của cùng một dòng. */
  recordGeneFlow(lineage: number, regionA: number, regionB: number, tick: number): void {
    if (regionA === regionB || regionA < 0 || regionB < 0) return;
    this.geneFlow.set(lineage * REGION_SPAN + regionA, tick);
    this.geneFlow.set(lineage * REGION_SPAN + regionB, tick);
  }

  /** Số tick kể từ lần dòng gen gần nhất vào/ra vùng (tính từ lúc dòng ra đời nếu chưa từng có). */
  isolationTime(lineage: number, region: number, tick: number): number {
    const last = this.geneFlow.get(lineage * REGION_SPAN + region) ?? this.nodes[lineage].bornTick;
    return tick - last;
  }

  /** Kiểm tra tuyệt chủng và phân loài. Gọi mỗi SPECIATION_INTERVAL tick. */
  check(sim: Simulation, allowSplit: boolean): void {
    const a = sim.animals;
    const demes = new Map<number, Deme>();
    for (const node of this.nodes) node.population = 0;
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 0) continue;
      const lineage = a.lineage[i];
      this.nodes[lineage].population++;
      const region = a.region[i];
      if (region < 0) continue;
      const key = lineage * REGION_SPAN + region;
      let deme = demes.get(key);
      if (!deme) {
        deme = {
          lineage,
          region,
          count: 0,
          sum: new Float64Array(MAX_GENES),
          sumSq: new Float64Array(MAX_GENES),
        };
        demes.set(key, deme);
      }
      deme.count++;
      const g = i * MAX_GENES;
      for (let k = 0; k < MAX_GENES; k++) {
        const value = a.phenotype[g + k];
        deme.sum[k] += value;
        deme.sumSq[k] += value * value;
      }
    }
    for (const node of this.nodes) {
      if (node.population > 0) node.seen = true;
      // Chỉ dòng đã từng tồn tại mới "tuyệt chủng" (loài xâm lấn chưa được thả thì không tính).
      else if (node.seen && node.extinctTick < 0) node.extinctTick = sim.tick;
    }
    if (!allowSplit) return;

    // Gom các quần thể con đủ lớn theo dòng (Map giữ thứ tự chèn → tất định).
    const byLineage = new Map<number, Deme[]>();
    for (const deme of demes.values()) {
      if (deme.count < MIN_DEME_SIZE) continue;
      const list = byLineage.get(deme.lineage);
      if (list) list.push(deme);
      else byLineage.set(deme.lineage, [deme]);
    }

    const meanA = new Float64Array(MAX_GENES);
    const meanB = new Float64Array(MAX_GENES);
    const varA = new Float64Array(MAX_GENES);
    const varB = new Float64Array(MAX_GENES);
    const totalSum = new Float64Array(MAX_GENES);
    const totalSq = new Float64Array(MAX_GENES);
    for (const [lineage, list] of byLineage) {
      // Tổng của cả dòng (kể cả các quần thể con quá nhỏ không nằm trong `list`).
      totalSum.fill(0);
      totalSq.fill(0);
      let total = 0;
      for (const deme of demes.values()) {
        if (deme.lineage !== lineage) continue;
        total += deme.count;
        for (let k = 0; k < MAX_GENES; k++) {
          totalSum[k] += deme.sum[k];
          totalSq[k] += deme.sumSq[k];
        }
      }
      const specs = sim.registry.animals[this.nodes[lineage].species].genes;
      let bestDistance = SPECIATION_DISTANCE;
      let split: Deme | null = null;
      for (const deme of list) {
        const rest = total - deme.count;
        // Chỉ tách khi cả hai phía đều đủ lớn, và quần thể con là phía nhỏ hơn (nhánh mới mọc từ thân chính).
        if (rest < MIN_DEME_SIZE || deme.count > rest) continue;
        if (this.isolationTime(lineage, deme.region, sim.tick) < ISOLATION_TICKS) continue;
        for (let k = 0; k < MAX_GENES; k++) {
          meanA[k] = deme.sum[k] / deme.count;
          varA[k] = Math.max(0, deme.sumSq[k] / deme.count - meanA[k] * meanA[k]);
          meanB[k] = (totalSum[k] - deme.sum[k]) / rest;
          varB[k] = Math.max(0, (totalSq[k] - deme.sumSq[k]) / rest - meanB[k] * meanB[k]);
        }
        const distance = populationDistance(meanA, varA, meanB, varB, specs);
        if (distance > bestDistance) {
          bestDistance = distance;
          split = deme;
        }
      }
      if (split) this.branch(sim, lineage, split, bestDistance);
    }
  }

  /** Tách quần thể con `deme` khỏi dòng `parent` thành một dòng mới. */
  private branch(sim: Simulation, parent: number, deme: Deme, distance: number): void {
    const a = sim.animals;
    const parentNode = this.nodes[parent];
    const id = this.nodes.length;
    if (id >= 65535) return; // mã dòng là Uint16
    const serial = ++this.branchCount[parentNode.species];
    const rootName = this.nodes[parentNode.species].name;
    this.nodes.push({
      id,
      species: parentNode.species,
      parent,
      name: `${rootName} ${String.fromCharCode(945 + ((serial - 1) % 24))}${serial > 24 ? Math.floor((serial - 1) / 24) : ''}`,
      bornTick: sim.tick,
      extinctTick: -1,
      founders: deme.count,
      region: deme.region,
      distance,
      population: deme.count,
      seen: true,
    });
    parentNode.population -= deme.count;
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 1 && a.lineage[i] === parent && a.region[i] === deme.region) a.lineage[i] = id;
    }
    sim.stats.addSpeciation();
  }
}
