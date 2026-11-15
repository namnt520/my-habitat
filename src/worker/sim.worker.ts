/**
 * Web Worker chạy mô phỏng với bước thời gian cố định, tách khỏi luồng giao diện.
 *
 * Vòng lặp: mỗi lát thời gian, Worker tính số tick "còn nợ" theo tốc độ mong muốn (tick/giây) và đồng hồ thực,
 * rồi chạy bấy nhiêu tick (tối đa một ngân sách thời gian để vẫn kịp trả lời tin nhắn). Tốc độ mô phỏng vì thế
 * không phụ thuộc tốc độ khung hình: giao diện vẽ chậm hay nhanh thì mô phỏng vẫn tiến đúng nhịp.
 */
import { STATS_INTERVAL } from '../sim/constants';
import { Simulation } from '../sim/simulation';
import { LOCO_AIR, LOCO_AMPHIBIOUS, LOCO_WATER } from '../species/runtime';
import type { FromWorker, PerfInfo, ToWorker, WorldMeta } from './protocol';

/** Phạm vi toàn cục tối thiểu của một Worker (tránh phụ thuộc thư viện kiểu WebWorker cho cả dự án). */
interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

/** Thời gian tối đa của một lát chạy liên tục (ms) trước khi nhường cho việc xử lý tin nhắn. */
const SLICE_BUDGET_MS = 12;
/** Gửi ma trận dòng năng lượng và histogram mỗi N lần lấy mẫu thống kê. */
const HEAVY_STATS_EVERY = 5;

let sim: Simulation | null = null;
let targetTicksPerSecond = 0;
let owedTicks = 0;
let lastTime = performance.now();
let smoothedTickMs = 0;
let achievedTicksPerSecond = 0;
let ticksThisSecond = 0;
let secondStart = performance.now();
let statsCounter = 0;

function post(message: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function buildMeta(simulation: Simulation): WorldMeta {
  const terrain = simulation.world.terrain;
  const registry = simulation.registry;
  return {
    seed: simulation.seed,
    scenario: simulation.scenario,
    params: { ...simulation.params },
    elevation: terrain.elevation.slice(),
    canopy: terrain.canopy.slice(),
    river: terrain.river.slice(),
    landRegion: terrain.landRegion.slice(),
    animals: registry.animals.map((species) => ({
      index: species.index,
      key: species.key,
      name: species.def.name,
      role: species.def.role,
      mechanism: species.def.mechanism,
      shape: species.def.appearance.shape,
      saturation: species.def.appearance.saturation,
      mass: species.mass,
      flying: species.locomotion === LOCO_AIR,
      aquatic: species.locomotion === LOCO_WATER || species.locomotion === LOCO_AMPHIBIOUS,
      starting: species.def.starting,
      genes: species.genes,
      pool: species.pool,
      behaviors: species.def.behaviors.map((behavior) => behavior.use),
    })),
    fields: registry.fieldDefs.map((def) => ({
      key: def.key,
      name: def.name,
      role: def.role,
      mechanism: def.mechanism,
      color: def.color,
      pool: registry.pools[def.key],
    })),
    pools: simulation.ledger.names.slice(),
  };
}

function postStats(simulation: Simulation): void {
  const heavy = statsCounter % HEAVY_STATS_EVERY === 0;
  statsCounter++;
  post({
    type: 'stats',
    frame: simulation.collectStats(),
    lineages: simulation.lineages.nodes.map((node) => ({ ...node })),
    flows: heavy ? simulation.ledger.flows.slice() : null,
    intake: heavy ? simulation.stats.intake.slice() : null,
    histograms: heavy
      ? simulation.registry.animals.map((species) => simulation.stats.histogram(simulation, species.index))
      : null,
  });
}

/** Chạy tối đa `count` tick trong ngân sách thời gian; trả về số tick đã chạy. */
function advance(simulation: Simulation, count: number, budgetMs: number): number {
  const start = performance.now();
  let done = 0;
  while (done < count) {
    simulation.step();
    done++;
    if (simulation.tick % STATS_INTERVAL === 0) postStats(simulation);
    // Kiểm tra đồng hồ mỗi 4 tick để không tốn công đo.
    if ((done & 3) === 0 && performance.now() - start > budgetMs) break;
  }
  if (done > 0) {
    const perTick = (performance.now() - start) / done;
    smoothedTickMs = smoothedTickMs === 0 ? perTick : smoothedTickMs * 0.9 + perTick * 0.1;
    ticksThisSecond += done;
  }
  return done;
}

function loop(): void {
  const now = performance.now();
  if (sim && targetTicksPerSecond > 0) {
    if (targetTicksPerSecond === Infinity) {
      advance(sim, 1_000_000, SLICE_BUDGET_MS);
      owedTicks = 0;
    } else {
      owedTicks += ((now - lastTime) / 1000) * targetTicksPerSecond;
      // Không tích nợ quá nửa giây: nếu máy không theo kịp thì mô phỏng chậm lại chứ không "trả góp" dồn dập.
      const cap = Math.max(1, targetTicksPerSecond * 0.5);
      if (owedTicks > cap) owedTicks = cap;
      const whole = Math.floor(owedTicks);
      if (whole > 0) owedTicks -= advance(sim, whole, SLICE_BUDGET_MS);
    }
  } else {
    owedTicks = 0;
  }
  lastTime = now;
  if (now - secondStart >= 500) {
    achievedTicksPerSecond = (ticksThisSecond * 1000) / (now - secondStart);
    ticksThisSecond = 0;
    secondStart = now;
  }
  // Chạy hết tốc lực thì nhường ngay (0 ms); còn lại thì ~250 lần/giây là thừa đủ cho ×1.
  setTimeout(loop, targetTicksPerSecond === Infinity || targetTicksPerSecond > 400 ? 0 : 4);
}

function perf(): PerfInfo {
  return { tickMs: smoothedTickMs, ticksPerSecond: achievedTicksPerSecond, targetTicksPerSecond };
}

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      sim = new Simulation({ seed: message.seed, scenario: message.scenario, params: message.params });
      owedTicks = 0;
      smoothedTickMs = 0;
      statsCounter = 0;
      const meta = buildMeta(sim);
      post({ type: 'ready', meta }, [
        meta.elevation.buffer,
        meta.canopy.buffer,
        meta.river.buffer,
        meta.landRegion.buffer,
      ]);
      postStats(sim);
      break;
    }
    case 'speed':
      targetTicksPerSecond = message.ticksPerSecond;
      lastTime = performance.now();
      owedTicks = 0;
      break;
    case 'frame': {
      if (!sim) break;
      const snapshot = sim.snapshot(message.fields);
      const transfer: Transferable[] = [snapshot.animals.buffer, snapshot.corpses.buffer];
      if (snapshot.fields)
        for (const field of Object.values(snapshot.fields)) transfer.push((field as Uint8Array).buffer);
      const fraction = targetTicksPerSecond === Infinity ? 0 : Math.min(1, owedTicks);
      post({ type: 'frame', snapshot, tickFraction: fraction, perf: perf() }, transfer);
      break;
    }
    case 'event':
      sim?.applyEvent(message.event);
      break;
    case 'param':
      sim?.setParam(message.key, message.value as never);
      break;
    case 'inspect':
      post({ type: 'inspect', info: sim ? sim.inspect(message.id) : null });
      break;
    case 'hash':
      if (sim) post({ type: 'hash', tick: sim.tick, hash: sim.stateHash(), ms: 0 });
      break;
    case 'run': {
      if (!sim) break;
      const start = performance.now();
      for (let k = 0; k < message.ticks; k++) {
        sim.step();
        if (sim.tick % STATS_INTERVAL === 0) postStats(sim);
      }
      post({ type: 'hash', tick: sim.tick, hash: sim.stateHash(), ms: performance.now() - start });
      break;
    }
  }
};

loop();
