/**
 * Băm toàn bộ trạng thái mô phỏng thành một chuỗi hex 64‑bit.
 * Hai lần chạy cho cùng chuỗi băm ⇔ (với xác suất áp đảo) trạng thái giống hệt nhau tới từng bit.
 */
import { MAX_GENES } from './constants';
import { GENOME_STRIDE } from './genetics';
import type { Simulation } from './simulation';

class Hasher {
  private h1 = 0x811c9dc5;
  private h2 = 0x01000193 ^ 0x5bd1e995;

  int(value: number): void {
    // Hai phép trộn độc lập (FNV‑1a và một biến thể murmur) để có 64 bit.
    this.h1 = Math.imul(this.h1 ^ value, 0x01000193);
    let k = Math.imul(value, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    this.h2 = Math.imul(this.h2 ^ Math.imul(k, 0x1b873593), 5) + 0xe6546b64;
    this.h2 = (this.h2 << 13) | (this.h2 >>> 19);
  }

  /** Băm các từ 32‑bit [from, to) của một khung nhìn Uint32 (bao phủ chính xác mọi bit của số thực). */
  words(view: Uint32Array, from = 0, to = view.length): void {
    for (let k = from; k < to; k++) this.int(view[k]);
  }

  bytes(array: Uint8Array | Uint16Array | Int16Array, from = 0, to = array.length): void {
    for (let k = from; k < to; k++) this.int(array[k]);
  }

  digest(): string {
    const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
    return hex(this.h1) + hex(this.h2);
  }
}

/** Khung nhìn Uint32 lên vùng nhớ của một mảng số thực. */
function bits(array: Float32Array | Float64Array): Uint32Array {
  return new Uint32Array(array.buffer, array.byteOffset, array.byteLength >> 2);
}

/** Chuỗi băm của toàn bộ trạng thái ảnh hưởng tới tương lai của mô phỏng. */
export function stateHash(sim: Simulation): string {
  const hasher = new Hasher();
  hasher.int(sim.tick);
  for (const word of sim.rng.getState()) hasher.int(word);

  const world = sim.world;
  hasher.words(
    bits(new Float64Array([world.climate.waterLevel, world.climate.soilWetness, world.climate.rain])),
  );
  hasher.int(world.climate.droughtTicks);
  hasher.int(world.climate.floodTicks);
  hasher.words(bits(world.soilN));
  hasher.words(bits(world.grass));
  hasher.words(bits(world.shrub));
  hasher.words(bits(world.fruit));
  hasher.words(bits(world.seedBank));
  hasher.words(bits(world.algae));
  hasher.words(bits(world.insects));
  hasher.words(bits(world.detritus));
  hasher.words(bits(world.fungi));
  hasher.bytes(world.fire);

  const a = sim.animals;
  const single = [a.x, a.y, a.targetX, a.targetY, a.water, a.health, a.age, a.gestation].map(bits);
  const double = [a.energy, a.structure].map(bits);
  const alleles = bits(a.alleles);
  const phenotype = bits(a.phenotype);
  hasher.int(a.count);
  hasher.int(a.nextId);
  for (let i = 0; i < a.high; i++) {
    if (a.alive[i] === 0) continue;
    hasher.int(i);
    hasher.int(a.id[i]);
    hasher.int(a.species[i] | (a.sex[i] << 8) | (a.state[i] << 16) | (a.flags[i] << 24));
    hasher.int(a.lineage[i] | (a.generation[i] << 16));
    hasher.int(a.group[i]);
    hasher.int(a.target[i]);
    hasher.int(a.region[i]);
    for (const view of single) hasher.int(view[i]);
    for (const view of double) hasher.words(view, i * 2, i * 2 + 2);
    hasher.words(alleles, i * GENOME_STRIDE, (i + 1) * GENOME_STRIDE);
    hasher.words(phenotype, i * MAX_GENES, (i + 1) * MAX_GENES);
  }

  const corpses = sim.corpses;
  const corpseX = bits(corpses.x);
  const corpseY = bits(corpses.y);
  const corpseEnergy = bits(corpses.energy);
  hasher.int(corpses.count);
  for (let c = 0; c < corpses.high; c++) {
    if (corpses.alive[c] === 0) continue;
    hasher.int(c);
    hasher.int(corpseX[c]);
    hasher.int(corpseY[c]);
    hasher.words(corpseEnergy, c * 2, c * 2 + 2);
  }
  hasher.int(sim.lineages.nodes.length);
  return hasher.digest();
}
