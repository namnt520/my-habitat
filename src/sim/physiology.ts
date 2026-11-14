/**
 * Sinh lý mỗi lượt suy nghĩ: tuổi, chuyển hoá, nước, sức khoẻ, lớn lên, bú mẹ, mang thai, và cái chết.
 *
 * Mọi "đánh đổi" của bộ gen nằm ở đây dưới dạng chi phí năng lượng — không có hàm thích nghi viết tay.
 */
import {
  BASAL_METABOLISM,
  COLD_STRESS,
  DEHYDRATION_DAMAGE,
  DISEASE_DAMAGE,
  DROWN_DAMAGE,
  FIRE_DAMAGE,
  FISH_MIN_DEPTH,
  GROWTH_EFFICIENCY,
  GROWTH_RESERVE_FRACTION,
  HEALTH_REGEN,
  HEAT_STRESS,
  HIBERNATE_METABOLISM,
  INSULATION_COLD_SHIFT,
  INSULATION_HEAT_SHIFT,
  INSULATION_UPKEEP,
  MAX_GENES,
  MOVE_COST,
  REST_METABOLISM,
  SENESCENCE_HAZARD,
  SENESCENCE_START,
  SPEED_UPKEEP,
  STARVATION_DAMAGE,
  VISION_UPKEEP,
  WADE_DEPTH,
} from './constants';
import { capacityOf, killAnimal, livesInWater, respire } from './actions';
import type { ThinkContext } from './context';
import { Death, FLAG_IMMUNE, State } from './entities';
import { GENE_COLD, GENE_SIZE, GENE_SPEED, GENE_VISION } from './genetics';
import { giveBirth } from './reproduction';
import { LOCO_AIR, LOCO_LAND, LOCO_WATER } from '../species/runtime';

/** Tốc độ mẹ truyền năng lượng cho con đang bú (E/tick cho mỗi khối lượng^0,75 của con). */
const NURSING_RATE = 0.04;
/** Con chỉ bú được khi ở trong khoảng cách này tới mẹ (u). */
const NURSING_RANGE = 40;
/** Mẹ chỉ cho bú khi dự trữ của mẹ còn trên tỉ lệ này. */
const NURSING_MOTHER_FLOOR = 0.3;
/** Tỉ lệ hạt trong ruột được thải ra mỗi tick (thời gian lưu trung bình ≈ 50 tick). */
const SEED_PASSAGE = 0.02;

/**
 * Cập nhật sinh lý của cá thể trong ctx.
 * @returns false nếu cá thể đã chết trong lượt này
 */
export function physiology(ctx: ThinkContext): boolean {
  const { sim, i, sp, dt, cell } = ctx;
  const a = sim.animals;
  const world = sim.world;
  const g = i * MAX_GENES;
  const state = a.state[i];
  const hibernating = state === State.HIBERNATE;

  a.age[i] += dt;
  a.stateTime[i] += dt;
  if (a.reproCooldown[i] > 0) a.reproCooldown[i] -= dt;
  if (a.huntCooldown[i] > 0) a.huntCooldown[i] -= dt;

  // ── Chuyển hoá ──
  const speedGene = a.phenotype[g + GENE_SPEED];
  const visionGene = a.phenotype[g + GENE_VISION];
  const sizeGene = a.phenotype[g + GENE_SIZE];
  const insulation = a.phenotype[g + GENE_COLD];
  let basal =
    BASAL_METABOLISM *
    ctx.m34 *
    sp.metabolism *
    (1 + SPEED_UPKEEP * (speedGene - 1)) *
    (1 + VISION_UPKEEP * (visionGene - 1)) *
    (1 + INSULATION_UPKEEP * insulation);
  let moveFactor = sp.moveCost;
  if (sp.gWingspan >= 0) {
    // Cánh dài: bay lượn rẻ hơn (lực cản cảm ứng ∝ 1/sải cánh²) nhưng nuôi cánh tốn hơn.
    const span = a.phenotype[g + sp.gWingspan];
    moveFactor /= span * span;
    basal *= 1 + 0.3 * (span - 1);
  }
  if (sp.gFat >= 0) {
    // Tích mỡ nhiều: chịu đói lâu hơn nhưng nặng nề hơn.
    const fat = a.phenotype[g + sp.gFat];
    moveFactor *= 1 + 0.6 * (fat - 1);
    basal *= 1 + 0.15 * (fat - 1);
  }
  if (hibernating) {
    basal *= HIBERNATE_METABOLISM;
  } else {
    if (state === State.REST) basal *= REST_METABOLISM;
    if (sp.ectotherm) {
      basal *= 0.05 + 0.95 * ctx.activity; // máu lạnh: trời lạnh thì gần như ngừng tiêu hao
    } else {
      // Thân to giữ nhiệt tốt hơn (quy tắc Bergmann) nhưng cũng khó toả nhiệt hơn.
      const low = sp.comfortLow - INSULATION_COLD_SHIFT * insulation - 6 * (sizeGene - 1);
      const high = sp.comfortHigh - INSULATION_HEAT_SHIFT * insulation - 4 * (sizeGene - 1);
      if (ctx.temperature < low) basal *= 1 + COLD_STRESS * (low - ctx.temperature);
      else if (ctx.temperature > high) basal *= 1 + HEAT_STRESS * (ctx.temperature - high);
    }
  }
  const v2 = a.vx[i] * a.vx[i] + a.vy[i] * a.vy[i];
  let movement = MOVE_COST * ctx.m34 * v2 * moveFactor;
  if (ctx.depth > WADE_DEPTH && sp.locomotion === LOCO_LAND) movement *= 3; // bơi tốn sức hơn chạy
  let cost = (basal + movement) * dt * sim.params.metabolism;
  let damageCause = -1;
  if (cost > a.energy[i]) {
    cost = a.energy[i] > 0 ? a.energy[i] : 0;
    a.health[i] -= STARVATION_DAMAGE * dt;
    damageCause = Death.STARVATION;
  }
  if (cost > 0) {
    a.energy[i] -= cost;
    respire(sim, sp, cell, cost);
  }

  // ── Nước ──
  if (sim.params.thirst && sp.thirst > 0) {
    if (ctx.depth > 0 && livesInWater(sp)) {
      a.water[i] = 1;
    } else {
      let loss = sp.thirst * dt;
      if (hibernating) loss *= 0.05;
      else if (ctx.temperature > 22) loss *= 1 + 0.05 * (ctx.temperature - 22);
      if (sp.gAquatic >= 0) loss *= 0.5 + a.phenotype[g + sp.gAquatic]; // da thấm nước: xuống nước giỏi, lên cạn mau khô
      a.water[i] -= loss;
      if (a.water[i] <= 0) {
        a.water[i] = 0;
        a.health[i] -= DEHYDRATION_DAMAGE * dt;
        damageCause = Death.THIRST;
      }
    }
  }

  // ── Môi trường chết người ──
  if (sp.locomotion === LOCO_WATER) {
    if (ctx.depth < FISH_MIN_DEPTH) {
      a.health[i] -= DROWN_DAMAGE * dt;
      damageCause = Death.DROWNING;
    }
  } else if (sp.locomotion === LOCO_LAND && !sp.canSwim && ctx.depth > WADE_DEPTH) {
    a.health[i] -= DROWN_DAMAGE * dt;
    damageCause = Death.DROWNING;
  }
  if (world.fire[cell] > 0 && sp.locomotion !== LOCO_AIR && ctx.depth <= 0) {
    a.health[i] -= FIRE_DAMAGE;
    damageCause = Death.FIRE;
  }
  if (a.sick[i] > 0) {
    a.sick[i] -= dt;
    a.health[i] -= DISEASE_DAMAGE * dt;
    if (a.health[i] <= 0) damageCause = Death.DISEASE;
    if (a.sick[i] <= 0) {
      a.sick[i] = 0;
      a.flags[i] |= FLAG_IMMUNE;
    }
  }

  if (a.health[i] <= 0) {
    killAnimal(sim, i, damageCause >= 0 ? damageCause : Death.INJURY, 255);
    return false;
  }

  // ── Lão hoá: nguy cơ chết tăng theo bình phương tuổi vượt ngưỡng ──
  const ageFraction = a.age[i] / sp.lifespan;
  if (ageFraction > SENESCENCE_START) {
    const x = (ageFraction - SENESCENCE_START) / (1 - SENESCENCE_START);
    if (sim.rng.next() < (SENESCENCE_HAZARD * x * x * dt) / sp.lifespan) {
      killAnimal(sim, i, Death.AGE, 255);
      return false;
    }
  }

  // Dung lượng dự trữ và tỉ lệ đang có sau khi trả chi phí.
  let capacity = ctx.capacity;
  let energyFrac = a.energy[i] / capacity;

  if (energyFrac > 0.3 && a.water[i] > 0.15 && a.sick[i] === 0 && a.health[i] < 1) {
    a.health[i] = Math.min(1, a.health[i] + HEALTH_REGEN * dt);
  }

  // ── Bú mẹ / được nuôi: năng lượng chuyển trong nội bộ loài nên không cần ghi sổ cái ──
  if (sp.weanAge > 0 && a.age[i] < sp.weanAge && energyFrac < 0.85) {
    let provider = -1;
    let spare = 0;
    const mother = a.motherSlot[i];
    if (mother >= 0 && a.alive[mother] === 1 && a.id[mother] === a.motherId[i]) {
      const dx = a.x[mother] - ctx.x;
      const dy = a.y[mother] - ctx.y;
      if (dx * dx + dy * dy < NURSING_RANGE * NURSING_RANGE) {
        provider = mother;
        spare = a.energy[mother] - NURSING_MOTHER_FLOOR * capacityOf(sim, mother);
      }
    } else {
      a.motherSlot[i] = -1;
    }
    // Loài sống theo bầy nuôi con chung: mẹ vắng mặt hoặc đã cạn sức thì con trưởng thành khác trong bầy mớm mồi.
    if (spare <= 0 && sp.usesGroups && a.group[i] >= 0) {
      const members = sim.members;
      const group = a.group[i];
      for (let k = members.start[sp.index]; k < members.start[sp.index + 1]; k++) {
        const j = members.items[k];
        if (a.alive[j] === 0 || a.group[j] !== group || a.age[j] < sp.maturity) continue;
        const dx = a.x[j] - ctx.x;
        const dy = a.y[j] - ctx.y;
        if (dx * dx + dy * dy > NURSING_RANGE * NURSING_RANGE) continue;
        const available = a.energy[j] - NURSING_MOTHER_FLOOR * capacityOf(sim, j);
        if (available > spare) {
          spare = available;
          provider = j;
        }
      }
    }
    if (provider >= 0 && spare > 0) {
      let milk = NURSING_RATE * ctx.m34 * dt;
      if (milk > spare) milk = spare;
      if (milk > capacity - a.energy[i]) milk = capacity - a.energy[i];
      if (milk > 0) {
        a.energy[provider] -= milk;
        a.energy[i] += milk;
      }
    }
  }

  // ── Lớn lên ──
  const adultMass = sp.mass * sizeGene;
  if (ctx.mass < adultMass && !hibernating) {
    const surplus = a.energy[i] - GROWTH_RESERVE_FRACTION * capacity;
    if (surplus > 0) {
      let invest = sp.growth * ctx.m34 * dt * ctx.activity;
      if (invest > surplus) invest = surplus;
      const needed = (adultMass - ctx.mass) / GROWTH_EFFICIENCY;
      if (invest > needed) invest = needed;
      a.energy[i] -= invest;
      a.structure[i] += invest * GROWTH_EFFICIENCY;
      respire(sim, sp, cell, invest * (1 - GROWTH_EFFICIENCY));
      ctx.mass = a.structure[i];
      capacity = capacityOf(sim, i);
    }
  }

  // ── Thải hạt dọc đường đi ──
  if (a.seedLoad[i] > 0) {
    const dropped = Math.min(a.seedLoad[i], a.seedLoad[i] * SEED_PASSAGE * dt + 0.002);
    a.seedLoad[i] -= dropped;
    if (ctx.depth <= 0) world.seedBank[cell] += dropped;
  }

  // ── Đẻ ──
  if (a.gestation[i] > 0) {
    a.gestation[i] -= dt;
    if (a.gestation[i] <= 0) giveBirth(sim, i);
  }

  energyFrac = a.energy[i] / capacity;
  ctx.capacity = capacity;
  ctx.energyFrac = energyFrac;
  return true;
}
