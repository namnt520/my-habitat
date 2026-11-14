import { CELLS, GRID } from '../../sim/constants';
import { goTo, passable } from '../../sim/actions';
import type { ThinkContext } from '../../sim/context';
import { FLAG_SAW_THREAT, State } from '../../sim/entities';
import { cellAt } from '../../sim/terrain';
import type { BehaviorModule } from '../runtime';
import { cellCenterX, cellCenterY, num } from './shared';

interface FleeParams {
  /** Nơi ẩn náu ưa thích: 0 không có, 1 rừng (tán che), 2 nước. */
  refuge: number;
  /** Quãng chạy mỗi lần (u). */
  distance: number;
}

const COS45 = 0.7071067811865476;
/** Các hướng thử khi chạy trốn, tính theo góc lệch so với hướng "ra xa kẻ săn": 0°, ±45°, ±90°. */
const TURNS: readonly (readonly [number, number])[] = [
  [1, 0],
  [COS45, COS45],
  [COS45, -COS45],
  [0, 1],
  [0, -1],
];

/** Có lửa ở ô đang đứng hoặc 4 ô kề không; trả về ô cháy hoặc −1. */
function fireNearby(ctx: ThinkContext): number {
  const world = ctx.sim.world;
  if (world.burning.length === 0) return -1;
  const c = ctx.cell;
  if (world.fire[c] > 0) return c;
  if (c % GRID > 0 && world.fire[c - 1] > 0) return c - 1;
  if (c % GRID < GRID - 1 && world.fire[c + 1] > 0) return c + 1;
  if (c >= GRID && world.fire[c - GRID] > 0) return c - GRID;
  if (c + GRID < CELLS && world.fire[c + GRID] > 0) return c + GRID;
  return -1;
}

/**
 * Chạy trốn: khi thấy kẻ săn, khi đồng loại gần đó hoảng chạy (báo động lan truyền), hoặc khi có lửa.
 * Hướng chạy là hướng ra xa các mối đe doạ, được chỉnh về phía nơi ẩn náu (rừng hoặc nước) nếu loài có.
 */
export const flee: BehaviorModule<FleeParams> = {
  name: 'flee',
  description: 'Chạy trốn kẻ săn, lửa; lan truyền báo động trong đàn',
  configure(raw, species) {
    species.panicFraction = num(raw, 'panic', 0.45);
    const refuge = raw.refuge ?? 'none';
    if (refuge !== 'none' && refuge !== 'forest' && refuge !== 'water') {
      throw new Error('flee.refuge phải là "none", "forest" hoặc "water"');
    }
    return {
      refuge: refuge === 'forest' ? 1 : refuge === 'water' ? 2 : 0,
      distance: num(raw, 'distance', 60),
    };
  },
  score(ctx) {
    if (ctx.threat >= 0) return 1.3 + 1.2 * (1 - ctx.threatDist / (ctx.visionRange + 1));
    if (fireNearby(ctx) >= 0) return 1.6;
    if (ctx.alarm) return 1.0;
    // Mất dấu kẻ săn rồi vẫn chạy thêm một quãng.
    const a = ctx.sim.animals;
    if (a.state[ctx.i] === State.FLEE && a.stateTime[ctx.i] < 24) return 0.7;
    return 0;
  },
  apply(ctx, p) {
    const { sim, i, sp } = ctx;
    const a = sim.animals;
    const world = sim.world;
    let dirX = ctx.awayX;
    let dirY = ctx.awayY;
    if (ctx.threat >= 0 || fireNearby(ctx) >= 0) a.flags[i] |= FLAG_SAW_THREAT;
    else a.flags[i] &= ~FLAG_SAW_THREAT;
    if (ctx.threat < 0) {
      const fire = fireNearby(ctx);
      if (fire >= 0 && fire !== ctx.cell) {
        dirX = ctx.x - cellCenterX(fire);
        dirY = ctx.y - cellCenterY(fire);
      } else if (ctx.alarm) {
        dirX = ctx.alarmX;
        dirY = ctx.alarmY;
      } else {
        dirX = a.headingX[i];
        dirY = a.headingY[i];
      }
    }
    let length = Math.sqrt(dirX * dirX + dirY * dirY);
    if (length < 1e-6) {
      dirX = a.headingX[i];
      dirY = a.headingY[i];
      length = 1;
    }
    dirX /= length;
    dirY /= length;

    // Ếch: nhảy xuống nước nếu nước ở gần.
    if (p.refuge === 2 && ctx.depth <= 0 && world.waterDistance[ctx.cell] <= 5) {
      const next = world.waterNext[ctx.cell];
      if (next >= 0) {
        goTo(sim, i, cellCenterX(next), cellCenterY(next), ctx.run, State.FLEE);
        return;
      }
    }

    // Thử vài hướng lệch dần; chọn hướng đi được, ưu tiên nơi tán rừng dày nếu loài ẩn trong rừng.
    let bestX = ctx.x + dirX * p.distance;
    let bestY = ctx.y + dirY * p.distance;
    let bestScore = -1;
    for (let t = 0; t < TURNS.length; t++) {
      const cos = TURNS[t][0];
      const sin = TURNS[t][1];
      const tx = ctx.x + (dirX * cos - dirY * sin) * p.distance;
      const ty = ctx.y + (dirX * sin + dirY * cos) * p.distance;
      const probe = cellAt(ctx.x + (tx - ctx.x) * 0.35, ctx.y + (ty - ctx.y) * 0.35);
      if (!passable(sim, sp, probe)) continue;
      let score = cos; // càng thẳng hướng ra xa càng tốt
      if (p.refuge === 1) score += 0.8 * world.terrain.canopy[cellAt(tx, ty)];
      if (score > bestScore) {
        bestScore = score;
        bestX = tx;
        bestY = ty;
      }
    }
    goTo(sim, i, bestX, bestY, ctx.run, State.FLEE);
  },
};
