/**
 * Giác quan: một lượt quét hàng xóm duy nhất qua spatial hash, điền kết quả vào ThinkContext.
 *
 * Giới hạn giác quan được mô hình hoá bằng "tầm phát hiện hữu hiệu":
 *   tầm nhìn của kẻ quan sát × (ánh sáng) × (tán rừng chỗ kẻ quan sát)
 *   × (tán rừng che mục tiêu) × (nguỵ trang của mục tiêu) × (mục tiêu đứng im) × (kích thước mục tiêu).
 */
import {
  AERIAL_STRIKE_DEPTH,
  CAMOUFLAGE_STRENGTH,
  CANOPY_COVER_AIR,
  CANOPY_COVER_GROUND,
  DISEASE_DURATION,
  DISEASE_RADIUS,
  DISEASE_TRANSMISSION,
  HIBERNATION_COVER,
  MAX_GENES,
  SNOW_TEMPERATURE,
  STILLNESS_COVER,
  WADE_DEPTH,
} from './constants';
import type { ThinkContext } from './context';
import { FLAG_IMMUNE, FLAG_SAW_THREAT, State } from './entities';
import { GENE_HUE, GENE_LIGHT } from './genetics';
import { isReadyToMate } from './reproduction';
import type { Simulation } from './simulation';
import { cellAt } from './terrain';
import { LOCO_AIR, LOCO_LAND, LOCO_WATER } from '../species/runtime';

/** Mức nguỵ trang [0, 1] của một cá thể trên nền ô nó đang đứng (1 = trùng màu hoàn toàn). */
export function camouflage(sim: Simulation, slot: number, cell: number): number {
  const a = sim.animals;
  const terrain = sim.world.terrain;
  const lightness = a.phenotype[slot * MAX_GENES + GENE_LIGHT];
  let distance: number;
  if (sim.world.climate.temperatureDaily < SNOW_TEMPERATURE && sim.world.depthAt(cell) <= 0) {
    // Tuyết phủ: nền trắng, sắc độ không còn ý nghĩa.
    distance = Math.abs(lightness - 0.88) * 1.2;
  } else {
    const dh = Math.abs(a.phenotype[slot * MAX_GENES + GENE_HUE] - terrain.bgHue[cell]) * 2;
    const dl = lightness - terrain.bgLight[cell];
    distance = Math.sqrt(dh * dh + dl * dl);
  }
  const match = 1 - distance / 0.5;
  return match > 0 ? match : 0;
}

/** Kẻ quan sát trong ctx có phát hiện được cá thể `target` ở khoảng cách bình phương d2 không. */
export function detects(ctx: ThinkContext, target: number, d2: number): boolean {
  const sim = ctx.sim;
  const a = sim.animals;
  const targetSpecies = sim.registry.animals[a.species[target]];
  const cell = cellAt(a.x[target], a.y[target]);
  let factor = targetSpecies.visibility;
  const state = a.state[target];
  const flying = targetSpecies.locomotion === LOCO_AIR && state !== State.REST;
  if (!flying) {
    const cover = ctx.sp.locomotion === LOCO_AIR ? CANOPY_COVER_AIR : CANOPY_COVER_GROUND;
    factor *= 1 - cover * sim.world.terrain.canopy[cell];
    factor *= 1 - CAMOUFLAGE_STRENGTH * camouflage(sim, target, cell);
  }
  if (state === State.HIBERNATE || (state === State.REST && targetSpecies.burrows))
    factor *= 1 - HIBERNATION_COVER;
  else if (a.speed[target] === 0) factor *= 1 - STILLNESS_COVER;
  const range = ctx.visionRange * factor;
  return d2 < range * range;
}

/** Xoá kết quả cảm nhận của lượt trước. */
function resetPercept(ctx: ThinkContext): void {
  ctx.threat = -1;
  ctx.threatDist = 1e9;
  ctx.awayX = 0;
  ctx.awayY = 0;
  ctx.kinCount = 0;
  ctx.kinX = 0;
  ctx.kinY = 0;
  ctx.kinVX = 0;
  ctx.kinVY = 0;
  ctx.alarm = false;
  ctx.alarmX = 0;
  ctx.alarmY = 0;
  ctx.groupNear = 0;
  ctx.groupPower = 0;
  ctx.rival = -1;
  ctx.rivalDist = 1e9;
  ctx.mate = -1;
  ctx.mateDist = 1e9;
  ctx.prey = -1;
  ctx.preyDist = 1e9;
  ctx.preyValue = 0;
  ctx.largePrey = -1;
  ctx.largePreyDist = 1e9;
  ctx.corpse = -1;
  ctx.corpseDist = 1e9;
}

/** Quét hàng xóm trong tầm nhìn và điền phần "cảm nhận" của ngữ cảnh. */
export function sense(ctx: ThinkContext): void {
  resetPercept(ctx);
  const { sim, i, sp } = ctx;
  const a = sim.animals;
  const world = sim.world;
  const radius = ctx.visionRange;
  const r2 = radius * radius;
  const scratch = sim.scratch;
  const found = sim.hash.query(ctx.x, ctx.y, radius, scratch);

  const myGroup = a.group[i];
  const mySex = a.sex[i];
  const myLineage = a.lineage[i];
  const predatorMask = sp.predatorMask;
  const preyMask = ctx.wantsPrey ? sp.preyMask : 0;
  const panic = sp.panicFraction * radius;
  const panic2 = panic * panic;
  const sick = a.sick[i] > 0;
  const landBound = sp.locomotion === LOCO_LAND && !sp.canSwim;
  const myRegion = a.region[i];
  const landRegion = world.terrain.landRegion;
  let mate2 = 1e18;
  let rival2 = 1e18;
  let threat2 = 1e18;
  let bestPrey = 0;
  let bestLarge = 0;

  // Đồng loại chỉ cần xét khi loài sống theo đàn/bầy/lãnh thổ, khi đang tìm bạn tình, hoặc khi đang mang bệnh.
  const kinMatters = sp.social || ctx.wantsMate || sick;
  const relevantMask = predatorMask | preyMask;
  const canopy = world.terrain.canopy;

  for (let k = 0; k < found; k++) {
    const j = scratch[k];
    if (j === i) continue;
    // Lọc theo loài TRƯỚC khi đọc toạ độ: phần lớn hàng xóm không liên quan (thỏ không quan tâm tới hươu).
    const species = a.species[j];
    if (species === sp.index) {
      if (!kinMatters) continue;
    } else if ((relevantMask & (1 << species)) === 0) continue;
    if (a.alive[j] === 0) continue;
    const dx = a.x[j] - ctx.x;
    const dy = a.y[j] - ctx.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;

    if (species === sp.index) {
      ctx.kinCount++;
      ctx.kinX += a.x[j];
      ctx.kinY += a.y[j];
      ctx.kinVX += a.vx[j];
      ctx.kinVY += a.vy[j];
      // Báo động chỉ lan MỘT bước: từ con tận mắt thấy mối nguy sang con nhìn thấy nó.
      // Nếu lan nhiều bước, cả đàn sẽ hoảng loạn vô tận vì chính sự hoảng loạn của mình.
      if (sp.alarm && a.state[j] === State.FLEE && (a.flags[j] & FLAG_SAW_THREAT) !== 0) {
        ctx.alarm = true;
        ctx.alarmX += a.vx[j];
        ctx.alarmY += a.vy[j];
      }
      if (myGroup >= 0 && a.group[j] === myGroup) {
        ctx.groupNear++;
        ctx.groupPower += a.structure[j] * a.health[j];
      } else if (sp.territorial && d2 < rival2 && a.age[j] >= sp.weanAge && a.sex[j] === mySex) {
        rival2 = d2;
        ctx.rival = j;
      }
      if (
        ctx.wantsMate &&
        d2 < mate2 &&
        a.sex[j] !== mySex &&
        a.lineage[j] === myLineage &&
        isReadyToMate(sim, j)
      ) {
        mate2 = d2;
        ctx.mate = j;
      }
      if (
        sick &&
        a.sick[j] === 0 &&
        (a.flags[j] & FLAG_IMMUNE) === 0 &&
        d2 < DISEASE_RADIUS * DISEASE_RADIUS
      ) {
        if (sim.rng.next() < DISEASE_TRANSMISSION) a.sick[j] = DISEASE_DURATION;
      }
      continue;
    }

    const bit = 1 << species;
    if ((predatorMask & bit) !== 0) {
      const state = a.state[j];
      if (state === State.HIBERNATE) continue;
      // Kẻ săn đang lao tới thì đáng sợ ở mọi khoảng cách nhìn thấy; kẻ săn đang rình (đi chậm) hay đang no
      // chỉ khiến con mồi bỏ chạy khi lọt vào "khoảng cách hoảng sợ". Nhờ vậy rình mồi mới có ý nghĩa.
      if ((state === State.HUNT || d2 < panic2) && detects(ctx, j, d2)) {
        const weight = 1 / (d2 + 1);
        ctx.awayX -= dx * weight;
        ctx.awayY -= dy * weight;
        if (d2 < threat2) {
          threat2 = d2;
          ctx.threat = j;
        }
      }
    } else if ((preyMask & bit) !== 0) {
      const preyCell = cellAt(a.x[j], a.y[j]);
      const preyDepth = world.depthAt(preyCell);
      // Con mồi dưới nước sâu: chỉ loài bay (lao xuống mặt nước) và loài thuỷ sinh với tới được.
      if (preyDepth > WADE_DEPTH * 2.5 && sp.locomotion !== LOCO_AIR && sp.locomotion !== LOCO_WATER)
        continue;
      if (preyDepth > AERIAL_STRIKE_DEPTH && sp.locomotion === LOCO_AIR) continue;
      if (landBound && preyDepth <= 0 && landRegion[preyCell] !== myRegion) continue;
      if (sp.aerialHunter && canopy[preyCell] > 0.6) continue;
      if (!detects(ctx, j, d2)) continue;
      const ratio = ctx.mass / a.structure[j];
      const value = (a.structure[j] + a.energy[j]) / (Math.sqrt(d2) + 25);
      if (ratio >= sp.soloMassRatio) {
        if (value > bestPrey) {
          bestPrey = value;
          ctx.prey = j;
          ctx.preyDist = Math.sqrt(d2);
          ctx.preyValue = value;
        }
      } else if (value * (2 - a.health[j]) > bestLarge) {
        // Mồi lớn: ưu tiên con đang bị thương/yếu.
        bestLarge = value * (2 - a.health[j]);
        ctx.largePrey = j;
        ctx.largePreyDist = Math.sqrt(d2);
      }
    }
  }

  if (ctx.threat >= 0) ctx.threatDist = Math.sqrt(threat2);
  if (ctx.mate >= 0) ctx.mateDist = Math.sqrt(mate2);
  if (ctx.rival >= 0) ctx.rivalDist = Math.sqrt(rival2);

  if (ctx.wantsCorpse && sp.corpseRange > 0) senseCorpses(ctx);
}

/** Tìm xác tốt nhất trong tầm (nhiều năng lượng, gần). Kẻ nhìn từ trên không không thấy xác dưới tán rừng dày. */
function senseCorpses(ctx: ThinkContext): void {
  const { sim, sp } = ctx;
  const corpses = sim.corpses;
  const aerial = sp.locomotion === LOCO_AIR;
  // Ban đêm kẻ ăn xác bay không tìm được xác; loài mặt đất đánh hơi nên không phụ thuộc ánh sáng.
  const range = aerial ? sp.corpseRange * (ctx.visionRange / (sp.vision + 1)) : sp.corpseRange;
  const scratch = sim.scratch;
  const found = sim.corpseHash.query(ctx.x, ctx.y, range, scratch);
  const landBound = sp.locomotion === LOCO_LAND && !sp.canSwim;
  const world = sim.world;
  let best = 0;
  for (let k = 0; k < found; k++) {
    const c = scratch[k];
    if (corpses.alive[c] === 0) continue;
    const dx = corpses.x[c] - ctx.x;
    const dy = corpses.y[c] - ctx.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > range * range) continue;
    const cell = cellAt(corpses.x[c], corpses.y[c]);
    if (aerial && world.terrain.canopy[cell] > 0.6 && d2 > 400) continue;
    const depth = world.depthAt(cell);
    if (sp.locomotion !== LOCO_WATER && depth > WADE_DEPTH) continue;
    if (landBound && world.terrain.landRegion[cell] !== sim.animals.region[ctx.i]) continue;
    // Mẩu xác quá nhỏ không đáng công đi tới (trừ khi nó ở ngay cạnh).
    if (corpses.energy[c] < 0.03 * ctx.capacity && d2 > 900) continue;
    const value = Math.min(corpses.energy[c], ctx.capacity) / (Math.sqrt(d2) + 30);
    if (value > best) {
      best = value;
      ctx.corpse = c;
      ctx.corpseDist = Math.sqrt(d2);
    }
  }
}
