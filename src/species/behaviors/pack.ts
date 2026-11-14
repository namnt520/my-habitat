import { MAX_GENES } from '../../sim/constants';
import { goTo } from '../../sim/actions';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';
import { feedOn, isFeeding, num } from './shared';

interface PackParams {
  gene: number;
  /** Xa tâm bầy hơn mức này thì quay về (u). */
  range: number;
}

/**
 * Gắn bó với bầy (sói): bầy là một nhóm có danh tính (mã bầy), có lãnh thổ quanh tâm bầy.
 * Việc tách bầy, lập bầy mới nằm trong `sim/groups.ts`; module này giữ thành viên ở gần nhau và
 * gọi cả bầy tới ăn chung con mồi vừa hạ (kể cả những con không tham gia cuộc săn).
 */
export const pack: BehaviorModule<PackParams> = {
  name: 'pack',
  description: 'Giữ thành viên ở gần tâm bầy',
  configure(raw, species) {
    species.usesGroups = true;
    const geneName = raw.gene;
    const gene =
      typeof geneName === 'string' ? species.genes.findIndex((spec) => spec.name === geneName) : -1;
    if (typeof geneName === 'string' && gene < 0)
      throw new Error(`pack: loài ${species.key} không có gen "${geneName}"`);
    species.packMax = num(raw, 'maxSize', 8);
    species.packBreeders = num(raw, 'breeders', 1);
    species.gSocial = gene;
    return { gene, range: num(raw, 'range', 90) };
  },
  score(ctx, p) {
    const { sim, i } = ctx;
    const group = sim.animals.group[i];
    if (group < 0 || sim.groups.size[group] < 2) return 0;
    if (ctx.energyFrac < 0.85 && !isFeeding(ctx) && sim.groups.sharedKill(sim, group) >= 0) return 0.9;
    // Con đói được phép rời bầy đi lùng mồi; hạ được mồi thì cả bầy sẽ kéo tới (xem trên).
    if (ctx.energyFrac < 0.45) return 0;
    const dx = sim.groups.centerX[group] - ctx.x;
    const dy = sim.groups.centerY[group] - ctx.y;
    if (dx * dx + dy * dy < p.range * p.range) return 0;
    const affinity = p.gene >= 0 ? sim.animals.phenotype[i * MAX_GENES + p.gene] : 0.5;
    return 0.25 + 0.35 * affinity;
  },
  apply(ctx) {
    const groups = ctx.sim.groups;
    const group = ctx.sim.animals.group[ctx.i];
    const kill = ctx.energyFrac < 0.85 ? groups.sharedKill(ctx.sim, group) : -1;
    if (kill >= 0) {
      feedOn(ctx, kill);
      return;
    }
    goTo(ctx.sim, ctx.i, groups.centerX[group], groups.centerY[group], ctx.walk * 1.6, State.WANDER);
  },
};
