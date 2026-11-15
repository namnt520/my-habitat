import { FISH_MIN_DEPTH } from '../../sim/constants';
import { goTo, halt, passable } from '../../sim/actions';
import type { ThinkContext } from '../../sim/context';
import { State } from '../../sim/entities';
import { isReadyToMate, mate as performMating } from '../../sim/reproduction';
import { cellAt } from '../../sim/terrain';
import type { BehaviorModule } from '../runtime';
import { LOCO_LAND } from '../runtime';
import { cellCenterX, cellCenterY } from './shared';

/** Loài có ít hơn ngần này cá thể thì duyệt thẳng danh sách loài thay vì hỏi spatial hash với bán kính lớn. */
const SCAN_LIST_BELOW = 400;

/** Tìm bạn tình ngoài tầm nhìn nhưng trong tầm "tín hiệu" (tiếng gọi, mùi) của loài. */
function findDistantMate(ctx: ThinkContext): number {
  const { sim, i, sp } = ctx;
  const a = sim.animals;
  const range2 = sp.mateRange * sp.mateRange;
  const sex = a.sex[i];
  const lineage = a.lineage[i];
  const landBound = sp.locomotion === LOCO_LAND && !sp.canSwim;
  const region = a.region[i];
  let best = -1;
  let best2 = range2;
  const consider = (j: number): void => {
    if (
      j === i ||
      a.alive[j] === 0 ||
      a.species[j] !== sp.index ||
      a.sex[j] === sex ||
      a.lineage[j] !== lineage
    )
      return;
    const dx = a.x[j] - ctx.x;
    const dy = a.y[j] - ctx.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= best2) return;
    if (landBound && a.region[j] !== region) return;
    if (!isReadyToMate(sim, j)) return;
    best2 = d2;
    best = j;
  };
  const members = sim.members;
  const from = members.start[sp.index];
  const to = members.start[sp.index + 1];
  if (to - from < SCAN_LIST_BELOW) {
    for (let k = from; k < to; k++) consider(members.items[k]);
  } else {
    const found = sim.hash.query(ctx.x, ctx.y, sp.mateRange, sim.scratch);
    for (let k = 0; k < found; k++) consider(sim.scratch[k]);
  }
  return best;
}

/**
 * Tìm bạn đời và giao phối. Chỉ cá thể cùng phân loài mới ghép đôi được.
 * Loài đẻ trứng (ếch, cá) phải ở trong nước mới đẻ.
 */
export const mate: BehaviorModule<null> = {
  name: 'mate',
  description: 'Tìm bạn đời cùng phân loài, giao phối; loài đẻ trứng thì đẻ dưới nước',
  configure() {
    return null;
  },
  score(ctx) {
    if (!ctx.wantsMate || !isReadyToMate(ctx.sim, ctx.i)) return 0;
    return ctx.mate >= 0 ? 0.62 : 0.5;
  },
  apply(ctx) {
    const { sim, i, sp } = ctx;
    const a = sim.animals;
    const world = sim.world;

    // Loài đẻ trứng đang ở trên cạn: xuống nước trước đã.
    if (sp.spawns && ctx.depth < FISH_MIN_DEPTH) {
      const next = world.waterNext[ctx.cell];
      if (next >= 0) goTo(sim, i, cellCenterX(next), cellCenterY(next), ctx.walk * 1.5, State.MATE);
      else halt(sim, i, State.MATE);
      return;
    }

    let partner = ctx.mate;
    if (partner < 0 && sp.mateRange > ctx.visionRange) partner = findDistantMate(ctx);
    if (partner >= 0) {
      const dx = a.x[partner] - ctx.x;
      const dy = a.y[partner] - ctx.y;
      const close = sp.reach + 4;
      if (dx * dx + dy * dy <= close * close) {
        const female = a.sex[i] === 0 ? i : partner;
        const male = a.sex[i] === 0 ? partner : i;
        if (!sp.spawns || world.depthAt(cellAt(a.x[female], a.y[female])) >= FISH_MIN_DEPTH) {
          performMating(sim, female, male);
        }
        halt(sim, i, State.MATE);
      } else {
        goTo(sim, i, a.x[partner], a.y[partner], ctx.walk * 1.6, State.MATE);
      }
      return;
    }

    // Chưa thấy ai: đi rộng ra để tìm.
    if (a.state[i] === State.MATE && a.stateTime[i] < 120 && a.speed[i] > 0) return;
    const rng = sim.rng;
    for (let attempt = 0; attempt < 3; attempt++) {
      const tx = ctx.x + (rng.next() - 0.5) * 2 * sp.mateRange;
      const ty = ctx.y + (rng.next() - 0.5) * 2 * sp.mateRange;
      if (tx < 1 || ty < 1 || tx > 1999 || ty > 1999 || !passable(sim, sp, cellAt(tx, ty))) continue;
      goTo(sim, i, tx, ty, ctx.walk * 1.2, State.MATE);
      a.stateTime[i] = 0;
      return;
    }
    halt(sim, i, State.MATE);
  },
};
