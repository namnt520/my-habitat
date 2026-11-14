import { goTo } from '../../sim/actions';
import type { ThinkContext } from '../../sim/context';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';

/** Khe của mẹ nếu mẹ còn sống, ngược lại −1. */
function motherOf(ctx: ThinkContext): number {
  const a = ctx.sim.animals;
  const mother = a.motherSlot[ctx.i];
  return mother >= 0 && a.alive[mother] === 1 && a.id[mother] === a.motherId[ctx.i] ? mother : -1;
}

/**
 * Con non theo mẹ cho tới tuổi cai sữa. Việc truyền năng lượng (bú) nằm trong `sim/physiology.ts`;
 * module này chỉ giữ con ở trong tầm bú. Mẹ chết thì con phải tự lo — và thường không qua khỏi.
 */
export const nurse: BehaviorModule<null> = {
  name: 'nurse',
  description: 'Con non bám theo mẹ để được nuôi tới khi cai sữa',
  configure() {
    return null;
  },
  score(ctx) {
    if (ctx.sim.animals.age[ctx.i] >= ctx.sp.weanAge) return 0;
    const mother = motherOf(ctx);
    if (mother < 0) return 0;
    const a = ctx.sim.animals;
    const dx = a.x[mother] - ctx.x;
    const dy = a.y[mother] - ctx.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 26 * 26) return 0.85;
    return ctx.energyFrac < 0.6 && d2 > 10 * 10 ? 0.7 : 0;
  },
  apply(ctx) {
    const a = ctx.sim.animals;
    const mother = motherOf(ctx);
    if (mother >= 0) goTo(ctx.sim, ctx.i, a.x[mother], a.y[mother], ctx.run * 0.9, State.FOLLOW);
  },
};
