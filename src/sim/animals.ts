/**
 * Hệ động vật: mỗi tick di chuyển mọi cá thể; mỗi THINK_INTERVAL tick mỗi cá thể "suy nghĩ" một lần
 * (lệch pha theo số khe để dàn đều chi phí): sinh lý → cảm nhận → chấm điểm hành vi → thực thi.
 */
import {
  CANOPY_COVER_GROUND,
  FATIGUE_SLOWDOWN,
  FISH_MIN_DEPTH,
  GRID,
  MAX_GENES,
  TEMP_LAPSE,
  THINK_INTERVAL,
  WADE_DEPTH,
  WEAK_SPEED_FACTOR,
} from './constants';
import { capacityOf, goTo, passable } from './actions';
import type { ThinkContext } from './context';
import { clamp01, pow34 } from './detmath';
import { State } from './entities';
import { GENE_SIZE, GENE_SPEED, GENE_VISION } from './genetics';
import { moveAnimal } from './movement';
import { sense } from './perception';
import { physiology } from './physiology';
import { isAdult } from './reproduction';
import type { Simulation } from './simulation';
import { cellAt } from './terrain';
import {
  LOCO_AIR,
  LOCO_AMPHIBIOUS,
  LOCO_WATER,
  STAGE_JUVENILE,
  STAGE_LARVA,
  STAGE_WEANED,
} from '../species/runtime';
import { CELL_SIZE } from './constants';

/** Trạng thái hiện tại được cộng thêm điểm này để cá thể không đổi ý liên tục giữa hai lựa chọn sát nút. */
const COMMITMENT_BONUS = 0.06;

/** Cập nhật vùng (quần thể con) mà cá thể đang ở, theo kiểu vận động của loài. */
function updateRegion(ctx: ThinkContext): void {
  const { sim, i, sp, cell } = ctx;
  const terrain = sim.world.terrain;
  let region: number;
  switch (sp.locomotion) {
    case LOCO_AIR:
      region = 0; // bay qua mọi rào cản: cả bản đồ là một vùng
      break;
    case LOCO_WATER:
      region = terrain.waterRegion[cell];
      break;
    case LOCO_AMPHIBIOUS:
      region = terrain.shoreRegion[cell];
      break;
    default:
      region = terrain.landRegion[cell];
  }
  if (region >= 0) sim.animals.region[i] = region;
}

/** Điền phần "tình trạng cơ thể" của ngữ cảnh cho cá thể i. */
function prepare(ctx: ThinkContext, i: number): void {
  const sim = ctx.sim;
  const a = sim.animals;
  const world = sim.world;
  const climate = world.climate;
  const sp = sim.registry.animals[a.species[i]];
  const g = i * MAX_GENES;
  ctx.i = i;
  ctx.sp = sp;
  ctx.x = a.x[i];
  ctx.y = a.y[i];
  ctx.dt = THINK_INTERVAL;
  const cell = cellAt(ctx.x, ctx.y);
  ctx.cell = cell;
  const elevation = world.terrain.elevation[cell];
  ctx.depth = climate.waterLevel - elevation;
  ctx.canopy = world.terrain.canopy[cell];
  ctx.mass = a.structure[i];
  ctx.m34 = pow34(ctx.mass);
  ctx.capacity = capacityOf(sim, i);
  ctx.energyFrac = a.energy[i] / ctx.capacity;

  const inWater = ctx.depth > 0 && sp.locomotion !== LOCO_AIR;
  ctx.temperature = inWater
    ? climate.temperatureWater
    : climate.temperature - TEMP_LAPSE * (elevation > 0.5 ? elevation - 0.5 : 0);
  ctx.activity = sp.ectotherm ? 0.05 + 0.95 * clamp01((ctx.temperature - 3) / 13) : 1;

  const age = a.age[i];
  ctx.stage =
    age < sp.larvaUntil ? STAGE_LARVA : age < sp.weanAge ? STAGE_JUVENILE : STAGE_JUVENILE | STAGE_WEANED;
  ctx.adult = isAdult(sim, i);

  // Tầm nhìn: gen × ánh sáng (loài/gen hoạt động đêm nhìn đêm tốt hơn nhưng ngày kém hơn) × tán rừng chỗ đứng.
  let nightSkill = sp.nightVision;
  let daySkill = 1;
  let nightActive = sp.nocturnal;
  if (sp.gNocturnal >= 0) {
    const nocturnality = a.phenotype[g + sp.gNocturnal];
    nightSkill = sp.nightVision + (1 - sp.nightVision) * nocturnality;
    daySkill = 1 - 0.35 * nocturnality;
    nightActive = nocturnality > 0.5;
  }
  ctx.nightActive = nightActive;
  const light = nightSkill + (daySkill - nightSkill) * climate.daylight;
  const ownCover = sp.locomotion === LOCO_AIR ? 1 : 1 - CANOPY_COVER_GROUND * 0.6 * ctx.canopy;
  ctx.visionRange = sp.vision * a.phenotype[g + GENE_VISION] * light * ownCover;

  // Tốc độ: gen × thể trạng. Con non, con già, con đói hoặc bị thương đều chậm hơn — kẻ săn "chọn" chúng.
  const adultMass = sp.mass * a.phenotype[g + GENE_SIZE];
  const growth = clamp01(ctx.mass / adultMass);
  let condition = (0.55 + 0.45 * growth) * (0.6 + 0.4 * a.health[i]);
  condition *= WEAK_SPEED_FACTOR + (1 - WEAK_SPEED_FACTOR) * clamp01(ctx.energyFrac / 0.1);
  const ageFraction = age / sp.lifespan;
  if (ageFraction > 0.7) condition *= 1 - 0.3 * clamp01((ageFraction - 0.7) / 0.5);
  if (a.gestation[i] > 0) condition *= 0.93;
  if (sp.ectotherm) condition *= 0.4 + 0.6 * ctx.activity;
  const speedGene = a.phenotype[g + GENE_SPEED];
  ctx.walk = sp.walkSpeed * speedGene * condition;
  ctx.run = sp.runSpeed * speedGene * condition;
  const state = a.state[i];
  if ((state === State.FLEE || state === State.HUNT) && a.stateTime[i] > sp.endurance) {
    ctx.run *= 1 - FATIGUE_SLOWDOWN * clamp01((a.stateTime[i] - sp.endurance) / sp.endurance);
  }
}

/**
 * Thoát khỏi ô không sống được (lũ dâng quanh thú trên cạn, hồ cạn dưới bụng cá).
 * @returns true nếu đã đặt đích thoát hiểm
 */
function escapeBadCell(ctx: ThinkContext): boolean {
  const { sim, i, sp, cell } = ctx;
  if (sp.locomotion === LOCO_AIR || sp.locomotion === LOCO_AMPHIBIOUS) return false;
  if (sp.locomotion === LOCO_WATER ? ctx.depth >= FISH_MIN_DEPTH : ctx.depth <= WADE_DEPTH || sp.canSwim)
    return false;
  const cx = cell % GRID;
  const cy = (cell / GRID) | 0;
  // Tìm ô hợp lệ gần nhất theo các vòng vuông mở rộng dần.
  for (let radius = 1; radius <= 6; radius++) {
    let best = -1;
    let bestD = 1e9;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const n = ny * GRID + nx;
        if (!passable(sim, sp, n)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    if (best >= 0) {
      goTo(
        sim,
        i,
        ((best % GRID) + 0.5) * CELL_SIZE,
        (((best / GRID) | 0) + 0.5) * CELL_SIZE,
        ctx.run,
        State.FLEE,
      );
      return true;
    }
  }
  return false;
}

/** Một lượt suy nghĩ của cá thể i. */
function think(ctx: ThinkContext, i: number): void {
  const sim = ctx.sim;
  const a = sim.animals;
  prepare(ctx, i);
  if (!physiology(ctx)) return;
  updateRegion(ctx);
  if (escapeBadCell(ctx)) return;

  const sp = ctx.sp;
  // Ngủ đông: bỏ qua cảm nhận (đang ở trong hang/dưới bùn) — chỉ module ngủ đông quyết định khi nào dậy.
  const hibernating = a.state[i] === State.HIBERNATE;
  if (hibernating) {
    ctx.threat = -1;
    ctx.kinCount = 0;
    ctx.alarm = false;
    ctx.mate = -1;
    ctx.prey = -1;
    ctx.largePrey = -1;
    ctx.corpse = -1;
    ctx.rival = -1;
    ctx.groupNear = 0;
    ctx.groupPower = 0;
  } else {
    const weaned = (ctx.stage & STAGE_WEANED) !== 0;
    ctx.wantsPrey = sp.hunts && weaned && ctx.energyFrac < sp.huntBelow && a.huntCooldown[i] <= 0;
    ctx.wantsCorpse = sp.corpseRange > 0 && weaned && ctx.energyFrac < 0.92;
    ctx.wantsMate =
      ctx.adult &&
      a.gestation[i] === 0 &&
      a.reproCooldown[i] <= 0 &&
      (sp.seasonMask & (1 << sim.world.climate.season)) !== 0;
    sense(ctx);
  }

  const behaviors = sp.behaviors;
  let best = -1;
  let bestScore = 0;
  const current = a.state[i];
  for (let b = 0; b < behaviors.length; b++) {
    const behavior = behaviors[b];
    if ((behavior.stageMask & ctx.stage) === 0) continue;
    ctx.behaviorIndex = b;
    let score = behavior.module.score(ctx, behavior.params);
    if (score > 0 && a.behavior[i] === b && current !== State.IDLE) score += COMMITMENT_BONUS;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (best >= 0) {
    ctx.behaviorIndex = best;
    behaviors[best].module.apply(ctx, behaviors[best].params);
    if (a.alive[i] === 1) a.behavior[i] = best;
  } else {
    a.speed[i] = 0;
    a.state[i] = State.IDLE;
    a.behavior[i] = 255;
  }
}

/** Tiến hệ động vật một tick. */
export function stepAnimals(sim: Simulation): void {
  const a = sim.animals;
  const ctx = sim.context;
  const phase = sim.tick % THINK_INTERVAL;
  const high = a.high;
  for (let i = 0; i < high; i++) {
    if (a.alive[i] === 0) continue;
    if (i % THINK_INTERVAL === phase) {
      think(ctx, i);
      if (a.alive[i] === 0) continue;
    }
    moveAnimal(sim, i);
  }
  a.flushFreed();
}
