import { SCENT_CANOPY, SCENT_RANGE_IN_FOREST, WADE_DEPTH } from '../../sim/constants';
import { halt, setState } from '../../sim/actions';
import type { ThinkContext } from '../../sim/context';
import { State } from '../../sim/entities';
import { detects } from '../../sim/perception';
import { cellAt } from '../../sim/terrain';
import {
  type BehaviorModule,
  LOCO_LAND,
  LOCO_WATER,
  type SpeciesLookup,
  type SpeciesRuntime,
} from '../runtime';
import { feedOn, huntTargetValid, isFeeding, num } from './shared';

/** Chỉ đánh hơi tìm mồi khi dự trữ đã xuống dưới mức này (no thì không cần lùng). */
const TRACK_BELOW = 0.55;

interface HuntParams {
  /** Tầm đánh hơi con mồi ngoài tầm nhìn (u); 0 = không đánh hơi. */
  trackRange: number;
  /** Thời gian đuổi tối đa trước khi bỏ cuộc, và thời gian nghỉ sau khi bỏ cuộc (tick). */
  chaseTicks: number;
  restTicks: number;
  /** Rình tới gần hơn khoảng này (u) mới bứt tốc; rình quá `stalkTicks` thì bỏ. */
  pounceRange: number;
  stalkTicks: number;
}

/** Ghi danh sách con mồi vào mặt nạ bit của loài. */
export function registerPrey(
  raw: Record<string, unknown>,
  species: SpeciesRuntime,
  lookup: SpeciesLookup,
): void {
  const prey = raw.prey;
  if (!Array.isArray(prey) || prey.length === 0) throw new Error('Module săn cần danh sách "prey"');
  for (const key of prey) species.preyMask |= 1 << lookup(String(key)).index;
  species.hunts = true;
  species.huntBelow = Math.max(species.huntBelow, num(raw, 'huntBelow', 0.7));
}

function configureHunt(aerial: boolean) {
  return (raw: Record<string, unknown>, species: SpeciesRuntime, lookup: SpeciesLookup): HuntParams => {
    registerPrey(raw, species, lookup);
    species.soloMassRatio = num(raw, 'minMassRatio', 0.9);
    if (aerial) species.aerialHunter = true;
    return {
      chaseTicks: num(raw, 'chaseTicks', 70),
      restTicks: num(raw, 'restTicks', 60),
      pounceRange: num(raw, 'pounceRange', 30),
      stalkTicks: num(raw, 'stalkTicks', 220),
      trackRange: num(raw, 'trackRange', 0),
    };
  };
}

/**
 * Đánh hơi: tìm con mồi gần nhất trong `range` mà KHÔNG cần nhìn thấy (mùi không bị rừng hay bóng đêm che).
 * Kẻ săn đói dùng nó để lần tới những cụm con mồi ở xa thay vì quẩn quanh một chỗ đã hết mồi.
 * @param large true để tìm mồi lớn (cần cả bầy), false để tìm mồi săn đơn lẻ được
 */
export function trackPrey(ctx: ThinkContext, range: number, large: boolean): number {
  const { sim, i, sp } = ctx;
  const a = sim.animals;
  const world = sim.world;
  const scratch = sim.scratch;
  const found = sim.hash.query(ctx.x, ctx.y, range, scratch);
  const landBound = sp.locomotion === LOCO_LAND && !sp.canSwim;
  const region = a.region[i];
  let best = -1;
  let best2 = range * range;
  for (let k = 0; k < found; k++) {
    const j = scratch[k];
    if ((sp.preyMask & (1 << a.species[j])) === 0 || a.alive[j] === 0 || a.state[j] === State.HIBERNATE)
      continue;
    const dx = a.x[j] - ctx.x;
    const dy = a.y[j] - ctx.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= best2) continue;
    if (ctx.mass / a.structure[j] >= sp.soloMassRatio === large) continue;
    const cell = cellAt(a.x[j], a.y[j]);
    // Rừng rậm làm loãng mùi: con mồi dưới tán dày chỉ bị đánh hơi khi ở gần — rừng là nơi trú ẩn.
    if (world.terrain.canopy[cell] > SCENT_CANOPY && d2 > SCENT_RANGE_IN_FOREST * SCENT_RANGE_IN_FOREST)
      continue;
    const depth = world.depthAt(cell);
    if (depth > WADE_DEPTH * 2.5 && sp.locomotion !== LOCO_WATER) continue;
    if (landBound && depth <= 0 && world.terrain.landRegion[cell] !== region) continue;
    best2 = d2;
    best = j;
  }
  return best;
}

/** Con mồi ở gần hơn mức này (u) thì kẻ săn bám theo được bằng tai/mũi dù không nhìn thấy. */
const CLOSE_QUARTERS = 22;

/**
 * Kẻ săn đang lao đuổi có còn bám được con mồi không: phải còn nhìn thấy nó (hoặc đã ở sát).
 * Nhờ điều kiện này, con mồi chạy vào rừng rậm hoặc nguỵ trang tốt có thể cắt đuôi kẻ săn.
 */
export function stillInSight(ctx: ThinkContext): boolean {
  const a = ctx.sim.animals;
  if (a.state[ctx.i] !== State.HUNT) return true; // đang rình: lần theo mùi
  const prey = a.target[ctx.i];
  const dx = a.x[prey] - ctx.x;
  const dy = a.y[prey] - ctx.y;
  const d2 = dx * dx + dy * dy;
  return d2 < CLOSE_QUARTERS * CLOSE_QUARTERS || detects(ctx, prey, d2);
}

/** Cá thể đang rình hoặc đuổi một con mồi do chính module này khởi xướng. */
export function isPursuing(ctx: ThinkContext): boolean {
  const a = ctx.sim.animals;
  const state = a.state[ctx.i];
  return (state === State.HUNT || state === State.STALK) && a.behavior[ctx.i] === ctx.behaviorIndex;
}

/**
 * Điều khiển pha rình/đuổi: đi chậm tới gần khi con mồi chưa hay biết, bứt tốc khi đã đủ gần hoặc con mồi bỏ chạy.
 * Con mồi chỉ phản ứng với kẻ săn đang lao tới (trạng thái HUNT) hoặc đã ở rất gần — xem `perception.ts`.
 */
export function pursue(ctx: ThinkContext, pounceRange: number): void {
  const { sim, i } = ctx;
  const a = sim.animals;
  const prey = a.target[i];
  const dx = a.x[prey] - ctx.x;
  const dy = a.y[prey] - ctx.y;
  const alerted = a.state[prey] === State.FLEE;
  const d2 = dx * dx + dy * dy;
  if (a.state[i] === State.HUNT || alerted || d2 < pounceRange * pounceRange) {
    setState(sim, i, State.HUNT);
    a.speed[i] = ctx.run;
  } else {
    setState(sim, i, State.STALK);
    // Còn xa thì chạy nước kiệu cho nhanh tới; vào gần mới đi rón rén.
    a.speed[i] = d2 > 6.25 * pounceRange * pounceRange ? ctx.run * 0.6 : ctx.walk * 1.25;
  }
}

function score(ctx: ThinkContext, p: HuntParams): number {
  const { sim, i } = ctx;
  const a = sim.animals;
  // Đang ăn con mồi vừa hạ: ăn tới no.
  if (isFeeding(ctx)) return ctx.energyFrac < 0.98 ? 1.1 : 0;
  if (isPursuing(ctx)) {
    const limit = a.state[i] === State.HUNT ? p.chaseTicks : p.stalkTicks;
    if (huntTargetValid(sim, i) && a.stateTime[i] < limit && a.health[i] > 0.35 && stillInSight(ctx))
      return 0.95;
    // Đuổi quá lâu hoặc bị thương: bỏ cuộc và nghỉ, để không đốt hết năng lượng vào một con mồi.
    a.huntCooldown[i] = p.restTicks;
    return 0;
  }
  if (!ctx.wantsPrey) return 0;
  if (ctx.prey < 0) {
    if (p.trackRange <= 0 || ctx.energyFrac > TRACK_BELOW) return 0;
    ctx.prey = trackPrey(ctx, p.trackRange, false);
    if (ctx.prey < 0) return 0;
  }
  return 0.4 + 0.55 * (1 - ctx.energyFrac);
}

function apply(ctx: ThinkContext, p: HuntParams): void {
  const { sim, i } = ctx;
  const a = sim.animals;
  if (isFeeding(ctx)) {
    feedOn(ctx, a.target[i]);
    return;
  }
  if (!isPursuing(ctx)) {
    if (ctx.prey < 0) {
      halt(sim, i, State.IDLE);
      return;
    }
    a.target[i] = ctx.prey;
    a.targetId[i] = a.id[ctx.prey];
    a.targetX[i] = a.x[ctx.prey];
    a.targetY[i] = a.y[ctx.prey];
    a.state[i] = State.STALK;
    a.stateTime[i] = 0;
  }
  pursue(ctx, p.pounceRange);
}

/**
 * Săn đơn lẻ: chọn con mồi "đáng giá" nhất trong tầm nhìn (nhiều năng lượng, gần), rình tới gần rồi bứt tốc
 * đuổi theo kiểu đón đầu, ra đòn khi áp sát. Bỏ cuộc sau một thời gian đuổi. Kẻ săn no thì không săn.
 */
export const hunt: BehaviorModule<HuntParams> = {
  name: 'hunt',
  description: 'Săn đơn lẻ con mồi nhỏ hơn mình: rình, bứt tốc, ra đòn',
  configure: configureHunt(false),
  score,
  apply,
};

/**
 * Săn từ trên không (đại bàng): như săn đơn lẻ nhưng không tấn công con mồi dưới tán rừng dày —
 * cú lao xuống gần như chắc chắn trượt ở đó (xem `strike`), nên rừng là nơi trú ẩn của con mồi.
 */
export const aerialHunt: BehaviorModule<HuntParams> = {
  name: 'aerialHunt',
  description: 'Lượn tới rồi lao xuống từ trên không; hiệu quả ở đồng trống, kém trong rừng',
  configure: configureHunt(true),
  score,
  apply,
};
