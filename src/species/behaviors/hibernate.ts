import { halt } from '../../sim/actions';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';
import { num } from './shared';

interface HibernateParams {
  /** Nhiệt độ trung bình ngày xuống dưới mức này thì đi ngủ đông, lên trên `wake` thì thức dậy (°C). */
  below: number;
  wake: number;
}

/**
 * Ngủ đông: khi trời lạnh, con vật nằm im trong hang/dưới bùn, chuyển hoá giảm còn một phần nhỏ và sống
 * bằng mỡ tích từ mùa thu. Dùng chung cho gấu và ếch — chỉ khác ngưỡng nhiệt trong dữ liệu loài.
 */
export const hibernate: BehaviorModule<HibernateParams> = {
  name: 'hibernate',
  description: 'Ngủ đông khi lạnh, sống bằng mỡ dự trữ',
  configure(raw) {
    const below = num(raw, 'below', 3);
    return { below, wake: num(raw, 'wake', below + 2) };
  },
  score(ctx, p) {
    const temperature = ctx.sim.world.climate.temperatureDaily;
    if (ctx.sim.animals.state[ctx.i] === State.HIBERNATE) return temperature < p.wake ? 3 : 0;
    return temperature < p.below ? 3 : 0;
  },
  apply(ctx) {
    halt(ctx.sim, ctx.i, State.HIBERNATE);
  },
};
