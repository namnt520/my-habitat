import { describe, expect, it } from 'vitest';
import { CELLS, ISOLATION_TICKS, MAX_GENES, MOUNTAIN_LEVEL, WADE_DEPTH } from '../src/sim/constants';
import { GENE_SIZE } from '../src/sim/genetics';
import { Simulation } from '../src/sim/simulation';
import { SNAPSHOT_STRIDE } from '../src/sim/snapshot';
import { cellAt } from '../src/sim/terrain';
import { SPECIES_DATA } from '../src/species/data';
import { createRegistry } from '../src/species/registry';
import { LOCO_LAND, LOCO_WATER } from '../src/species/runtime';
import type { AnimalDef, SpeciesDef } from '../src/species/types';

describe('dữ liệu loài', () => {
  it('có đủ 14 loài khởi đầu: 5 trường + 9 động vật', () => {
    const registry = createRegistry(SPECIES_DATA);
    expect(registry.fieldDefs.map((def) => def.key)).toEqual(['grass', 'shrub', 'algae', 'insects', 'fungi']);
    const starting = registry.animals.filter((species) => species.def.starting).map((species) => species.key);
    expect(starting).toEqual(['rabbit', 'deer', 'fox', 'wolf', 'eagle', 'bear', 'frog', 'fish', 'vulture']);
  });

  it('quan hệ săn mồi được suy ra từ dữ liệu', () => {
    const registry = createRegistry(SPECIES_DATA);
    const bit = (key: string) => 1 << registry.animalByKey.get(key)!.index;
    expect(registry.animalByKey.get('rabbit')!.predatorMask & bit('fox')).not.toBe(0);
    expect(registry.animalByKey.get('deer')!.predatorMask & bit('wolf')).not.toBe(0);
    expect(registry.animalByKey.get('vulture')!.preyMask).toBe(0); // kền kền chỉ ăn xác
    expect(registry.animalByKey.get('fish')!.preyMask).toBe(0);
  });

  it('báo lỗi rõ ràng khi dữ liệu sai', () => {
    const clone = (): SpeciesDef[] => JSON.parse(JSON.stringify(SPECIES_DATA)) as SpeciesDef[];
    const rabbit = (defs: SpeciesDef[]) => defs.find((def) => def.key === 'rabbit') as AnimalDef;

    const unknownBehavior = clone();
    rabbit(unknownBehavior).behaviors.push({ use: 'teleport' });
    expect(() => createRegistry(unknownBehavior)).toThrow(/teleport/);

    const unknownPrey = clone();
    (unknownPrey.find((def) => def.key === 'fox') as AnimalDef).behaviors.push({
      use: 'hunt',
      params: { prey: ['unicorn'] },
    });
    expect(() => createRegistry(unknownPrey)).toThrow(/unicorn/);

    const badGene = clone();
    rabbit(badGene).genes[0].name = 'velocity';
    expect(() => createRegistry(badGene)).toThrow(/speed/);

    const missingField = clone().filter((def) => def.key !== 'fungi');
    expect(() => createRegistry(missingField)).toThrow(/fungi/);
  });

  it('thêm loài mới chỉ bằng dữ liệu (không sửa lõi)', () => {
    const defs = JSON.parse(JSON.stringify(SPECIES_DATA)) as SpeciesDef[];
    const hare = JSON.parse(JSON.stringify(defs.find((def) => def.key === 'rabbit'))) as AnimalDef;
    hare.key = 'hare';
    hare.name = 'Thỏ rừng';
    hare.initialCount = 50;
    defs.push(hare);
    const sim = new Simulation({ seed: 2, data: defs });
    const index = sim.registry.animalByKey.get('hare')!.index;
    expect(sim.populations()[index]).toBe(50);
    sim.run(60);
    expect(sim.audit().maxEnergyError).toBeLessThan(1e-9);
  });
});

describe('Simulation', () => {
  it('quần thể khởi tạo đúng số lượng và đứng ở sinh cảnh hợp lệ', () => {
    const sim = new Simulation({ seed: 6 });
    const a = sim.animals;
    for (const species of sim.registry.animals) {
      expect(sim.populations()[species.index]).toBe(species.def.starting ? species.def.initialCount : 0);
    }
    const { elevation } = sim.world.terrain;
    for (let i = 0; i < a.high; i++) {
      if (!a.alive[i]) continue;
      const species = sim.registry.animals[a.species[i]];
      const cell = cellAt(a.x[i], a.y[i]);
      const depth = sim.world.depthAt(cell);
      if (species.locomotion === LOCO_WATER) expect(depth).toBeGreaterThan(0);
      if (species.locomotion === LOCO_LAND) {
        expect(elevation[cell]).toBeLessThan(MOUNTAIN_LEVEL);
        if (!species.canSwim) expect(depth).toBeLessThanOrEqual(WADE_DEPTH);
      }
    }
  });

  it('ảnh chụp để vẽ có đúng kích thước và không chứa NaN', () => {
    const sim = new Simulation({ seed: 6 });
    sim.run(30);
    const snapshot = sim.snapshot(true);
    expect(snapshot.count).toBe(sim.animals.count);
    expect(snapshot.animals.length).toBe(snapshot.count * SNAPSHOT_STRIDE);
    expect(snapshot.fields!.grass.length).toBe(CELLS);
    expect(snapshot.animals.some((value) => Number.isNaN(value))).toBe(false);
  });

  it('inspector trả về gen, trạng thái và phả hệ', () => {
    const sim = new Simulation({ seed: 6 });
    sim.run(700);
    const a = sim.animals;
    let child = -1;
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] && a.motherId[i] !== 0) {
        child = i;
        break;
      }
    }
    expect(child).toBeGreaterThanOrEqual(0);
    const info = sim.inspect(a.id[child])!;
    expect(info.alive).toBe(true);
    expect(info.genes.length).toBeGreaterThanOrEqual(7);
    expect(info.genes[GENE_SIZE].value).toBeCloseTo(a.phenotype[child * MAX_GENES + GENE_SIZE], 6);
    expect(info.ancestors[0].map((ancestor) => ancestor.id)).toEqual([a.motherId[child], a.fatherId[child]]);
    expect(sim.inspect(999_999_999)).toBeNull();
  });

  it('kịch bản Lotka–Volterra: địa hình phẳng, chỉ một cặp con mồi–kẻ săn, không biến dị di truyền', () => {
    const sim = new Simulation({ seed: 1, scenario: 'lotka-volterra' });
    const counts = sim.populations();
    const present = sim.registry.animals
      .filter((species) => counts[species.index] > 0)
      .map((species) => species.key);
    expect(present).toEqual(['rabbit', 'fox']);
    expect(new Set(sim.world.terrain.elevation).size).toBe(1);
    expect(sim.world.insects.every((value) => value === 0)).toBe(true);
    const a = sim.animals;
    const rabbit = sim.registry.animalByKey.get('rabbit')!;
    const sizes = new Set<number>();
    for (let i = 0; i < a.high; i++)
      if (a.alive[i] && a.species[i] === rabbit.index) sizes.add(a.phenotype[i * MAX_GENES + GENE_SIZE]);
    expect(sizes.size).toBe(1);
  });
});

describe('phân loài', () => {
  /** Dựng một quần thể thỏ rồi ép hai bờ sông khác nhau về gen kích thước. */
  function dividedRabbits(shift: number) {
    const sim = new Simulation({ seed: 12, species: ['rabbit'], counts: { rabbit: 400 } });
    const a = sim.animals;
    const regions = new Map<number, number>();
    for (let i = 0; i < a.high; i++)
      if (a.alive[i]) regions.set(a.region[i], (regions.get(a.region[i]) ?? 0) + 1);
    const [big, small] = [...regions.entries()].sort((p, q) => q[1] - p[1]).map(([region]) => region);
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] && a.region[i] === small) a.phenotype[i * MAX_GENES + GENE_SIZE] += shift;
    }
    return { sim, big, small, smallCount: regions.get(small)! };
  }

  it('cách ly đủ lâu + khoảng cách gen lớn ⇒ tách phân loài, ghi vào cây phát sinh', () => {
    const { sim, small, smallCount } = dividedRabbits(0.4);
    const rabbit = sim.registry.animalByKey.get('rabbit')!;
    const before = sim.lineages.nodes.length;
    sim.tick = ISOLATION_TICKS + 1;
    sim.lineages.check(sim, true);
    expect(sim.lineages.nodes.length).toBe(before + 1);
    const branch = sim.lineages.nodes[before];
    expect(branch.parent).toBe(rabbit.index);
    expect(branch.founders).toBe(smallCount);
    expect(branch.region).toBe(small);
    const a = sim.animals;
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i]) expect(a.lineage[i]).toBe(a.region[i] === small ? branch.id : rabbit.index);
    }
  });

  it('chưa đủ thời gian cách ly ⇒ không tách', () => {
    const { sim } = dividedRabbits(0.4);
    const before = sim.lineages.nodes.length;
    sim.tick = ISOLATION_TICKS - 600;
    sim.lineages.check(sim, true);
    expect(sim.lineages.nodes.length).toBe(before);
  });

  it('có dòng gen gần đây giữa hai vùng ⇒ không tách', () => {
    const { sim, big, small } = dividedRabbits(0.4);
    const rabbit = sim.registry.animalByKey.get('rabbit')!;
    const before = sim.lineages.nodes.length;
    sim.tick = ISOLATION_TICKS * 2;
    sim.lineages.recordGeneFlow(rabbit.index, big, small, sim.tick - 100);
    sim.lineages.check(sim, true);
    expect(sim.lineages.nodes.length).toBe(before);
  });

  it('khoảng cách gen nhỏ ⇒ không tách dù đã cách ly', () => {
    const { sim } = dividedRabbits(0.01);
    const before = sim.lineages.nodes.length;
    sim.tick = ISOLATION_TICKS * 2;
    sim.lineages.check(sim, true);
    expect(sim.lineages.nodes.length).toBe(before);
  });
});
