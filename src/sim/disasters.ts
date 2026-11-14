/**
 * Thảm hoạ do người dùng kích hoạt: hạn hán, lũ, cháy rừng, dịch bệnh, thả loài xâm lấn.
 * Đây là "đầu vào" của mô phỏng: cùng seed + cùng chuỗi sự kiện ở cùng tick ⇒ cùng kết quả.
 */
import {
  CELL_SIZE,
  DISEASE_DURATION,
  FIRE_BURN_STEPS,
  GRID,
  MOUNTAIN_LEVEL,
  NUTRIENT_PER_ENERGY,
} from './constants';
import { clamp01 } from './detmath';
import { POOL_DETRITUS, POOL_HEAT } from './ledger';
import type { Simulation } from './simulation';
import { cellAt } from './terrain';

export type SimEvent =
  | { type: 'drought'; duration: number }
  | { type: 'flood'; duration: number }
  | { type: 'fire'; x: number; y: number }
  | { type: 'disease'; species: string; fraction: number }
  | { type: 'invasive'; species: string; count: number; x: number; y: number };

/** Áp dụng một sự kiện thảm hoạ vào mô phỏng. */
export function applyEvent(sim: Simulation, event: SimEvent): void {
  const climate = sim.world.climate;
  switch (event.type) {
    case 'drought':
      climate.droughtTicks = Math.max(climate.droughtTicks, event.duration);
      climate.floodTicks = 0;
      climate.rain = 0;
      break;
    case 'flood':
      climate.floodTicks = Math.max(climate.floodTicks, event.duration);
      climate.droughtTicks = 0;
      climate.rain = 1;
      break;
    case 'fire':
      ignite(sim, cellAt(event.x, event.y));
      break;
    case 'disease': {
      const species = sim.registry.animalByKey.get(event.species);
      if (!species) return;
      const a = sim.animals;
      for (let i = 0; i < a.high; i++) {
        if (a.alive[i] === 1 && a.species[i] === species.index && sim.rng.next() < event.fraction) {
          a.sick[i] = DISEASE_DURATION;
        }
      }
      break;
    }
    case 'invasive': {
      const species = sim.registry.animalByKey.get(event.species);
      if (species) sim.introduce(species.index, event.count, event.x, event.y, 70);
      break;
    }
  }
}

/** Nhiên liệu cháy được của một ô (E). */
function fuel(sim: Simulation, cell: number): number {
  const world = sim.world;
  return (
    world.grass[cell] + world.shrub[cell] + 0.5 * world.detritus[cell] + 120 * world.terrain.canopy[cell]
  );
}

function ignite(sim: Simulation, cell: number): void {
  const world = sim.world;
  if (world.fire[cell] > 0 || world.depthAt(cell) > 0 || world.terrain.elevation[cell] > MOUNTAIN_LEVEL)
    return;
  world.fire[cell] = FIRE_BURN_STEPS;
  world.burning.push(cell);
}

/**
 * Tiến đám cháy một bước: đốt nhiên liệu ở các ô đang cháy (năng lượng → nhiệt, N → tro trả về đất)
 * và lan sang ô kề với xác suất tăng theo nhiên liệu và độ khô.
 */
export function updateFire(sim: Simulation): void {
  const world = sim.world;
  const pools = sim.registry.pools;
  const ledger = sim.ledger;
  const rng = sim.rng;
  const dryness = 1 - clamp01(world.climate.soilWetness * 1.1 + world.climate.rain);
  const current = world.burning;
  const next: number[] = [];
  world.burning = next;
  let grassBurnt = 0;
  let shrubBurnt = 0;
  let insectsBurnt = 0;
  let fungiBurnt = 0;
  let detritusBurnt = 0;

  for (const cell of current) {
    const g = world.grass[cell] * 0.4;
    const s = world.shrub[cell] * 0.3 + world.fruit[cell];
    const i = world.insects[cell] * 0.6;
    const f = world.fungi[cell] * 0.25;
    const d = world.detritus[cell] * 0.4;
    world.grass[cell] -= g;
    world.shrub[cell] -= world.shrub[cell] * 0.3;
    world.fruit[cell] = 0;
    world.insects[cell] -= i;
    world.fungi[cell] -= f;
    world.detritus[cell] -= d;
    world.seedBank[cell] *= 0.5;
    grassBurnt += g;
    shrubBurnt += s;
    insectsBurnt += i;
    fungiBurnt += f;
    detritusBurnt += d;
    world.soilN[cell] += NUTRIENT_PER_ENERGY * (g + s + i + f + d);

    world.fire[cell]--;
    if (world.fire[cell] > 0) next.push(cell);

    const cx = cell % GRID;
    const cy = (cell / GRID) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const ny = cy + (k === 2 ? -1 : k === 3 ? 1 : 0);
      // Luôn rút số ngẫu nhiên để lượng tiêu thụ RNG không phụ thuộc biên bản đồ.
      const roll = rng.next();
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const n = ny * GRID + nx;
      if (world.fire[n] > 0 || world.depthAt(n) > 0 || world.terrain.elevation[n] > MOUNTAIN_LEVEL) continue;
      const chance = 0.5 * clamp01(fuel(sim, n) / 220) * (0.25 + 0.75 * dryness);
      if (roll < chance) {
        world.fire[n] = FIRE_BURN_STEPS;
        next.push(n);
      }
    }
  }
  const total = grassBurnt + shrubBurnt + insectsBurnt + fungiBurnt + detritusBurnt;
  ledger.flow(pools.grass, POOL_HEAT, grassBurnt);
  ledger.flow(pools.shrub, POOL_HEAT, shrubBurnt);
  ledger.flow(pools.insects, POOL_HEAT, insectsBurnt);
  ledger.flow(pools.fungi, POOL_HEAT, fungiBurnt);
  ledger.flow(POOL_DETRITUS, POOL_HEAT, detritusBurnt);
  ledger.nutrientReturn += NUTRIENT_PER_ENERGY * total;
}

/** Toạ độ tâm ô (dùng khi giao diện cần biết chỗ đang cháy). */
export function cellCenter(cell: number): [number, number] {
  return [((cell % GRID) + 0.5) * CELL_SIZE, (((cell / GRID) | 0) + 0.5) * CELL_SIZE];
}
