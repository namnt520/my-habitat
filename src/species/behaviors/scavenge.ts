import { halt } from '../../sim/actions';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';
import { feedOn, isFeeding, num } from './shared';

/**
 * Ăn xác: tìm xác trong tầm (kền kền nhìn từ trên cao nên tầm rất xa, nhưng không thấy xác dưới tán rừng dày;
 * thú mặt đất đánh hơi tầm gần hơn nhưng không bị rừng che) rồi tới ăn.
 */
export const scavenge: BehaviorModule<null> = {
  name: 'scavenge',
  description: 'Tìm và ăn xác chết',
  configure(raw, species) {
    species.corpseRange = num(raw, 'range', 100);
    species.scavenges = true;
    return null;
  },
  score(ctx) {
    if (isFeeding(ctx)) return ctx.energyFrac < 0.98 ? 1.1 : 0;
    if (ctx.corpse < 0) return 0;
    return 0.45 + 0.5 * (1 - ctx.energyFrac);
  },
  apply(ctx) {
    const a = ctx.sim.animals;
    if (isFeeding(ctx)) {
      feedOn(ctx, a.target[ctx.i]);
    } else if (ctx.corpse >= 0) {
      feedOn(ctx, ctx.corpse);
    } else {
      halt(ctx.sim, ctx.i, State.IDLE);
    }
  },
};
