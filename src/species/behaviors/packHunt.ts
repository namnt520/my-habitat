import { halt } from '../../sim/actions';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';
import { isPursuing, pursue, registerPrey, stillInSight, trackPrey } from './hunt';
import { feedOn, huntTargetValid, isFeeding, num } from './shared';

interface PackHuntParams {
  /** Bầy chỉ tấn công khi tổng (khối lượng × máu) của bầy ≥ hệ số này × (khối lượng × máu) của con mồi. */
  strength: number;
  /** Thành viên trong khoảng cách này tới con mồi sẽ nhập cuộc (u). */
  joinRange: number;
  chaseTicks: number;
  restTicks: number;
  huntBelow: number;
  pounceRange: number;
  stalkTicks: number;
  /** Tầm đánh hơi mồi lớn ngoài tầm nhìn (u). */
  trackRange: number;
}

/**
 * Săn theo bầy (sói): một con phát hiện mồi lớn và đánh giá sức mạnh của bầy quanh nó; nếu đủ, nó đặt
 * mục tiêu chung cho bầy và các thành viên gần đó cùng lao vào, toả ra bọc sườn (xem `movement.ts`).
 *
 * Vì mồi lớn phản đòn và mỗi cú cắn chỉ gây một phần sát thương, một con sói đơn độc sẽ thua hươu trưởng
 * thành; cả bầy thì chia nhau sát thương và hạ được. "Phối hợp" vì thế là điều kiện sống còn, không phải trang trí.
 */
export const packHunt: BehaviorModule<PackHuntParams> = {
  name: 'packHunt',
  description: 'Săn mồi lớn theo bầy: mục tiêu chung, bọc sườn, chia sát thương',
  configure(raw, species, lookup) {
    registerPrey(raw, species, lookup);
    species.usesGroups = true;
    return {
      strength: num(raw, 'strength', 0.9),
      joinRange: num(raw, 'joinRange', 260),
      chaseTicks: num(raw, 'chaseTicks', 180),
      restTicks: num(raw, 'restTicks', 90),
      huntBelow: num(raw, 'huntBelow', 0.7),
      pounceRange: num(raw, 'pounceRange', 45),
      stalkTicks: num(raw, 'stalkTicks', 260),
      trackRange: num(raw, 'trackRange', 0),
    };
  },
  score(ctx, p) {
    const { sim, i } = ctx;
    const a = sim.animals;
    if (isFeeding(ctx)) return ctx.energyFrac < 0.98 ? 1.1 : 0;
    if (isPursuing(ctx)) {
      const limit = a.state[i] === State.HUNT ? p.chaseTicks : p.stalkTicks;
      if (huntTargetValid(sim, i) && a.stateTime[i] < limit && a.health[i] > 0.4 && stillInSight(ctx))
        return 0.95;
      a.huntCooldown[i] = p.restTicks;
      return 0;
    }
    if (ctx.energyFrac >= p.huntBelow || a.huntCooldown[i] > 0 || a.health[i] < 0.6) return 0;

    // Nhập cuộc săn đang diễn ra của bầy.
    const group = a.group[i];
    if (group >= 0) {
      const prey = sim.groups.huntTarget(group, sim.tick, p.chaseTicks);
      if (prey >= 0) {
        const dx = a.x[prey] - ctx.x;
        const dy = a.y[prey] - ctx.y;
        if (dx * dx + dy * dy < p.joinRange * p.joinRange) {
          ctx.largePrey = prey;
          return 0.9;
        }
      }
    }
    // Khởi xướng: chỉ khi sức mạnh bầy quanh đây áp đảo con mồi. Không thấy mồi thì đánh hơi.
    if (ctx.largePrey < 0 && p.trackRange > 0 && ctx.energyFrac < 0.55)
      ctx.largePrey = trackPrey(ctx, p.trackRange, true);
    if (ctx.largePrey < 0) return 0;
    const prey = ctx.largePrey;
    const preyPower = a.structure[prey] * a.health[prey];
    const packPower = ctx.groupPower + ctx.mass * a.health[i];
    if (packPower < p.strength * preyPower) return 0;
    return 0.5 + 0.45 * (1 - ctx.energyFrac);
  },
  apply(ctx, p) {
    const { sim, i } = ctx;
    const a = sim.animals;
    if (isFeeding(ctx)) {
      feedOn(ctx, a.target[i]);
      return;
    }
    if (!isPursuing(ctx)) {
      const prey = ctx.largePrey;
      if (prey < 0 || a.alive[prey] === 0) {
        halt(sim, i, State.IDLE);
        return;
      }
      a.target[i] = prey;
      a.targetId[i] = a.id[prey];
      a.targetX[i] = a.x[prey];
      a.targetY[i] = a.y[prey];
      a.state[i] = State.STALK;
      a.stateTime[i] = 0;
      if (a.group[i] >= 0) sim.groups.setHuntTarget(a.group[i], prey, a.id[prey], sim.tick);
    }
    pursue(ctx, p.pounceRange);
  },
};
