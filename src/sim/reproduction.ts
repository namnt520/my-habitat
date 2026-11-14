/**
 * Sinh sản hữu tính: điều kiện sẵn sàng, giao phối, mang thai, đẻ con/đẻ trứng.
 *
 * Bảo toàn năng lượng: toàn bộ cấu trúc và dự trữ của con non được trừ thẳng từ dự trữ của mẹ.
 */
import { MAX_GENES, WORLD_SIZE } from './constants';
import { capacityOf } from './actions';
import { clamp } from './detmath';
import { State } from './entities';
import { GENE_REPRO, GENE_SIZE, GENOME_STRIDE, expressGenome, recombine } from './genetics';
import type { Simulation } from './simulation';

/** Con non cần được cấp tối thiểu tỉ lệ này của sức chứa của nó thì mới đáng sinh ra. */
const MIN_OFFSPRING_RESERVE = 0.25;
/** Thời gian nghỉ của con đực sau một lần giao phối (tick). */
const MALE_COOLDOWN = 40;

const scratchAlleles = new Float32Array(GENOME_STRIDE);
const scratchPhenotype = new Float32Array(MAX_GENES);

/** Cá thể đã thành thục sinh dục chưa (đủ tuổi và đủ lớn). */
export function isAdult(sim: Simulation, slot: number): boolean {
  const a = sim.animals;
  const sp = sim.registry.animals[a.species[slot]];
  return (
    a.age[slot] >= sp.maturity &&
    a.structure[slot] >= 0.75 * sp.mass * a.phenotype[slot * MAX_GENES + GENE_SIZE]
  );
}

/**
 * Cá thể có sẵn sàng giao phối không.
 * Con cái cần dự trữ ≥ gen "ngưỡng sinh sản" × sức chứa; con đực cần một nửa mức đó.
 */
export function isReadyToMate(sim: Simulation, slot: number): boolean {
  const a = sim.animals;
  if (a.gestation[slot] > 0 || a.reproCooldown[slot] > 0 || a.state[slot] === State.HIBERNATE) return false;
  const sp = sim.registry.animals[a.species[slot]];
  if ((sp.seasonMask & (1 << sim.world.climate.season)) === 0) return false;
  if (!isAdult(sim, slot)) return false;
  const threshold = a.phenotype[slot * MAX_GENES + GENE_REPRO] * (a.sex[slot] === 0 ? 1 : 0.5);
  return a.energy[slot] >= threshold * capacityOf(sim, slot);
}

/**
 * Giao phối giữa một con cái và một con đực đã ở cạnh nhau.
 * Loài đẻ con: con cái mang thai. Loài đẻ trứng: trứng được thụ tinh và nở ngay tại chỗ.
 */
export function mate(sim: Simulation, female: number, male: number): void {
  const a = sim.animals;
  const sp = sim.registry.animals[a.species[female]];
  a.sireAlleles.set(
    a.alleles.subarray(male * GENOME_STRIDE, (male + 1) * GENOME_STRIDE),
    female * GENOME_STRIDE,
  );
  a.sireId[female] = a.id[male];
  a.reproCooldown[male] = MALE_COOLDOWN;

  // Dòng gen giữa hai vùng: một trong hai bố mẹ sinh ra ở vùng khác với nơi đang sinh sản.
  const here = a.region[female];
  if (a.natalRegion[female] !== here)
    sim.lineages.recordGeneFlow(a.lineage[female], a.natalRegion[female], here, sim.tick);
  if (a.natalRegion[male] !== here)
    sim.lineages.recordGeneFlow(a.lineage[female], a.natalRegion[male], here, sim.tick);

  if (sp.spawns) {
    giveBirth(sim, female);
  } else {
    a.gestation[female] = sp.gestation;
  }
}

/** Đẻ một lứa. Số con thực tế bị giới hạn bởi dự trữ năng lượng của mẹ. */
export function giveBirth(sim: Simulation, mother: number): void {
  const a = sim.animals;
  const rng = sim.rng;
  const sp = sim.registry.animals[a.species[mother]];
  a.gestation[mother] = 0;
  a.reproCooldown[mother] = sp.cooldown;

  const litterGene = sp.gLitter >= 0 ? a.phenotype[mother * MAX_GENES + sp.gLitter] : sp.litter;
  const motherCapacity = capacityOf(sim, mother);
  let available = a.energy[mother] - sp.motherReserve * motherCapacity;
  // Mẹ thiếu năng lượng thì đẻ ít con hơn (tiêu thai) thay vì đẻ đủ số mà con nào cũng không sống nổi.
  const typicalStructure = sp.birthMass * sp.mass * a.phenotype[mother * MAX_GENES + GENE_SIZE];
  const minimumCost = typicalStructure * (1 + MIN_OFFSPRING_RESERVE * sp.reserveRatio);
  const affordable = available > 0 ? Math.floor(available / minimumCost) : 0;
  const litter = Math.min(Math.floor(litterGene + rng.next()), affordable);
  // Mẹ chia đều phần năng lượng dành cho lứa này: đẻ nhiều thì mỗi con nhận ít (đánh đổi số lượng–chất lượng).
  const share = litter > 0 ? available / litter : 0;
  const mutationRate = sim.params.mutationRate;
  const mutationScale = sim.params.mutationScale;
  const motherOffset = mother * GENOME_STRIDE;
  let born = 0;

  for (let k = 0; k < litter; k++) {
    recombine(
      a.alleles,
      motherOffset,
      a.sireAlleles,
      motherOffset,
      scratchAlleles,
      0,
      sp.genes,
      rng,
      mutationRate,
      mutationScale,
    );
    const sex = rng.nextU32() & 1;
    const jitterX = rng.next() - 0.5;
    const jitterY = rng.next() - 0.5;
    expressGenome(scratchAlleles, 0, scratchPhenotype, 0);
    const structure = sp.birthMass * sp.mass * scratchPhenotype[GENE_SIZE];
    const fat = sp.gFat >= 0 ? scratchPhenotype[sp.gFat] : 1;
    const childCapacity = sp.reserveRatio * structure * fat;
    if (share < structure + MIN_OFFSPRING_RESERVE * childCapacity || available < share) continue;
    const reserve = Math.min(share - structure, sp.offspringReserve * childCapacity);

    const child = a.allocate();
    a.species[child] = sp.index;
    a.sex[child] = sex;
    a.lineage[child] = a.lineage[mother];
    a.generation[child] = a.generation[mother] + 1;
    a.motherId[child] = a.id[mother];
    a.fatherId[child] = a.sireId[mother];
    a.motherSlot[child] = mother;
    a.x[child] = clamp(a.x[mother] + jitterX * 4, 1, WORLD_SIZE - 1);
    a.y[child] = clamp(a.y[mother] + jitterY * 4, 1, WORLD_SIZE - 1);
    a.targetX[child] = a.x[child];
    a.targetY[child] = a.y[child];
    a.structure[child] = structure;
    a.energy[child] = reserve;
    a.group[child] = a.group[mother];
    a.homeX[child] = a.homeX[mother];
    a.homeY[child] = a.homeY[mother];
    a.region[child] = a.region[mother];
    a.natalRegion[child] = a.region[mother];
    a.alleles.set(scratchAlleles, child * GENOME_STRIDE);
    a.phenotype.set(scratchPhenotype, child * MAX_GENES);
    a.energy[mother] -= structure + reserve;
    available -= structure + reserve;
    sim.pedigree.add(a.id[child], a.motherId[child], a.fatherId[child], sp.index, a.lineage[child], sim.tick);
    born++;
  }
  sim.stats.addBirths(sp.index, born);
}
