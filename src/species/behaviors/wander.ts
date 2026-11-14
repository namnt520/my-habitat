import { WORLD_SIZE } from '../../sim/constants';
import { goTo, halt, passable } from '../../sim/actions';
import { FLAG_ARRIVED, FLAG_BLOCKED, State } from '../../sim/entities';
import { cellAt } from '../../sim/terrain';
import type { BehaviorModule } from '../runtime';
import { LOCO_LAND } from '../runtime';
import { bool, cellCenterX, cellCenterY, num } from './shared';

interface WanderParams {
  /** Độ dài mỗi chặng (u). */
  range: number;
  /** Bán kính vùng sống quanh "nhà"; 0 = du cư. */
  homeRange: number;
  /** Đi cùng hướng với đồng loại nhìn thấy (đàn/bầy di chuyển thành khối). */
  followKin: boolean;
  /** Có lãnh thổ: tránh đồng loại cùng giới ở gần hơn `spacing`. */
  spacing: number;
  /** Không rời xa nước quá ngần này ô (0 = không ràng buộc). */
  nearWater: number;
}

/**
 * Lang thang: hành vi mặc định khi không có nhu cầu nào cấp bách. Các ràng buộc (vùng sống, lãnh thổ,
 * bám nước, đi theo đàn) là tham số dữ liệu của loài.
 *
 * Tính lãnh thổ làm kẻ săn rải đều ra thay vì dồn về một chỗ — một cơ chế tự điều hoà mật độ có thật.
 */
export const wander: BehaviorModule<WanderParams> = {
  name: 'wander',
  description: 'Đi lang thang trong vùng sống; giữ lãnh thổ; đi theo đàn',
  configure(raw, species) {
    const spacing = num(raw, 'spacing', 0);
    if (spacing > 0) species.territorial = true;
    if (bool(raw, 'followKin', false)) species.social = true;
    return {
      range: num(raw, 'range', 80),
      homeRange: num(raw, 'homeRange', 0),
      followKin: bool(raw, 'followKin', false),
      spacing,
      nearWater: num(raw, 'nearWater', 0),
    };
  },
  score(ctx, p) {
    if (p.spacing > 0 && ctx.rival >= 0 && ctx.rivalDist < p.spacing) return 0.36;
    return 0.1;
  },
  apply(ctx, p) {
    const { sim, i, sp } = ctx;
    const a = sim.animals;
    const world = sim.world;
    const crowded = p.spacing > 0 && ctx.rival >= 0 && ctx.rivalDist < p.spacing;
    // Đói mà quanh đây không có gì ăn (nếu có thì module kiếm ăn/săn đã thắng): bỏ vùng quen, đi xa tìm nơi khác.
    const searching = ctx.energyFrac < 0.45;
    if (
      a.state[i] === State.WANDER &&
      a.behavior[i] === ctx.behaviorIndex &&
      (a.flags[i] & (FLAG_ARRIVED | FLAG_BLOCKED)) === 0 &&
      a.stateTime[i] < 200 &&
      !crowded
    ) {
      a.speed[i] = ctx.walk * (searching ? 1.4 : 0.8);
      return;
    }

    const rng = sim.rng;
    // Hướng thiên lệch (nếu có): về nhà, tránh đối thủ, bám nước, theo đàn.
    let biasX = 0;
    let biasY = 0;
    if (crowded) {
      biasX = ctx.x - a.x[ctx.rival];
      biasY = ctx.y - a.y[ctx.rival];
      // Con trẻ hơn nhường: dời "nhà" ra xa một chút, nhờ đó các lãnh thổ tự giãn ra.
      if (a.age[i] < a.age[ctx.rival]) {
        const d = Math.sqrt(biasX * biasX + biasY * biasY) + 0.001;
        a.homeX[i] = Math.min(WORLD_SIZE - 20, Math.max(20, a.homeX[i] + (biasX / d) * 25));
        a.homeY[i] = Math.min(WORLD_SIZE - 20, Math.max(20, a.homeY[i] + (biasY / d) * 25));
      }
    } else if (p.nearWater > 0 && world.waterDistance[ctx.cell] > p.nearWater) {
      const next = world.waterNext[ctx.cell];
      if (next >= 0) {
        biasX = cellCenterX(next) - ctx.x;
        biasY = cellCenterY(next) - ctx.y;
      }
    } else if (p.homeRange > 0 && !searching) {
      const hx = a.homeX[i] - ctx.x;
      const hy = a.homeY[i] - ctx.y;
      if (hx * hx + hy * hy > p.homeRange * p.homeRange) {
        biasX = hx;
        biasY = hy;
      }
    }
    if (biasX === 0 && biasY === 0 && p.followKin && ctx.kinCount > 0) {
      biasX = ctx.kinVX;
      biasY = ctx.kinVY;
    }
    const biasLength = Math.sqrt(biasX * biasX + biasY * biasY);
    const landBound = sp.locomotion === LOCO_LAND && !sp.canSwim;

    for (let attempt = 0; attempt < 4; attempt++) {
      // Vector ngẫu nhiên trong hình tròn đơn vị (lấy mẫu loại bỏ — không cần sin/cos).
      let rx = rng.next() * 2 - 1;
      let ry = rng.next() * 2 - 1;
      const r2 = rx * rx + ry * ry;
      if (r2 > 1 || r2 < 0.01) continue;
      if (biasLength > 0.05) {
        rx = 0.6 * rx + (1.2 * biasX) / biasLength;
        ry = 0.6 * ry + (1.2 * biasY) / biasLength;
      }
      const length = Math.sqrt(rx * rx + ry * ry) + 1e-6;
      const leg = p.range * (0.5 + 0.5 * rng.next()) * (searching ? 2.5 : 1);
      const tx = ctx.x + (rx / length) * leg;
      const ty = ctx.y + (ry / length) * leg;
      if (tx < 2 || ty < 2 || tx > WORLD_SIZE - 2 || ty > WORLD_SIZE - 2) continue;
      const cell = cellAt(tx, ty);
      if (!passable(sim, sp, cell)) continue;
      if (landBound && world.terrain.landRegion[cell] !== a.region[i]) continue;
      goTo(sim, i, tx, ty, ctx.walk * (searching ? 1.4 : 0.8), State.WANDER);
      a.stateTime[i] = 0;
      return;
    }
    halt(sim, i, State.IDLE);
  },
};
