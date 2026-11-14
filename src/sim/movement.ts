/**
 * Di chuyển mỗi tick: tiến về đích với tốc độ đã chọn, tôn trọng địa hình; xử lý truy đuổi và ra đòn.
 */
import { HILL_LEVEL, MAX_GENES, MOUNTAIN_LEVEL, WADE_DEPTH, WORLD_SIZE } from './constants';
import { passable, strike } from './actions';
import { FLAG_ARRIVED, FLAG_BLOCKED, State } from './entities';
import type { Simulation } from './simulation';
import { cellAt } from './terrain';
import { LOCO_AIR, LOCO_AMPHIBIOUS, LOCO_LAND, type SpeciesRuntime } from '../species/runtime';

/** Số tick tối đa kẻ săn "đón đầu" theo vận tốc con mồi. */
const LEAD_TICKS = 14;
/** Khoảng cách lệch ngang tối đa khi thành viên bầy toả ra bọc sườn (u). */
const FLANK_DISTANCE = 28;

/** Hệ số tốc độ theo địa hình tại ô. */
function terrainSpeed(sim: Simulation, sp: SpeciesRuntime, cell: number, slot: number): number {
  if (sp.locomotion === LOCO_AIR) return 1;
  const elevation = sim.world.terrain.elevation[cell];
  const depth = sim.world.climate.waterLevel - elevation;
  if (sp.locomotion === LOCO_LAND) {
    if (depth > WADE_DEPTH) return 0.45; // bơi
    if (depth > 0) return 0.65; // lội
    if (elevation > HILL_LEVEL) return 1 - 0.3 * ((elevation - HILL_LEVEL) / (MOUNTAIN_LEVEL - HILL_LEVEL));
    return 1;
  }
  if (sp.locomotion === LOCO_AMPHIBIOUS && sp.gAquatic >= 0) {
    const aquatic = sim.animals.phenotype[slot * MAX_GENES + sp.gAquatic];
    return depth > 0 ? 0.7 + 0.6 * aquatic : 1.3 - 0.6 * aquatic;
  }
  return 1;
}

/** Tiến một tick. Có thể giết con mồi (hoặc chính kẻ săn chết vì phản đòn). */
export function moveAnimal(sim: Simulation, i: number): void {
  const a = sim.animals;
  const sp = sim.registry.animals[a.species[i]];
  let targetX = a.targetX[i];
  let targetY = a.targetY[i];

  if (a.state[i] === State.HUNT || a.state[i] === State.STALK) {
    const prey = a.target[i];
    if (prey < 0 || a.alive[prey] === 0 || a.id[prey] !== a.targetId[i]) {
      a.target[i] = -1;
      a.state[i] = State.IDLE;
      a.stateTime[i] = 0;
      a.speed[i] = 0;
    } else {
      const dx = a.x[prey] - a.x[i];
      const dy = a.y[prey] - a.y[i];
      const d2 = dx * dx + dy * dy;
      if (a.strikeCooldown[i] > 0) a.strikeCooldown[i] -= 1;
      if (d2 < sp.reach * sp.reach) {
        if (a.strikeCooldown[i] <= 0) {
          strike(sim, i, prey);
          if (a.alive[i] === 0) return;
        }
        targetX = a.x[i];
        targetY = a.y[i];
      } else {
        // Đón đầu: nhắm vào vị trí con mồi sẽ tới, không phải vị trí hiện tại.
        const distance = Math.sqrt(d2);
        const speed = a.speed[i] > 0.1 ? a.speed[i] : 0.1;
        const lead = Math.min(LEAD_TICKS, distance / speed);
        targetX = a.x[prey] + a.vx[prey] * lead;
        targetY = a.y[prey] + a.vy[prey] * lead;
        if (a.group[i] >= 0 && distance > 15) {
          // Bọc sườn: mỗi thành viên bầy lệch sang một bên khác nhau so với hướng chạy của con mồi.
          const side = (a.id[i] % 3) - 1;
          if (side !== 0) {
            const pvx = a.vx[prey];
            const pvy = a.vy[prey];
            const pv = Math.sqrt(pvx * pvx + pvy * pvy);
            if (pv > 0.05) {
              const offset = side * Math.min(FLANK_DISTANCE, distance * 0.4);
              targetX += (-pvy / pv) * offset;
              targetY += (pvx / pv) * offset;
            }
          }
        }
      }
      a.targetX[i] = targetX;
      a.targetY[i] = targetY;
    }
  }

  const speed = a.speed[i];
  if (speed <= 0) {
    a.vx[i] = 0;
    a.vy[i] = 0;
    return;
  }
  const x = a.x[i];
  const y = a.y[i];
  const dx = targetX - x;
  const dy = targetY - y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 0.36) {
    a.vx[i] = 0;
    a.vy[i] = 0;
    a.flags[i] |= FLAG_ARRIVED;
    return;
  }
  const distance = Math.sqrt(d2);
  const cell = cellAt(x, y);
  let step = speed * terrainSpeed(sim, sp, cell, i);
  if (step > distance) step = distance;
  const ux = dx / distance;
  const uy = dy / distance;
  let nx = x + ux * step;
  let ny = y + uy * step;
  if (nx < 1) nx = 1;
  else if (nx > WORLD_SIZE - 1) nx = WORLD_SIZE - 1;
  if (ny < 1) ny = 1;
  else if (ny > WORLD_SIZE - 1) ny = WORLD_SIZE - 1;

  if (sp.locomotion !== LOCO_AIR) {
    const nextCell = cellAt(nx, ny);
    // Nếu đang đứng ở ô không hợp lệ (lũ dâng, hồ cạn) thì cho đi tự do để thoát ra.
    if (nextCell !== cell && !passable(sim, sp, nextCell) && passable(sim, sp, cell)) {
      // Trượt dọc theo vật cản: thử chỉ đi theo x, rồi chỉ theo y.
      const slideX = cellAt(nx, y);
      const slideY = cellAt(x, ny);
      if (slideX === cell || passable(sim, sp, slideX)) {
        ny = y;
      } else if (slideY === cell || passable(sim, sp, slideY)) {
        nx = x;
      } else {
        a.vx[i] = 0;
        a.vy[i] = 0;
        a.flags[i] |= FLAG_BLOCKED;
        return;
      }
      a.flags[i] |= FLAG_BLOCKED;
    }
  }

  a.vx[i] = nx - x;
  a.vy[i] = ny - y;
  a.x[i] = nx;
  a.y[i] = ny;
  a.headingX[i] = ux;
  a.headingY[i] = uy;
}
