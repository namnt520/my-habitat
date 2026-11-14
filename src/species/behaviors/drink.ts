import { CELL_SIZE } from '../../sim/constants';
import { goTo, halt } from '../../sim/actions';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';
import { cellCenterX, cellCenterY } from './shared';

/** Lượng nước uống được mỗi lượt suy nghĩ (tỉ lệ nước cơ thể). */
const DRINK_RATE = 0.3;

/**
 * Tìm nước và uống. Đường tới nước lấy từ trường `waterNext` của thế giới (được tính lại khi mực nước đổi),
 * nên khi hạn hán động vật phải đi xa hơn và dồn về những vũng nước còn lại.
 */
export const drink: BehaviorModule<null> = {
  name: 'drink',
  description: 'Khi khát thì đi tới nguồn nước gần nhất và uống',
  configure() {
    return null;
  },
  score(ctx) {
    if (!ctx.sim.params.thirst || ctx.sp.thirst === 0) return 0;
    const a = ctx.sim.animals;
    const thirst = 1 - a.water[ctx.i];
    const distance = ctx.sim.world.waterDistance[ctx.cell];
    if (distance > 1 && ctx.sim.world.waterNext[ctx.cell] < 0) return 0; // không có đường tới nước (bản đồ không có nước)
    // Đã tới nơi thì uống cho đã (ngưỡng phải lớn hơn lượng nước mất giữa hai lượt, nếu không sẽ uống mãi không thôi).
    if (a.state[ctx.i] === State.DRINK && thirst > 0.3 && distance <= 1) return 0.9;
    // Cơn khát "dự kiến lúc tới nơi": ở càng xa nước thì phải lên đường càng sớm.
    const travelTicks = (distance * CELL_SIZE) / (ctx.walk * 1.5 + 0.01);
    const need = thirst + ctx.sp.thirst * travelTicks;
    if (need < 0.55) return 0;
    // Điểm vừa phải để cơn đói vẫn thắng khi chưa khát thật; chỉ khi sắp chết khát mới lấn át mọi thứ.
    return Math.min(1.3, 0.35 + need - 0.55) + (thirst > 0.8 ? (thirst - 0.8) * 16 : 0);
  },
  apply(ctx) {
    const { sim, i } = ctx;
    const a = sim.animals;
    const world = sim.world;
    if (world.waterDistance[ctx.cell] <= 1) {
      a.water[i] = Math.min(1, a.water[i] + DRINK_RATE);
      halt(sim, i, State.DRINK);
      return;
    }
    // Nhìn trước hai ô trên đường tới nước để bước đi mượt hơn.
    let next = world.waterNext[ctx.cell];
    if (next < 0) {
      halt(sim, i, State.IDLE);
      return;
    }
    const further = world.waterNext[next];
    if (further >= 0 && world.waterDistance[next] > 1) next = further;
    const urgent = a.water[i] < 0.2;
    goTo(sim, i, cellCenterX(next), cellCenterY(next), urgent ? ctx.run * 0.8 : ctx.walk * 1.5, State.DRINK);
  },
};
