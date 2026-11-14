import { MAX_GENES } from '../../sim/constants';
import { goTo } from '../../sim/actions';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';
import { bool, num } from './shared';

interface HerdParams {
  /** Vị trí gen "tính bầy đàn" của loài (−1 nếu không có). */
  gene: number;
  /** Khoảng cách dễ chịu tới tâm đàn (u). */
  spacing: number;
}

/**
 * Bầy đàn (hươu) / đàn cá: giữ gần tâm của các đồng loại nhìn thấy. Kết hợp với cờ `alarm` (một con hoảng
 * chạy thì cả đàn chạy theo — xem module `flee`) và việc đi cùng hướng với đàn (xem `wander.followKin`).
 *
 * Gen tính bầy đàn tạo đánh đổi: bám đàn thì được nhiều mắt canh chừng, nhưng cả đàn gặm trụi một chỗ.
 */
export const herd: BehaviorModule<HerdParams> = {
  name: 'herd',
  description: 'Di chuyển và giữ khoảng cách theo đàn; báo động lan truyền',
  configure(raw, species) {
    species.alarm = bool(raw, 'alarm', true);
    species.social = true;
    const geneName = raw.gene;
    let gene = -1;
    if (typeof geneName === 'string') {
      gene = species.genes.findIndex((spec) => spec.name === geneName);
      if (gene < 0) throw new Error(`herd: loài ${species.key} không có gen "${geneName}"`);
    }
    return { gene, spacing: num(raw, 'spacing', 30) };
  },
  score(ctx, p) {
    if (ctx.kinCount === 0) return 0;
    const dx = ctx.kinX / ctx.kinCount - ctx.x;
    const dy = ctx.kinY / ctx.kinCount - ctx.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const comfort = p.spacing * (1 + 0.15 * Math.sqrt(ctx.kinCount));
    if (distance < comfort) return 0;
    const social = p.gene >= 0 ? ctx.sim.animals.phenotype[ctx.i * MAX_GENES + p.gene] : 0.5;
    return (0.2 + 0.35 * social) * Math.min(1, 0.5 + (distance - comfort) / comfort);
  },
  apply(ctx) {
    goTo(ctx.sim, ctx.i, ctx.kinX / ctx.kinCount, ctx.kinY / ctx.kinCount, ctx.walk * 1.3, State.WANDER);
  },
};
