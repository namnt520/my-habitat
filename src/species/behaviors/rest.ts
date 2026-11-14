import { halt } from '../../sim/actions';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';

/**
 * Nghỉ ngơi: loài ngày ngủ ban đêm, loài đêm ngủ giữa trưa; no căng bụng thì nằm tiêu hoá.
 * Nghỉ giảm chuyển hoá cơ bản, nhưng con vật đứng im cũng kém cảnh giác hơn.
 */
export const rest: BehaviorModule<null> = {
  name: 'rest',
  description: 'Ngủ theo chu kỳ ngày/đêm; nghỉ khi no',
  configure() {
    return null;
  },
  score(ctx) {
    // Đói cồn cào thì không ngủ: nếu quanh đây không có gì ăn, module lang thang sẽ đưa con vật đi tìm.
    if (ctx.energyFrac < 0.35) return 0;
    const daylight = ctx.sim.world.climate.daylight;
    if (!ctx.nightActive && daylight < 0.12) return 0.5;
    if (ctx.nightActive && daylight > 0.8) return 0.42;
    return ctx.energyFrac > 0.93 ? 0.3 : 0;
  },
  apply(ctx) {
    halt(ctx.sim, ctx.i, State.REST);
  },
};
