import { CELL_SIZE, GRID } from '../../sim/constants';
import {
  FOOD_FIELDS,
  type ForageSource,
  assimilation,
  availableAt,
  consumeField,
  goTo,
  halt,
  passable,
} from '../../sim/actions';
import type { ThinkContext } from '../../sim/context';
import { State } from '../../sim/entities';
import type { BehaviorModule } from '../runtime';
import { LOCO_LAND } from '../runtime';
import type { FoodField } from '../types';
import { num } from './shared';

interface ForageParams {
  sources: ForageSource[];
  /** Bán kính tìm ô tốt hơn (số ô) và số ô thử mỗi lần. */
  searchRadius: number;
  samples: number;
}

/** Nếu chỗ đang đứng "giàu" dưới mức này thì thử tìm ô khác. */
const POOR_PATCH = 0.22;

/** Độ "giàu" của một nguồn tại một ô: tốc độ ăn tương đối × hiệu suất đồng hoá. */
function richness(ctx: ThinkContext, source: ForageSource, cell: number): number {
  const available = availableAt(ctx.sim, source, cell);
  if (available <= 0) return 0;
  const efficiency = assimilation(ctx.sim, ctx.i, ctx.sp, source.assimilation, source.plant);
  return (efficiency * available) / (available + source.halfSaturation);
}

/**
 * Kiếm ăn từ các trường mật độ (cỏ, lá cây bụi, quả, tảo, côn trùng).
 *
 * Điểm số = cơn đói × độ giàu của nguồn tốt nhất tìm được. Vì độ giàu thay đổi theo mùa (quả chỉ có
 * cuối hạ–thu), loài ăn nhiều nguồn như gấu tự đổi thức ăn theo mùa mà không cần lịch viết cứng.
 * Ăn quả làm con vật mang hạt trong ruột và thải dần dọc đường → phát tán cây bụi.
 */
export const forage: BehaviorModule<ForageParams> = {
  name: 'forage',
  description: 'Ăn từ các trường thức ăn; tự chọn nguồn giàu nhất; ăn quả thì phát tán hạt',
  configure(raw) {
    const list = raw.sources;
    if (!Array.isArray(list) || list.length === 0) throw new Error('forage.sources phải là mảng không rỗng');
    const sources = list.map((entry: Record<string, unknown>): ForageSource => {
      const field = entry.field as FoodField;
      if (!FOOD_FIELDS.includes(field))
        throw new Error(`forage: trường "${String(entry.field)}" không tồn tại`);
      return {
        field,
        fieldIndex: FOOD_FIELDS.indexOf(field),
        assimilation: num(entry, 'assimilation', 0.5),
        floor: num(entry, 'floor', 0),
        halfSaturation: num(entry, 'halfSaturation', 50),
        water: num(entry, 'water', 0),
        plant: field !== 'insects',
      };
    });
    return { sources, searchRadius: num(raw, 'searchRadius', 4), samples: num(raw, 'samples', 4) };
  },
  score(ctx, p) {
    if (ctx.energyFrac > 0.97) return 0;
    const { sim, sp } = ctx;
    let bestHere = 0;
    let bestSource = 0;
    for (let s = 0; s < p.sources.length; s++) {
      const rich = richness(ctx, p.sources[s], ctx.cell);
      if (rich > bestHere) {
        bestHere = rich;
        bestSource = s;
      }
    }
    ctx.forageSource = bestSource;
    ctx.forageHere = true;
    ctx.forageCell = ctx.cell;
    let best = bestHere;

    if (bestHere < POOR_PATCH) {
      // Chỗ này nghèo: thử vài ô ngẫu nhiên quanh đây, đi tới ô đáng công nhất.
      const rng = sim.rng;
      const cx = ctx.cell % GRID;
      const cy = (ctx.cell / GRID) | 0;
      const landBound = sp.locomotion === LOCO_LAND && !sp.canSwim;
      const region = sim.animals.region[ctx.i];
      let bestElsewhere = 0;
      // Vòng 1 thử các ô gần. Nếu quanh đây đều nghèo, vòng 2 thử thêm vài ô ở xa gấp ba —
      // nhờ đó thú ăn cỏ rời hẳn vùng đã bị gặm trụi (di cư theo thức ăn) thay vì đứng chết đói tại chỗ.
      for (let round = 0; round < 2; round++) {
        const reach = round === 0 ? p.searchRadius : p.searchRadius * 3;
        const tries = round === 0 ? p.samples : 3;
        const span = 2 * reach + 1;
        for (let k = 0; k < tries; k++) {
          const nx = cx + rng.int(span) - reach;
          const ny = cy + rng.int(span) - reach;
          if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
          const cell = ny * GRID + nx;
          if (cell === ctx.cell || !passable(sim, sp, cell)) continue;
          if (landBound && sim.world.terrain.landRegion[cell] !== region) continue;
          const steps = Math.max(Math.abs(nx - cx), Math.abs(ny - cy));
          for (let s = 0; s < p.sources.length; s++) {
            const rich = richness(ctx, p.sources[s], cell) / (1 + 0.06 * steps);
            if (rich > bestElsewhere) {
              bestElsewhere = rich;
              ctx.forageCell = cell;
              if (rich > 1.4 * bestHere + 0.02) bestSource = s;
            }
          }
        }
        if (bestElsewhere >= 0.1) break;
      }
      if (bestElsewhere > 1.4 * bestHere + 0.02) {
        ctx.forageHere = false;
        ctx.forageSource = bestSource;
        best = bestElsewhere;
      } else {
        ctx.forageCell = ctx.cell;
        // Không có gì quanh đây: để module lang thang đưa đi nơi khác.
        if (bestHere < 0.01) return 0;
      }
    }
    const hunger = 1 - ctx.energyFrac;
    // Sắp chết đói thì ăn trước mọi việc khác (kể cả đang trên đường đi uống nước).
    // (Nhưng chỉ khi ở đây thật sự có cái ăn — nếu không con vật sẽ đứng gặm mẩu vụn tới chết thay vì đi tìm.)
    const desperation = ctx.energyFrac < 0.2 ? (0.2 - ctx.energyFrac) * 7 * Math.min(1, best / 0.15) : 0;
    return hunger * (0.5 + 0.5 * Math.min(1, best / 0.3)) * Math.min(1, best / 0.04) + desperation;
  },
  apply(ctx, p) {
    const { sim, i } = ctx;
    if (ctx.forageHere) {
      consumeField(ctx, p.sources[ctx.forageSource]);
      halt(sim, i, State.FORAGE);
      return;
    }
    const cell = ctx.forageCell;
    const rng = sim.rng;
    const x = ((cell % GRID) + 0.2 + 0.6 * rng.next()) * CELL_SIZE;
    const y = (((cell / GRID) | 0) + 0.2 + 0.6 * rng.next()) * CELL_SIZE;
    goTo(sim, i, x, y, ctx.walk * 1.3, State.FORAGE);
  },
};
