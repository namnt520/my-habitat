/**
 * Tiện ích dùng chung cho các module hành vi.
 */
import { CELL_SIZE, GRID } from '../../sim/constants';
import { eatCorpse, goTo, halt } from '../../sim/actions';
import type { ThinkContext } from '../../sim/context';
import { State } from '../../sim/entities';
import type { Simulation } from '../../sim/simulation';

/** Đọc một tham số số từ JSON, có giá trị mặc định; báo lỗi rõ ràng nếu sai kiểu. */
export function num(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`Tham số "${key}" phải là số`);
  return value;
}

/** Đọc một tham số boolean từ JSON. */
export function bool(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`Tham số "${key}" phải là true/false`);
  return value;
}

/** Toạ độ tâm của một ô lưới. */
export function cellCenterX(cell: number): number {
  return ((cell % GRID) + 0.5) * CELL_SIZE;
}
export function cellCenterY(cell: number): number {
  return (((cell / GRID) | 0) + 0.5) * CELL_SIZE;
}

/** Cá thể đang ăn dở một cái xác còn hợp lệ không. */
export function isFeeding(ctx: ThinkContext): boolean {
  const a = ctx.sim.animals;
  if (a.state[ctx.i] !== State.EAT) return false;
  const corpse = a.target[ctx.i];
  const corpses = ctx.sim.corpses;
  return corpse >= 0 && corpses.alive[corpse] === 1 && corpses.id[corpse] === a.targetId[ctx.i];
}

/** Bắt đầu hoặc tiếp tục ăn một cái xác: tới gần nếu còn xa, cắn nếu đã trong tầm với. */
export function feedOn(ctx: ThinkContext, corpse: number): void {
  const { sim, i, sp } = ctx;
  const a = sim.animals;
  const corpses = sim.corpses;
  const dx = corpses.x[corpse] - ctx.x;
  const dy = corpses.y[corpse] - ctx.y;
  a.target[i] = corpse;
  a.targetId[i] = corpses.id[corpse];
  if (dx * dx + dy * dy <= (sp.reach + 2) * (sp.reach + 2)) {
    halt(sim, i, State.EAT);
    eatCorpse(ctx, corpse);
    // Lãnh thổ dịch dần về nơi kiếm được ăn.
    a.homeX[i] += 0.2 * (ctx.x - a.homeX[i]);
    a.homeY[i] += 0.2 * (ctx.y - a.homeY[i]);
  } else {
    goTo(sim, i, corpses.x[corpse], corpses.y[corpse], ctx.run * 0.85, State.EAT);
  }
}

/** Con mồi đang bị đuổi còn hợp lệ không (còn sống và đúng cá thể đó). */
export function huntTargetValid(sim: Simulation, slot: number): boolean {
  const a = sim.animals;
  const prey = a.target[slot];
  return prey >= 0 && a.alive[prey] === 1 && a.id[prey] === a.targetId[slot];
}
