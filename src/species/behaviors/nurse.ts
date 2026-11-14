import { goTo } from '../../sim/actions';
import { feedOn } from './shared';
import type { ThinkContext } from '../../sim/context';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';

/** Khe của mẹ nếu mẹ còn sống, ngược lại −1. */
function motherOf(ctx: ThinkContext): number {
  const a = ctx.sim.animals;
  const mother = a.motherSlot[ctx.i];
  return mother >= 0 && a.alive[mother] === 1 && a.id[mother] === a.motherId[ctx.i] ? mother : -1;
}

/** Xác mà mẹ đang ăn (nếu có và còn hợp lệ), ngược lại −1. */
function motherMeal(ctx: ThinkContext, mother: number): number {
  const a = ctx.sim.animals;
  if (a.state[mother] !== State.EAT) return -1;
  const corpse = a.target[mother];
  const corpses = ctx.sim.corpses;
  return corpse >= 0 && corpses.alive[corpse] === 1 && corpses.id[corpse] === a.targetId[mother]
    ? corpse
    : -1;
}

/**
 * Con non theo mẹ cho tới tuổi cai sữa. Việc truyền năng lượng (bú) nằm trong `sim/physiology.ts`;
 * module này giữ con ở trong tầm bú, và khi mẹ đang ăn một con mồi thì con cũng xúm vào ăn chung
 * (mẹ tha mồi về cho con). Mẹ chết thì con phải tự lo — và thường không qua khỏi.
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
    if (ctx.sp.meatAssimilation > 0 && ctx.energyFrac < 0.9 && motherMeal(ctx, mother) >= 0) return 0.95;
    if (d2 > 26 * 26) return 0.85;
    return ctx.energyFrac < 0.6 && d2 > 10 * 10 ? 0.7 : 0;
  },
  apply(ctx) {
    const a = ctx.sim.animals;
    const mother = motherOf(ctx);
    if (mother < 0) return;
    const meal = ctx.sp.meatAssimilation > 0 && ctx.energyFrac < 0.9 ? motherMeal(ctx, mother) : -1;
    if (meal >= 0) feedOn(ctx, meal);
    else goTo(ctx.sim, ctx.i, a.x[mother], a.y[mother], ctx.run * 0.9, State.FOLLOW);
  },
};
