/**
 * Các hành động nguyên tử mà module hành vi và lõi dùng chung: di chuyển, ăn, đánh, chết.
 *
 * Đây là nơi DUY NHẤT năng lượng của động vật được chuyển giữa các kho, nên mọi hàm ở đây đều ghi sổ cái.
 */
import {
  ATTACK_DAMAGE,
  CANOPY_COVER_AIR,
  CARCASS_INTAKE_MULTIPLIER,
  FISH_MIN_DEPTH,
  MOUNTAIN_LEVEL,
  NUTRIENT_PER_ENERGY,
  RETALIATION_DAMAGE,
  STRIKE_COOLDOWN,
  STRIKE_HIT_CHANCE,
  WADE_DEPTH,
  WATER_REFUGE,
  WORLD_SIZE,
} from './constants';
import type { ThinkContext } from './context';
import { clamp } from './detmath';
import { Death, FLAG_ARRIVED, FLAG_BLOCKED, State } from './entities';
import { GENE_SPEED } from './genetics';
import { POOL_CORPSE, POOL_DETRITUS, POOL_HEAT } from './ledger';
import type { Simulation } from './simulation';
import { cellAt } from './terrain';
import { MAX_GENES } from './constants';
import { LOCO_AIR, LOCO_AMPHIBIOUS, LOCO_LAND, LOCO_WATER, type SpeciesRuntime } from '../species/runtime';
import type { FoodField } from '../species/types';

/** Nước nhận được khi ăn đầy dự trữ bằng thịt tươi (máu và mô chứa nhiều nước). */
const MEAT_WATER = 0.9;

/** Một nguồn thức ăn dạng trường mà loài ăn được (tham số của module `forage`). */
export interface ForageSource {
  field: FoodField;
  /** Chỉ số của trường trong `World.foodFields` (suy ra từ `field` lúc nạp loài). */
  fieldIndex: number;
  /** Hiệu suất đồng hoá: phần năng lượng ăn vào thành dự trữ; phần còn lại thải ra thành mùn. */
  assimilation: number;
  /** Phần không ăn tới được (gốc cỏ, cành cao…) (E/ô). */
  floor: number;
  /** Lượng khả dụng mà tại đó tốc độ ăn bằng nửa tối đa (E/ô) — đáp ứng chức năng Holling II. */
  halfSaturation: number;
  /** Nước nhận được khi ăn đầy dự trữ bằng nguồn này [0, 1]. */
  water: number;
  /** Nguồn thực vật (true) hay động vật (false) — gen "ăn thịt" của gấu điều chỉnh hiệu suất theo đó. */
  plant: boolean;
}

/** Sức chứa dự trữ năng lượng hiện tại của cá thể (E). */
export function capacityOf(sim: Simulation, slot: number): number {
  const a = sim.animals;
  const sp = sim.registry.animals[a.species[slot]];
  const fat = sp.gFat >= 0 ? a.phenotype[slot * MAX_GENES + sp.gFat] : 1;
  return sp.reserveRatio * a.structure[slot] * fat;
}

/** Hiệu suất đồng hoá thực vật/thịt sau khi tính gen "ăn thịt" (đánh đổi cấu tạo ruột). */
export function assimilation(
  sim: Simulation,
  slot: number,
  sp: SpeciesRuntime,
  base: number,
  plant: boolean,
): number {
  if (sp.gCarnivory < 0) return base;
  const carnivory = sim.animals.phenotype[slot * MAX_GENES + sp.gCarnivory];
  const factor = plant ? 1.3 - 0.6 * carnivory : 0.7 + 0.6 * carnivory;
  return Math.min(0.95, base * factor);
}

/** Loài này có đứng/bơi/bay được ở ô này không. */
export function passable(sim: Simulation, sp: SpeciesRuntime, cell: number): boolean {
  const elevation = sim.world.terrain.elevation[cell];
  const depth = sim.world.climate.waterLevel - elevation;
  switch (sp.locomotion) {
    case LOCO_AIR:
      return true;
    case LOCO_WATER:
      return depth >= FISH_MIN_DEPTH;
    case LOCO_AMPHIBIOUS:
      return elevation < MOUNTAIN_LEVEL;
    default:
      return elevation < MOUNTAIN_LEVEL && (depth <= WADE_DEPTH || sp.canSwim);
  }
}

/** Đặt đích di chuyển, tốc độ và trạng thái. */
export function goTo(
  sim: Simulation,
  slot: number,
  x: number,
  y: number,
  speed: number,
  state: number,
): void {
  const a = sim.animals;
  a.targetX[slot] = clamp(x, 1, WORLD_SIZE - 1);
  a.targetY[slot] = clamp(y, 1, WORLD_SIZE - 1);
  a.speed[slot] = speed;
  a.flags[slot] &= ~(FLAG_ARRIVED | FLAG_BLOCKED);
  setState(sim, slot, state);
}

/** Dừng lại tại chỗ với trạng thái cho trước. */
export function halt(sim: Simulation, slot: number, state: number): void {
  const a = sim.animals;
  a.speed[slot] = 0;
  setState(sim, slot, state);
}

/** Đổi trạng thái; đặt lại đồng hồ trạng thái nếu trạng thái thực sự thay đổi. */
export function setState(sim: Simulation, slot: number, state: number): void {
  const a = sim.animals;
  if (a.state[slot] !== state) {
    a.state[slot] = state;
    a.stateTime[slot] = 0;
  }
}

/** Thứ tự các trường thức ăn trong `World.foodFields`. */
export const FOOD_FIELDS: readonly FoodField[] = ['grass', 'shrub', 'fruit', 'algae', 'insects'];

/** Lượng thức ăn khả dụng của một nguồn tại một ô (đã trừ phần không ăn tới được). */
export function availableAt(sim: Simulation, source: ForageSource, cell: number): number {
  const amount = sim.world.foodFields[source.fieldIndex][cell] - source.floor;
  return amount > 0 ? amount : 0;
}

/**
 * Ăn từ một trường tại ô đang đứng trong khoảng thời gian ctx.dt.
 * Năng lượng: trường → loài (toàn bộ lượng ăn), rồi loài → mùn (phần không đồng hoá, thải tại chỗ).
 * @returns lượng đã ăn (E)
 */
export function consumeField(ctx: ThinkContext, source: ForageSource): number {
  const { sim, i, sp, cell } = ctx;
  const a = sim.animals;
  const field = sim.world.foodFields[source.fieldIndex];
  const available = field[cell] - source.floor;
  const room = ctx.capacity - a.energy[i];
  if (available <= 0 || room <= 0) return 0;
  const efficiency = assimilation(sim, i, sp, source.assimilation, source.plant);
  let eaten = (sp.intake * ctx.m34 * ctx.dt * ctx.activity * available) / (available + source.halfSaturation);
  if (eaten > available) eaten = available;
  if (eaten > room / efficiency) eaten = room / efficiency;
  field[cell] -= eaten;
  a.energy[i] += efficiency * eaten;
  const waste = (1 - efficiency) * eaten;
  sim.world.detritus[cell] += waste;
  const pool = sim.foodPools[source.fieldIndex];
  sim.ledger.flow(pool, sp.pool, eaten);
  sim.ledger.flow(sp.pool, POOL_DETRITUS, waste);
  sim.stats.addIntake(sp.pool, pool, eaten);
  if (source.field === 'fruit') a.seedLoad[i] += eaten;
  if (source.water > 0) {
    // Cỏ tươi khi đất ẩm chứa đủ nước cho thú ăn cỏ; khi hạn thì cỏ khô, chúng buộc phải tìm tới nguồn nước.
    const juiciness = source.plant ? clamp(0.25 + 1.2 * sim.world.climate.soilWetness, 0, 1) : 1;
    a.water[i] = Math.min(
      1,
      a.water[i] + ((source.water * juiciness * efficiency * eaten) / ctx.capacity) * 1.5,
    );
  }
  return eaten;
}

/**
 * Ăn một cái xác trong tầm với. Năng lượng: xác → loài, rồi loài → mùn (phần không đồng hoá).
 * @returns lượng đã ăn (E)
 */
export function eatCorpse(ctx: ThinkContext, corpse: number): number {
  const { sim, i, sp, cell } = ctx;
  const a = sim.animals;
  const corpses = sim.corpses;
  const room = ctx.capacity - a.energy[i];
  if (room <= 0 || corpses.alive[corpse] === 0) return 0;
  const efficiency = assimilation(sim, i, sp, sp.meatAssimilation, false);
  let eaten = sp.intake * ctx.m34 * ctx.dt * CARCASS_INTAKE_MULTIPLIER * ctx.activity;
  if (eaten > corpses.energy[corpse]) eaten = corpses.energy[corpse];
  if (eaten > room / efficiency) eaten = room / efficiency;
  corpses.energy[corpse] -= eaten;
  a.energy[i] += efficiency * eaten;
  const waste = (1 - efficiency) * eaten;
  sim.world.detritus[cell] += waste;
  sim.ledger.flow(POOL_CORPSE, sp.pool, eaten);
  sim.ledger.flow(sp.pool, POOL_DETRITUS, waste);
  // Lưới thức ăn: nếu chính loài này giết con mồi thì tính là dòng "con mồi → kẻ săn", còn lại là ăn xác.
  const source =
    corpses.killer[corpse] === sp.index ? sim.registry.animals[corpses.species[corpse]].pool : POOL_CORPSE;
  sim.stats.addIntake(sp.pool, source, eaten);
  a.water[i] = Math.min(1, a.water[i] + (MEAT_WATER * efficiency * eaten) / ctx.capacity);
  if (corpses.energy[corpse] < 0.02) removeCorpse(sim, corpse);
  return eaten;
}

/** Xoá xác; phần năng lượng còn sót lại thành mùn tại chỗ. */
export function removeCorpse(sim: Simulation, corpse: number): void {
  const corpses = sim.corpses;
  const rest = corpses.energy[corpse];
  if (rest > 0) {
    sim.world.detritus[cellAt(corpses.x[corpse], corpses.y[corpse])] += rest;
    sim.ledger.flow(POOL_CORPSE, POOL_DETRITUS, rest);
  }
  corpses.remove(corpse);
}

/**
 * Cá thể chết: toàn bộ năng lượng (dự trữ + cấu trúc) thành một cái xác tại chỗ.
 * @param killerSpecies chỉ số loài của kẻ giết, hoặc 255 nếu không bị săn
 * @returns khe của xác
 */
export function killAnimal(sim: Simulation, slot: number, cause: number, killerSpecies: number): number {
  const a = sim.animals;
  const sp = sim.registry.animals[a.species[slot]];
  const energy = Math.max(0, a.energy[slot]) + a.structure[slot];
  const corpse = sim.corpses.add(a.x[slot], a.y[slot], energy, sp.index, killerSpecies);
  sim.ledger.flow(sp.pool, POOL_CORPSE, energy);
  if (a.seedLoad[slot] > 0) {
    const cell = cellAt(a.x[slot], a.y[slot]);
    if (sim.world.depthAt(cell) <= 0) sim.world.seedBank[cell] += a.seedLoad[slot];
  }
  a.energy[slot] = 0;
  a.structure[slot] = 0;
  sim.stats.addDeath(sp.index, cause);
  sim.pedigree.markDeath(a.id[slot], sim.tick);
  a.release(slot);
  return corpse;
}

/** Trả năng lượng hô hấp về nhiệt và N về đất tại ô đang đứng. */
export function respire(sim: Simulation, sp: SpeciesRuntime, cell: number, amount: number): void {
  sim.ledger.flow(sp.pool, POOL_HEAT, amount);
  const nutrient = NUTRIENT_PER_ENERGY * amount;
  sim.world.soilN[cell] += nutrient;
  sim.ledger.nutrientReturn += nutrient;
}

/** Làm con vật bỏ chạy ra xa điểm (fromX, fromY). */
export function startle(sim: Simulation, slot: number, fromX: number, fromY: number): void {
  const a = sim.animals;
  if (a.state[slot] === State.HIBERNATE) return;
  const sp = sim.registry.animals[a.species[slot]];
  let dx = a.x[slot] - fromX;
  let dy = a.y[slot] - fromY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0.001) {
    dx /= d;
    dy /= d;
  } else {
    dx = 1;
    dy = 0;
  }
  const speed =
    sp.runSpeed * a.phenotype[slot * MAX_GENES + GENE_SPEED] * (0.6 + 0.4 * Math.max(0, a.health[slot]));
  goTo(sim, slot, a.x[slot] + dx * 70, a.y[slot] + dy * 70, speed, State.FLEE);
}

/**
 * Kẻ săn `predator` ra đòn vào `prey` (đã ở trong tầm với).
 * Con mồi nhỏ chết ngay; con mồi lớn chỉ bị thương và phản đòn — vì thế hạ hươu cần cả bầy sói.
 */
export function strike(sim: Simulation, predator: number, prey: number): void {
  const a = sim.animals;
  const rng = sim.rng;
  const hunter = sim.registry.animals[a.species[predator]];
  const victim = sim.registry.animals[a.species[prey]];
  a.strikeCooldown[predator] = STRIKE_COOLDOWN;

  const preyCell = cellAt(a.x[prey], a.y[prey]);
  let hitChance = STRIKE_HIT_CHANCE;
  if (hunter.locomotion === LOCO_AIR) {
    // Lao xuống từ trên không: tán rừng che gần hết; cánh dài thì kém linh hoạt hơn.
    hitChance *= 1 - CANOPY_COVER_AIR * sim.world.terrain.canopy[preyCell];
    if (hunter.gWingspan >= 0)
      hitChance *= 1.25 - 0.5 * (a.phenotype[predator * MAX_GENES + hunter.gWingspan] - 0.5);
  }
  if (
    sim.world.depthAt(preyCell) > 0 &&
    victim.locomotion !== LOCO_LAND &&
    hunter.locomotion !== LOCO_WATER
  ) {
    hitChance *= WATER_REFUGE;
  }
  // Con mồi nhanh nhẹn hơn kẻ săn thì né tốt hơn.
  const agility =
    a.phenotype[prey * MAX_GENES + GENE_SPEED] * victim.runSpeed -
    a.phenotype[predator * MAX_GENES + GENE_SPEED] * hunter.runSpeed;
  hitChance *= clamp(1 - 0.25 * agility, 0.5, 1.3);
  if (a.state[prey] === State.REST || a.state[prey] === State.HIBERNATE) hitChance *= 1.3;

  if (rng.next() < hitChance) {
    const ratio = a.structure[predator] / a.structure[prey];
    a.health[prey] -= ATTACK_DAMAGE * hunter.attack * ratio;
    // Cắn trúng thì càng hăng: đồng hồ "đuổi bao lâu rồi" lùi lại một nửa, nếu không bầy sẽ bỏ cuộc ngay khi vừa áp sát.
    a.stateTime[predator] *= 0.5;
    if (a.health[prey] <= 0) {
      const corpse = killAnimal(sim, prey, Death.PREDATION, hunter.index);
      sim.stats.addKill(hunter.index, victim.index);
      if (a.group[predator] >= 0) sim.groups.setKill(a.group[predator], corpse, sim.corpses.id[corpse]);
      a.state[predator] = State.EAT;
      a.stateTime[predator] = 0;
      a.target[predator] = corpse;
      a.targetId[predator] = sim.corpses.id[corpse];
      a.targetX[predator] = sim.corpses.x[corpse];
      a.targetY[predator] = sim.corpses.y[corpse];
      a.speed[predator] = 0;
      return;
    }
    if (victim.defense > 0) {
      a.health[predator] -= RETALIATION_DAMAGE * victim.defense * (a.structure[prey] / a.structure[predator]);
      if (a.health[predator] <= 0) {
        killAnimal(sim, predator, Death.INJURY, 255);
        return;
      }
    }
  }
  if (a.alive[prey] === 1) startle(sim, prey, a.x[predator], a.y[predator]);
}

/** Kiểu vận động có phải thuỷ sinh/lưỡng cư không (ở trong nước thì không khát). */
export function livesInWater(sp: SpeciesRuntime): boolean {
  return sp.locomotion === LOCO_WATER || sp.locomotion === LOCO_AMPHIBIOUS;
}
